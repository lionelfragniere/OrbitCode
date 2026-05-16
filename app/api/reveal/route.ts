import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import os from 'os';
import path from 'path';
import util from 'util';

const execAsync = util.promisify(exec);

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { projectFolder, nodePath, isDirectory } = await req.json();

    if (!projectFolder || !nodePath) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    let finalPath = '';
    if (path.isAbsolute(projectFolder)) {
         finalPath = path.resolve(projectFolder, nodePath);
    } else {
         finalPath = path.resolve(process.cwd(), projectFolder, nodePath);
    }

    const platform = os.platform();
    let command = '';

    if (platform === 'win32') {
      const winPath = finalPath.replace(/\//g, '\\');
      if (isDirectory) {
        command = `explorer.exe "${winPath}"`;
      } else {
        command = `explorer.exe /select,"${winPath}"`;
      }
    } else if (platform === 'darwin') {
      if (isDirectory) {
        command = `open "${finalPath}"`;
      } else {
        command = `open -R "${finalPath}"`;
      }
    } else {
      if (isDirectory) {
        command = `xdg-open "${finalPath}"`;
      } else {
        command = `xdg-open "${path.dirname(finalPath)}"`;
      }
    }

    try {
      await execAsync(command);
      return NextResponse.json({ success: true, path: finalPath });
    } catch (execError: any) {
      // explorer.exe returns exit code 1 even on success on Windows
      if (platform === 'win32' && execError.code === 1) {
        return NextResponse.json({ success: true, path: finalPath });
      }
      console.error(`Reveal error: ${execError}`);
      return NextResponse.json({ error: 'Failed to reveal path', details: execError.message }, { status: 500 });
    }

  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

