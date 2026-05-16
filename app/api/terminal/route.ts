/* OrbitCode — Terminal API Route (Guarded)
 *
 * Every shell command is classified by lib/agent/safety.ts + compliance.ts.
 *
 *   - 'blocked'     → never executed; 403 response.
 *   - 'destructive' → executed only if the caller supplies a matching
 *                     confirmation token AND { confirmed: true } in the body.
 *   - 'write'/'safe' → executed.
 *
 * The route also enforces:
 *   - cwd must not be a system root
 *   - hard 120s timeout
 *   - classification metadata is emitted as the first SSE event so the UI can
 *     surface intent to the user before any output appears.
 *
 * GET-style classify: POST with { classifyOnly: true } returns classification
 * + confirmToken without running anything. This is what the UI uses to render
 * the pre-execution preview.
 */
import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { classifyCommand, logAudit } from '@/lib/agent/safety';
import { checkCommandCompliance } from '@/lib/agent/compliance';

interface TerminalBody {
  command: string;
  cwd: string;
  /** Set to true when the user has explicitly approved a destructive command. */
  confirmed?: boolean;
  /** Token returned by classifyOnly — binds approval to a specific command. */
  confirmToken?: string;
  /** If true, only classify the command and return — do not execute. */
  classifyOnly?: boolean;
}

/**
 * Workspace-path guard: reject operations against obvious system roots.
 * This is intentionally conservative — we are protecting against agent-
 * generated typos and stray `cd /` more than a hostile remote attacker.
 */
function isPathSafe(cwd: string): boolean {
  if (!cwd) return false;
  const norm = path.resolve(cwd);
  const banned = ['/', '/etc', '/root', '/usr', '/bin', '/sbin', '/var', '/boot', '/sys', '/proc'];
  if (banned.includes(norm)) return false;
  if (/^[A-Za-z]:\\?$/.test(norm)) return false;
  return true;
}

/** Deterministic per-command token so an Approve click binds to exactly the
 *  command the user previewed. Local single-user app; not a crypto secret. */
function tokenFor(command: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < command.length; i++) {
    h ^= command.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return 'ogc_' + h.toString(16);
}

export async function POST(request: NextRequest) {
  let body: TerminalBody;
  try {
    body = (await request.json()) as TerminalBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const command = (body.command || '').trim();
  const cwd = body.cwd || '';

  if (!command || !cwd) {
    return json({ error: 'command and cwd are required' }, 400);
  }
  if (!isPathSafe(cwd)) {
    return json({ error: 'cwd is not inside an allowed workspace' }, 400);
  }

  // ── 1. Classify ──────────────────────────────────────────────────────
  const check = classifyCommand(command);
  const compliance = checkCommandCompliance(command);
  const token = tokenFor(command);

  if (body.classifyOnly) {
    return json({ classification: check, compliance, confirmToken: token });
  }

  // ── 2. Block outright ────────────────────────────────────────────────
  if (check.level === 'blocked' || compliance.status === 'blocked') {
    const reason = compliance.status === 'blocked' ? compliance.reason : check.reason;
    logAudit({
      timestamp: Date.now(),
      action: 'run_command',
      toolName: 'run_command',
      args: { command },
      safetyLevel: 'blocked',
      result: 'blocked',
      detail: reason,
    });
    return json({
      error: 'Command blocked by safety policy',
      reason,
      classification: check,
      compliance,
    }, 403);
  }

  // ── 3. Gate destructive commands ─────────────────────────────────────
  if (check.level === 'destructive' && !(body.confirmed && body.confirmToken === token)) {
    logAudit({
      timestamp: Date.now(),
      action: 'run_command',
      toolName: 'run_command',
      args: { command },
      safetyLevel: 'destructive',
      result: 'pending_approval',
      detail: check.reason,
    });
    return json({
      error: 'Confirmation required',
      reason: check.reason,
      classification: check,
      compliance,
      confirmToken: token,
      needsApproval: true,
    }, 409);
  }

  // ── 4. Execute via SSE ───────────────────────────────────────────────
  logAudit({
    timestamp: Date.now(),
    action: 'run_command',
    toolName: 'run_command',
    args: { command },
    safetyLevel: check.level,
    result: 'success',
    detail: check.reason,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Surface classification to the UI up-front.
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ type: 'classification', classification: check, compliance })}\n\n`
      ));

      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];

      let killed = false;
      const proc = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        killed = true;
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'error', content: '\n⏱ Command timed out after 120 seconds' })}\n\n`
        ));
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'exit', code: -1 })}\n\n`
        ));
        controller.close();
      }, 120_000);

      proc.stdout.on('data', (data: Buffer) => {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'stdout', content: data.toString() })}\n\n`
        ));
      });
      proc.stderr.on('data', (data: Buffer) => {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'stderr', content: data.toString() })}\n\n`
        ));
      });
      proc.on('close', (code) => {
        if (killed) return;
        clearTimeout(timeout);
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'exit', code: code ?? 0 })}\n\n`
        ));
        controller.close();
      });
      proc.on('error', (err) => {
        if (killed) return;
        clearTimeout(timeout);
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`
        ));
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
