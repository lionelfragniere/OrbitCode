import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const pexecFile = promisify(execFile);

export interface MemoryStatus {
  available: boolean;
  uvAvailable: boolean;
  detail: string;
  installCommand: string;
}

async function exists(command: string): Promise<boolean> {
  try {
    await pexecFile(process.platform === 'win32' ? 'where.exe' : 'which', [command], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function runMempalace(args: string[], cwd?: string): Promise<string> {
  const { stdout, stderr } = await pexecFile('mempalace', args, {
    timeout: 30000,
    windowsHide: true,
    cwd,
    maxBuffer: 1024 * 1024 * 5,
  });
  return (stdout || stderr || '').trim();
}

export async function getMemoryStatus(): Promise<MemoryStatus> {
  const [available, uvAvailable] = await Promise.all([exists('mempalace'), exists('uv')]);
  return {
    available,
    uvAvailable,
    detail: available
      ? 'MemPalace CLI is available on PATH.'
      : 'MemPalace CLI is not installed. OrbitCode will keep working, but persistent memory search is disabled.',
    installCommand: uvAvailable ? 'uv tool install mempalace' : 'pip install mempalace',
  };
}

export async function mempalaceWakeUp(projectFolder?: string): Promise<string> {
  const wing = projectFolder ? path.basename(projectFolder) : undefined;
  const args = wing ? ['wake-up', '--wing', wing] : ['wake-up'];
  return runMempalace(args, projectFolder);
}

export async function mempalaceSearch(query: string, projectFolder?: string, limit = 5): Promise<string> {
  const wing = projectFolder ? path.basename(projectFolder) : undefined;
  const args = ['search', query, '--results', String(limit)];
  if (wing) args.push('--wing', wing);
  return runMempalace(args, projectFolder);
}

export async function mempalaceInit(projectFolder: string): Promise<string> {
  return runMempalace(['init', projectFolder, '--yes'], projectFolder);
}

export async function mempalaceMine(projectFolder: string): Promise<string> {
  return runMempalace(['mine', projectFolder, '--wing', path.basename(projectFolder)], projectFolder);
}

export async function mempalaceNote(projectFolder: string, title: string, content: string, room = 'orbitcode-notes'): Promise<string> {
  const text = [`# ${title}`, '', content].join('\n');
  const wing = path.basename(projectFolder);
  return runMempalace(['mcp-add-drawer', '--wing', wing, '--room', room, '--content', text], projectFolder)
    .catch(async () => {
      const tmp = `OrbitCode memory note:\n${text}`;
      return `MemPalace note command unavailable. Suggested content to file manually:\n\n${tmp}`;
    });
}
