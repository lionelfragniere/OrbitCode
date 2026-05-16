/* OrbitCode — Agent Executor
 * Implements the tool execution layer for the agent.
 * Each tool call from the model is routed to actual filesystem/terminal operations.
 *
 * Flow: Model → tool_call → executor → result → back to model
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { classifyToolCall, logAudit, type SafetyCheck } from './safety';
import { executeBrowserTest } from './browserRunner';
import { registerProcess } from './processRegistry';

// ════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════
export interface ExecutorContext {
  projectFolder: string;
  taskId: string;
  /** Pending approval requests — tool calls waiting for user OK */
  pendingApprovals: Map<string, PendingApproval>;
  /** Callback for streaming progress */
  onProgress?: (event: ExecutorEvent) => void;
}

export interface PendingApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  safety: SafetyCheck;
  timestamp: number;
}

export interface ExecutorEvent {
  type: 'tool_start' | 'tool_end' | 'approval_required' | 'command_output' | 'error';
  toolName: string;
  detail: string;
  safety?: SafetyCheck;
}

// Security: prevent path traversal
function safePath(baseDir: string, relativePath: string): string | null {
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return null;
  }
  return resolved;
}

// Ignored dirs for file listing
const IGNORED = new Set([
  'node_modules', '.git', '.next', '__pycache__', '.DS_Store',
  'dist', 'build', '.cache', '.vscode', '.idea', 'coverage',
]);

// ════════════════════════════════════════════
//  Tool Implementation: create_file
// ════════════════════════════════════════════
async function toolCreateFile(
  ctx: ExecutorContext,
  args: Record<string, unknown>,
): Promise<string> {
  const filePath = args.path as string;
  const content = args.content as string;
  const description = (args.description as string) || '';

  const absPath = safePath(ctx.projectFolder, filePath);
  if (!absPath) throw new Error(`Invalid path: ${filePath} (path traversal blocked)`);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf-8');

  const sizeFmt = Buffer.byteLength(content, 'utf-8');
  return `Created file: ${filePath} (${sizeFmt} bytes)${description ? ` — ${description}` : ''}`;
}

// ════════════════════════════════════════════
//  Tool Implementation: edit_file
// ════════════════════════════════════════════
async function toolEditFile(
  ctx: ExecutorContext,
  args: Record<string, unknown>,
): Promise<string> {
  const filePath = args.path as string;
  const search = args.search as string;
  const replace = args.replace as string;

  const absPath = safePath(ctx.projectFolder, filePath);
  if (!absPath) throw new Error(`Invalid path: ${filePath}`);

  const current = await fs.readFile(absPath, 'utf-8');
  
  if (!current.includes(search)) {
    return `ERROR: Could not find the search string in ${filePath}. The text does not match. Use read_file to see the current content.`;
  }

  const updated = current.replace(search, replace);
  await fs.writeFile(absPath, updated, 'utf-8');
  
  return `Edited file: ${filePath} — replaced ${search.length} chars with ${replace.length} chars`;
}

// ════════════════════════════════════════════
//  Tool Implementation: read_file
// ════════════════════════════════════════════
async function toolReadFile(
  ctx: ExecutorContext,
  args: Record<string, unknown>,
): Promise<string> {
  const filePath = args.path as string;

  const absPath = safePath(ctx.projectFolder, filePath);
  if (!absPath) throw new Error(`Invalid path: ${filePath}`);

  try {
    const content = await fs.readFile(absPath, 'utf-8');
    // Truncate very large files
    if (content.length > 100000) {
      return `File: ${filePath} (truncated to first 100KB)\n\n${content.substring(0, 100000)}\n\n... (${content.length - 100000} more characters)`;
    }
    return `File: ${filePath}\n\n${content}`;
  } catch {
    return `ERROR: File not found: ${filePath}`;
  }
}

// ════════════════════════════════════════════
//  Tool Implementation: delete_file
// ════════════════════════════════════════════
async function toolDeleteFile(
  ctx: ExecutorContext,
  args: Record<string, unknown>,
): Promise<string> {
  const filePath = args.path as string;

  const absPath = safePath(ctx.projectFolder, filePath);
  if (!absPath) throw new Error(`Invalid path: ${filePath}`);

  try {
    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) {
      await fs.rm(absPath, { recursive: true });
      return `Deleted directory: ${filePath}`;
    } else {
      await fs.unlink(absPath);
      return `Deleted file: ${filePath}`;
    }
  } catch {
    return `ERROR: Could not delete: ${filePath} (not found or permission denied)`;
  }
}

// ════════════════════════════════════════════
//  Command Sanitizer — Linux ↔ Windows translation
// ════════════════════════════════════════════

// Bundled asset registry. Keep this empty unless OrbitCode ships a neutral asset.
const CANONICAL_ASSETS: Record<string, { source: string; description: string }> = {};

