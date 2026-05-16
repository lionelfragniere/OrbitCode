import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const pexecFile = promisify(execFile);

async function commandExists(command: string): Promise<boolean> {
  try {
    await pexecFile(process.platform === 'win32' ? 'where.exe' : 'which', [command], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function nvidiaInfo() {
  try {
    const { stdout } = await pexecFile('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], {
      timeout: 8000,
      windowsHide: true,
    });
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [name, memory, driver] = line.split(',').map((part) => part.trim());
      return { name, memory, driver };
    });
  } catch {
    return [];
  }
}

async function ollamaModels() {
  try {
    const { stdout } = await pexecFile('ollama', ['list'], { timeout: 8000, windowsHide: true });
    return stdout.trim().split('\n').slice(1).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET() {
  const [ollamaInstalled, uvInstalled, mempalaceInstalled, gpus, models] = await Promise.all([
    commandExists('ollama'),
    commandExists('uv'),
    commandExists('mempalace'),
    nvidiaInfo(),
    ollamaModels(),
  ]);

  return NextResponse.json({
    os: {
      platform: process.platform,
      release: os.release(),
      arch: os.arch(),
    },
    cpu: {
      model: os.cpus()[0]?.model || 'Unknown CPU',
      cores: os.cpus().length,
    },
    memory: {
      totalBytes: os.totalmem(),
      totalGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    },
    gpu: gpus,
    ollama: {
      installed: ollamaInstalled,
      baseUrl: 'http://localhost:11434/v1',
      models,
    },
    tools: {
      uvInstalled,
      mempalaceInstalled,
    },
  });
}
