/* OrbitCode - User Config API Route */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_LOCAL_MODEL, DEFAULT_PROVIDER_ID } from '@/lib/orbitcode';
import { getConfigFilePath, getLegacyConfigFilePath } from '@/lib/server/appPaths';

const CONFIG_FILE = getConfigFilePath('config.json');
const LEGACY_CONFIG_FILE = getLegacyConfigFilePath('config.json');

export interface UserConfig {
  gcpProject: string;
  gcpRegion: string;
  providerId: string;
  selectedProviderId: string;
  providerKind?: string;
  selectedModel: string;
  workspacePath: string;
  temperature: number;
  maxTokens: number;
  systemInstruction: string;
  beginnerMode: boolean;
  recentProjects: Array<{
    name: string;
    path: string;
    lastOpened: number;
  }>;
}

const DEFAULT_CONFIG: UserConfig = {
  gcpProject: '',
  gcpRegion: 'us-central1',
  providerId: DEFAULT_PROVIDER_ID,
  selectedProviderId: DEFAULT_PROVIDER_ID,
  selectedModel: DEFAULT_LOCAL_MODEL,
  workspacePath: '',
  temperature: 0.7,
  maxTokens: 8192,
  systemInstruction: 'You are OrbitCode, an expert AI coding assistant. You help users build, debug, refactor, and understand code. Always provide complete, working code with all imports. When creating files, use the filename as the code block language identifier.',
  beginnerMode: true,
  recentProjects: [],
};

async function ensureConfigDir() {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
}

async function readConfig(): Promise<UserConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch {
    try {
      const raw = await fs.readFile(LEGACY_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return normalizeConfig({
        ...parsed,
        providerId: parsed.gcpProject ? 'vertex-ai' : DEFAULT_PROVIDER_ID,
        selectedProviderId: parsed.gcpProject ? 'vertex-ai' : DEFAULT_PROVIDER_ID,
      });
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
}

function normalizeConfig(input: Partial<UserConfig>): UserConfig {
  const selectedProviderId = input.selectedProviderId || input.providerId || DEFAULT_PROVIDER_ID;
  return {
    ...DEFAULT_CONFIG,
    ...input,
    providerId: selectedProviderId,
    selectedProviderId,
    selectedModel: input.selectedModel || DEFAULT_CONFIG.selectedModel,
    recentProjects: input.recentProjects || [],
  };
}

async function writeConfig(config: UserConfig) {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function GET() {
  const config = await readConfig();
  return NextResponse.json(config);
}

export async function PUT(request: NextRequest) {
  const updates = await request.json();
  const current = await readConfig();
  const merged = normalizeConfig({ ...current, ...updates });
  await writeConfig(merged);
  return NextResponse.json(merged);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === 'add-recent') {
    const { name, path: projectPath } = body;
    const config = await readConfig();
    config.recentProjects = config.recentProjects.filter((p) => p.path !== projectPath);
    config.recentProjects.unshift({ name, path: projectPath, lastOpened: Date.now() });
    config.recentProjects = config.recentProjects.slice(0, 20);
    await writeConfig(config);
    return NextResponse.json(config);
  }

  if (action === 'remove-recent') {
    const { path: projectPath } = body;
    const config = await readConfig();
    config.recentProjects = config.recentProjects.filter((p) => p.path !== projectPath);
    await writeConfig(config);
    return NextResponse.json(config);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