/**
 * Copy a bundled binary asset into the project.
 */
async function toolCopyAsset(
  ctx: ExecutorContext,
  assetId: string,
  destination: string,
): Promise<string> {
  const asset = CANONICAL_ASSETS[assetId];
  if (!asset) {
    const available = Object.keys(CANONICAL_ASSETS).join(', ');
    return `ERROR: Unknown asset "${assetId}". Available assets: ${available}`;
  }

  const absPath = safePath(ctx.projectFolder, destination);
  if (!absPath) return `ERROR: Invalid destination path: ${destination} (path traversal blocked)`;

  try {
    // Verify source exists
    await fs.access(asset.source);
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    // Copy binary file
    await fs.copyFile(asset.source, absPath);
    const stat = await fs.stat(absPath);
    return `Copied asset "${assetId}" → ${destination} (${stat.size} bytes) — ${asset.description}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Copy failed';
    return `ERROR: Could not copy asset "${assetId}": ${msg}`;
  }
}
const IS_WIN = process.platform === 'win32';

function sanitizeCommandForPlatform(command: string): string {
  if (!IS_WIN) return command; // Only transform on Windows

  let cmd = command;

  // pkill -f "pattern" → Get-Process | Where-Object {$_.CommandLine -like '*pattern*'} | Stop-Process -Force -ErrorAction SilentlyContinue
  cmd = cmd.replace(/pkill\s+(-f\s+)?"([^"]+)"/g, (_m, _f, pat) =>
    `Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -like '*${pat}*'} | Stop-Process -Force -ErrorAction SilentlyContinue`);
  cmd = cmd.replace(/pkill\s+(-f\s+)?(\S+)/g, (_m, _f, pat) =>
    `Get-Process -Name '${pat}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`);

  // kill $(lsof ...) or kill PID → Stop-Process
  cmd = cmd.replace(/kill\s+\$\([^)]+\)/g, '# kill subshell not supported on Windows');
  cmd = cmd.replace(/^kill\s+(\d+)/gm, 'Stop-Process -Id $1 -Force -ErrorAction SilentlyContinue');

  // lsof -i :PORT → Get-NetTCPConnection
  cmd = cmd.replace(/lsof\s+-i\s+:(\d+)/g, 'Get-NetTCPConnection -LocalPort $1 -ErrorAction SilentlyContinue');

  // mkdir -p path → New-Item -ItemType Directory -Force -Path path
  cmd = cmd.replace(/mkdir\s+-p\s+(.+)/g, 'New-Item -ItemType Directory -Force -Path "$1" | Out-Null');

  // export VAR=val → $env:VAR='val'
  cmd = cmd.replace(/export\s+(\w+)=([^\s;]+)/g, "\$env:$1='$2'");

  // cmd1 && cmd2 → cmd1; if ($LASTEXITCODE -eq 0) { cmd2 }
  if (cmd.includes(' && ')) {
    const parts = cmd.split(' && ');
    cmd = parts.map((p, i) =>
      i === 0 ? p : `if ($LASTEXITCODE -eq 0) { ${p} }`
    ).join('; ');
  }

  // source / . script → Not applicable on Windows
  cmd = cmd.replace(/^(source|\.)\s+/gm, '# source not applicable on Windows: ');

  return cmd;
}

// ════════════════════════════════════════════
//  Tool Implementation: run_command
// ════════════════════════════════════════════
async function toolRunCommand(
  ctx: ExecutorContext,
  args: Record<string, unknown>,
): Promise<string> {
  const rawCommand = args.command as string;
  const waitForExit = (args.wait_for_exit as boolean) !== false; // Default true

  // Sanitize the command for the current platform
  const command = sanitizeCommandForPlatform(rawCommand);

  return new Promise((resolve) => {
    let shell: string;
    let shellArgs: string[];

    if (IS_WIN) {
      // Use PowerShell for reliable Windows execution
      shell = 'powershell.exe';
      shellArgs = ['-NoProfile', '-NonInteractive', '-Command', command];
    } else {
      shell = '/bin/bash';
      shellArgs = ['-c', command];
    }

    const proc = spawn(shell, shellArgs, {
      cwd: ctx.projectFolder,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Register the process for cleanup on project switch
    if (proc.pid) {
      registerProcess(ctx.projectFolder, proc.pid, rawCommand);
    }

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      ctx.onProgress?.({
        type: 'command_output',
        toolName: 'run_command',
        detail: text,
      });
    });

    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
    });

    // Timeout: 120 seconds for normal commands, 5s for background
    const timeout = waitForExit ? 120000 : 5000;
    const timer = setTimeout(() => {
      proc.kill();
      const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      resolve(`Command timed out after ${timeout / 1000}s.\nPartial output:\n${output.substring(0, 5000)}`);
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      // Truncate output to avoid massive responses
      const truncated = output.length > 8000 ? output.substring(0, 8000) + '\n... (output truncated)' : output;
      resolve(`Exit code: ${code}\n${truncated}`);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve(`ERROR: ${err.message}`);
    });
  });
}

