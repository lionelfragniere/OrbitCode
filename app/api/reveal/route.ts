import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import util from 'util';

const execFileAsync = util.promisify(execFile);

function isInside(root: string, target: string): boolean {
  const normalize = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const r = normalize(root);
  const t = normalize(target);
  return t === r || t.startsWith(`${r}/`);
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { projectFolder, nodePath, isDirectory } = await req.json();

    if (!projectFolder || !nodePath) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const projectRoot = path.resolve(projectFolder);
    const finalPath = path.resolve(projectRoot, nodePath);
    if (!isInside(projectRoot, finalPath)) {
      return NextResponse.json({ error: 'Path escapes project folder' }, { status: 400 });
    }

    const platform = os.platform();
    let command = 'xdg-open';
    let args: string[] = [];

    if (platform === 'win32') {
      const winPath = finalPath.replace(/\//g, '\\');
      command = 'explorer.exe';
      args = isDirectory ? [winPath] : [`/select,${winPath}`];
    } else if (platform === 'darwin') {
      command = 'open';
      args = isDirectory ? [finalPath] : ['-R', finalPath];
    } else {
      args = [isDirectory ? finalPath : path.dirname(finalPath)];
    }

    try {
      await execFileAsync(command, args, { windowsHide: true });
      return NextResponse.json({ success: true, path: finalPath });
    } catch (execError: unknown) {
      const error = execError as { code?: number; message?: string };
      // explorer.exe returns exit code 1 even on success on Windows
      if (platform === 'win32' && error.code === 1) {
        return NextResponse.json({ success: true, path: finalPath });
      }
      console.error('Reveal error:', execError);
      return NextResponse.json({ error: 'Failed to reveal path', details: error.message || 'Unknown error' }, { status: 500 });
    }

  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

