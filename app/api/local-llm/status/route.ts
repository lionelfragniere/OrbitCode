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

interface OllamaModel {
  name: string;
  id?: string;
  size?: string;
  modified?: string;
}

function parseOllamaList(stdout: string): OllamaModel[] {
  return stdout.trim().split('\n').slice(1).map((line) => {
    const [name, id, sizeValue, sizeUnit, ...modified] = line.trim().split(/\s+/);
    const size = sizeValue && sizeUnit ? `${sizeValue} ${sizeUnit}` : sizeValue;
    return { name, id, size, modified: modified.join(' ') };
  }).filter((model) => model.name);
}

async function ollamaModels(): Promise<OllamaModel[]> {
  try {
    const { stdout } = await pexecFile('ollama', ['list'], { timeout: 8000, windowsHide: true });
    return parseOllamaList(stdout);
  } catch {
    return [];
  }
}

function hasModel(models: OllamaModel[], selectedModel: string | null): boolean {
  if (!selectedModel) return false;
  const wanted = selectedModel.toLowerCase();
  return models.some((model) => {
    const name = model.name.toLowerCase();
    return name === wanted || (!wanted.includes(':') && name.startsWith(`${wanted}:`));
  });
}

export async function GET(request: Request) {
  const selectedModel = new URL(request.url).searchParams.get('model');
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
    ollamaInstalled,
    ollamaModels: models.map((model) => model.name),
    selectedModel,
    modelInstalled: hasModel(models, selectedModel),
    ollama: {
      installed: ollamaInstalled,
      baseUrl: 'http://localhost:11434/v1',
      models,
      modelNames: models.map((model) => model.name),
      selectedModel,
      selectedModelInstalled: hasModel(models, selectedModel),
    },
    tools: {
      uvInstalled,
      mempalaceInstalled,
    },
  });
}