// ════════════════════════════════════════════
//  Tool Implementation: list_files
// ════════════════════════════════════════════
async function toolListFiles(
  ctx: ExecutorContext,
  args: Record<string, unknown>,
): Promise<string> {
  const dirPath = (args.path as string) || '.';

  const absPath = safePath(ctx.projectFolder, dirPath);
  if (!absPath) throw new Error(`Invalid path: ${dirPath}`);

  try {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    const filtered = entries.filter((e) => !IGNORED.has(e.name) && !e.name.startsWith('.'));
    
    const lines = filtered
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);

    return `Directory: ${dirPath}\n${lines.join('\n') || '(empty)'}`;
  } catch {
    return `ERROR: Directory not found: ${dirPath}`;
  }
}

// ════════════════════════════════════════════
//  Tool Implementation: search_files
// ════════════════════════════════════════════
async function toolSearchFiles(
  ctx: ExecutorContext,
  args: Record<string, unknown>,
): Promise<string> {
  const query = args.query as string;
  const dirPath = (args.path as string) || '.';

  const absPath = safePath(ctx.projectFolder, dirPath);
  if (!absPath) throw new Error(`Invalid path: ${dirPath}`);

  const results: string[] = [];
  const maxResults = 30;

  async function searchDir(dir: string, prefix: string) {
    if (results.length >= maxResults) return;
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await searchDir(fullPath, relativePath);
        } else {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                results.push(`${relativePath}:${i + 1}: ${lines[i].trim().substring(0, 120)}`);
                if (results.length >= maxResults) return;
              }
            }
          } catch {
            // Skip binary files
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  await searchDir(absPath, dirPath === '.' ? '' : dirPath);

  if (results.length === 0) {
    return `No matches found for "${query}" in ${dirPath}`;
  }

  return `Search results for "${query}":\n${results.join('\n')}${results.length >= maxResults ? '\n... (more results truncated)' : ''}`;
}

