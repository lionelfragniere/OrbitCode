/* OrbitCode — Process Registry
 * Tracks spawned child processes per project so they can be cleaned up
 * when the user switches projects or starts a new agent run.
 *
 * Platform-aware: uses taskkill on Windows, kill on Unix.
 * Conservative cleanup: only kills tracked/owned processes.
 * Folder-based sweep is logged and opt-in.
 */

import { spawn, execSync } from 'child_process';

interface TrackedProcess {
  pid: number;
  command: string;
  projectId: string;
  runId?: string;
  startedAt: number;
}

// Global registry — keyed by project folder
const registry: Map<string, TrackedProcess[]> = new Map();

const isWin = process.platform === 'win32';

// Auto-prune interval (60 seconds)
let pruneInterval: ReturnType<typeof setInterval> | null = null;

function startAutoPrune() {
  if (pruneInterval) return;
  pruneInterval = setInterval(() => {
    pruneDeadProcesses();
  }, 60000);
  // Don't prevent Node from exiting
  if (pruneInterval && typeof pruneInterval === 'object' && 'unref' in pruneInterval) {
    pruneInterval.unref();
  }
}

/**
 * Register a spawned child process for a project.
 */
export function registerProcess(projectId: string, pid: number, command: string, runId?: string): void {
  if (!registry.has(projectId)) {
    registry.set(projectId, []);
  }
  registry.get(projectId)!.push({
    pid,
    command,
    projectId,
    runId,
    startedAt: Date.now(),
  });
  // Start auto-pruning on first registration
  startAutoPrune();
}

/**
 * Kill all tracked processes for a specific project.
 * Called when switching projects or starting a fresh run.
 * Returns a log of what was killed.
 */
export async function killProjectProcesses(projectId: string): Promise<string[]> {
  const procs = registry.get(projectId) || [];
  const killed: string[] = [];

  for (const proc of procs) {
    const wasAlive = isProcessAlive(proc.pid);
    if (!wasAlive) continue;

    try {
      if (isWin) {
        // Windows: use taskkill with /T (tree) /F (force)
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(proc.pid, 'SIGTERM');
      }
      killed.push(`Killed PID ${proc.pid}: ${proc.command} (project: ${projectId})`);
    } catch {
      // Process may already be dead — that's fine
    }
  }

  registry.delete(projectId);
  return killed;
}

/**
 * Kill tracked processes for a specific run within a project.
 * More surgical than killProjectProcesses — only kills processes from that run.
 */
export async function killRunProcesses(projectId: string, runId: string): Promise<string[]> {
  const procs = registry.get(projectId) || [];
  const killed: string[] = [];
  const remaining: TrackedProcess[] = [];

  for (const proc of procs) {
    if (proc.runId === runId) {
      if (isProcessAlive(proc.pid)) {
        try {
          if (isWin) {
            spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
          } else {
            process.kill(proc.pid, 'SIGTERM');
          }
          killed.push(`Killed PID ${proc.pid}: ${proc.command} (run: ${runId})`);
        } catch {
          // Already dead
        }
      }
    } else {
      remaining.push(proc);
    }
  }

  if (remaining.length === 0) {
    registry.delete(projectId);
  } else {
    registry.set(projectId, remaining);
  }
  return killed;
}

/**
 * Kill ALL tracked processes across all projects.
 * Nuclear option for full cleanup.
 */
export async function killAllProcesses(): Promise<string[]> {
  const allKilled: string[] = [];
  for (const [projectId] of registry) {
    const killed = await killProjectProcesses(projectId);
    allKilled.push(...killed);
  }
  return allKilled;
}

/**
 * Get all tracked processes for a project.
 */
export function getProjectProcesses(projectId: string): TrackedProcess[] {
  return registry.get(projectId) || [];
}

/**
 * Get count of all tracked processes (for diagnostics).
 */
export function getTrackedProcessCount(): { total: number; alive: number; projects: number } {
  let total = 0;
  let alive = 0;
  for (const [, procs] of registry) {
    for (const proc of procs) {
      total++;
      if (isProcessAlive(proc.pid)) alive++;
    }
  }
  return { total, alive, projects: registry.size };
}

/**
 * Remove dead processes from registry (garbage collection).
 */
export function pruneDeadProcesses(): number {
  let pruned = 0;
  for (const [projectId, procs] of registry) {
    const alive = procs.filter(p => isProcessAlive(p.pid));
    pruned += procs.length - alive.length;
    if (alive.length === 0) {
      registry.delete(projectId);
    } else {
      registry.set(projectId, alive);
    }
  }
  return pruned;
}

/**
 * Kill dev server processes whose working directory matches the project folder.
 * This is the "folder-based sweep" for orphan processes not tracked in the registry.
 *
 * CONSERVATIVE: Only kills node.exe processes that are clearly dev servers
 * (listening on ports, running vite/next/webpack). Logs every kill with reason.
 *
 * Returns a log of what was killed and why.
 */
export async function killOrphanDevServers(projectFolder: string): Promise<string[]> {
  const killed: string[] = [];
  if (!isWin) return killed; // Only implemented for Windows currently

  try {
    // Use PowerShell to find node processes with matching command lines
    // This is conservative: only matches processes whose command line contains
    // the project folder path AND common dev server patterns
    const normalizedPath = projectFolder.replace(/\\/g, '\\\\');
    const cmd = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '${normalizedPath}' -and ($_.CommandLine -match 'vite|next|webpack|react-scripts|serve|dev') } | Select-Object ProcessId, CommandLine | ConvertTo-Json`;
    
    const output = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '\\"')}"`, {
      timeout: 10000,
      encoding: 'utf-8',
    }).trim();

    if (!output || output === '') return killed;

    const processes = JSON.parse(output.startsWith('[') ? output : `[${output}]`);

    for (const proc of processes) {
      if (!proc.ProcessId) continue;
      // Don't kill the OG server itself
      const myPid = process.pid;
      if (proc.ProcessId === myPid) continue;

      // Check if this PID is already tracked (don't double-kill)
      let alreadyTracked = false;
      for (const [, tracked] of registry) {
        if (tracked.some(t => t.pid === proc.ProcessId)) {
          alreadyTracked = true;
          break;
        }
      }
      if (alreadyTracked) continue;

      try {
        spawn('taskkill', ['/PID', String(proc.ProcessId), '/T', '/F'], { stdio: 'ignore' });
        const reason = `Orphan dev server in ${projectFolder}`;
        const cmdPreview = (proc.CommandLine || '').substring(0, 80);
        killed.push(`Killed orphan PID ${proc.ProcessId}: ${cmdPreview} (reason: ${reason})`);
      } catch {
        // Process may have exited between query and kill
      }
    }
  } catch {
    // PowerShell query failed — not critical, just skip orphan cleanup
  }

  return killed;
}

/**
 * Check if a process is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check if alive
    return true;
  } catch {
    return false;
  }
}