// ════════════════════════════════════════════
//  Main executor: route tool calls to implementations
// ════════════════════════════════════════════
export async function executeTool(
  ctx: ExecutorContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Safety check
  const safety = classifyToolCall(name, args);
  
  ctx.onProgress?.({
    type: 'tool_start',
    toolName: name,
    detail: JSON.stringify(args).substring(0, 200),
    safety,
  });

  // Block dangerous operations
  if (safety.level === 'blocked') {
    logAudit({
      timestamp: Date.now(),
      action: `${name}(${JSON.stringify(args).substring(0, 100)})`,
      toolName: name,
      args,
      safetyLevel: 'blocked',
      result: 'blocked',
      detail: safety.reason,
    });
    return `BLOCKED: ${safety.reason}. This operation is not allowed.`;
  }

  // For destructive operations, add to pending approvals
  if (safety.requiresApproval) {
    const approvalId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    ctx.pendingApprovals.set(approvalId, {
      id: approvalId,
      toolName: name,
      args,
      safety,
      timestamp: Date.now(),
    });

    ctx.onProgress?.({
      type: 'approval_required',
      toolName: name,
      detail: safety.reason,
      safety,
    });

    logAudit({
      timestamp: Date.now(),
      action: `${name}(${JSON.stringify(args).substring(0, 100)})`,
      toolName: name,
      args,
      safetyLevel: safety.level,
      result: 'pending_approval',
      detail: safety.reason,
    });

    // Block ALL destructive operations until real approval — no auto-approve
    if (safety.level === 'destructive') {
      return `REQUIRES APPROVAL: ${safety.reason}. This destructive operation was not executed. Please approve or modify.`;
    }
  }

  // Execute the tool
  try {
    let result: string;

    switch (name) {
      case 'create_file':
        result = await toolCreateFile(ctx, args);
        break;
      case 'edit_file':
        result = await toolEditFile(ctx, args);
        break;
      case 'read_file':
        result = await toolReadFile(ctx, args);
        break;
      case 'delete_file':
        result = await toolDeleteFile(ctx, args);
        break;
      case 'run_command':
        result = await toolRunCommand(ctx, args);
        break;
      case 'list_files':
        result = await toolListFiles(ctx, args);
        break;
      case 'search_files':
        result = await toolSearchFiles(ctx, args);
        break;
      case 'run_browser_test':
        result = await executeBrowserTest(ctx, args);
        break;
      case 'git_action': {
        const action = args.action as string;
        if (action === 'commit') {
          // Sequential git add then commit — platform-safe
          const addResult = await toolRunCommand(ctx, { command: 'git add .', wait_for_exit: true });
          if (addResult.includes('Exit code: 0') || !addResult.includes('ERROR')) {
            const msg = (args.message as string || 'Update').replace(/"/g, "'");
            result = await toolRunCommand(ctx, { command: `git commit -m "${msg}"`, wait_for_exit: true });
          } else {
            result = 'ERROR: git add failed: ' + addResult;
          }
        } else if (action === 'push') {
          result = await toolRunCommand(ctx, { command: 'git push', wait_for_exit: true });
        } else if (action === 'diff') {
          result = await toolRunCommand(ctx, { command: 'git diff HEAD', wait_for_exit: true });
        } else {
          result = 'ERROR: Unknown git action: ' + action;
        }
        break;
      }
      case 'gcp_action': {
        const action = args.action as string;
        const serviceName = args.serviceName as string;
        const region = (args.region as string) || 'europe-west1';
        const project = args.project as string;
        if (action === 'cloudrun_deploy') {
          const projectFlag = project ? ` --project=${project}` : '';
          result = await toolRunCommand(ctx, { command: `gcloud run deploy ${serviceName} --source . --region=${region} --allow-unauthenticated${projectFlag}`, wait_for_exit: true });
        } else {
          result = 'ERROR: Unknown gcp action: ' + action;
        }
        break;
      }
      case 'propose_plan': {
        const approvalId = `plan_${Date.now()}`;
        ctx.pendingApprovals.set(approvalId, { id: approvalId, toolName: name, args, safety, timestamp: Date.now() });
        ctx.onProgress?.({
          type: 'approval_required',
          toolName: name,
          detail: JSON.stringify({ id: approvalId, type: 'plan', payload: args }),
          safety,
        });
        throw new Error('PAUSE_FOR_APPROVAL: Plan proposed. Waiting for user to approve or edit.');
      }
      case 'ask_decision': {
        const approvalId = `dec_${Date.now()}`;
        ctx.pendingApprovals.set(approvalId, { id: approvalId, toolName: name, args, safety, timestamp: Date.now() });
        ctx.onProgress?.({
          type: 'approval_required',
          toolName: name,
          detail: JSON.stringify({ id: approvalId, type: 'decision', payload: args }),
          safety,
        });
        throw new Error('PAUSE_FOR_APPROVAL: Decision requested. Waiting for user input.');
      }
      case 'task_complete':
        result = `Task complete: ${args.summary || 'Done.'}`;
        break;
      case 'run_visual_qa': {
        const targetUrl = args.url as string;
        try {
          const { runVisualQa, formatVisualQaReport } = await import('./visualQa');
          const qaResult = await runVisualQa(targetUrl, ctx.projectFolder);
          result = formatVisualQaReport(qaResult);
          // Stream screenshot path if available
          if (qaResult.screenshotPath) {
            ctx.onProgress?.({
              type: 'tool_end',
              toolName: 'run_visual_qa',
              detail: `screenshot:${qaResult.screenshotPath}`,
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result = `Visual QA failed to run: ${errMsg}. Falling back to curl-based checks.`;
        }
        break;
      }
      case 'copy_asset': {
        const assetId = args.asset as string;
        const destination = args.destination as string;
        result = await toolCopyAsset(ctx, assetId, destination);
        break;
      }
      case 'memory_status': {
        const { getMemoryStatus } = await import('@/lib/memory/mempalace');
        result = JSON.stringify(await getMemoryStatus(), null, 2);
        break;
      }
      case 'memory_search': {
        const { mempalaceSearch } = await import('@/lib/memory/mempalace');
        result = await mempalaceSearch(String(args.query || ''), ctx.projectFolder, Number(args.limit || 5));
        break;
      }
      case 'memory_note': {
        const { mempalaceNote } = await import('@/lib/memory/mempalace');
        result = await mempalaceNote(
          ctx.projectFolder,
          String(args.title || 'OrbitCode note'),
          String(args.content || ''),
          args.room ? String(args.room) : undefined,
        );
        break;
      }
      default:
        result = `Unknown tool: ${name}`;
    }

    logAudit({
      timestamp: Date.now(),
      action: `${name}(${JSON.stringify(args).substring(0, 100)})`,
      toolName: name,
      args,
      safetyLevel: safety.level,
      result: 'success',
      detail: result.substring(0, 200),
    });

    ctx.onProgress?.({
      type: 'tool_end',
      toolName: name,
      detail: result.substring(0, 200),
    });

    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Tool execution failed';
    
    logAudit({
      timestamp: Date.now(),
      action: `${name}(${JSON.stringify(args).substring(0, 100)})`,
      toolName: name,
      args,
      safetyLevel: safety.level,
      result: 'error',
      detail: errMsg,
    });

    ctx.onProgress?.({
      type: 'error',
      toolName: name,
      detail: errMsg,
    });

    return `ERROR: ${errMsg}`;
  }
}
