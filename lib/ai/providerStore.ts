import fs from 'fs/promises';
import path from 'path';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_VERTEX_MODEL,
} from '@/lib/orbitcode';
import { getConfigFilePath, getLegacyConfigFilePath } from '@/lib/server/appPaths';
import { saveSecret } from '@/lib/server/secrets';
import type { AiModelConfig, AiProviderKind, AiProviderProfile } from './types';

interface ProviderStore {
  version: number;
  selectedProviderId: string;
  providers: AiProviderProfile[];
}

export type ProviderProfileInput = Partial<AiProviderProfile> & {
  id?: string;
  kind: AiProviderKind;
  name?: string;
  apiKey?: string;
};

const PROVIDERS_FILE = getConfigFilePath('providers.json');

function now() {
  return Date.now();
}

function defaultProviders(): AiProviderProfile[] {
  const timestamp = now();
  return [
    {
      id: DEFAULT_PROVIDER_ID,
      name: 'Ollama Local',
      kind: 'ollama',
      enabled: true,
      defaultModel: DEFAULT_LOCAL_MODEL,
      baseUrl: 'http://localhost:11434/v1',
      notes: 'Local OpenAI-compatible endpoint. Install Ollama separately, then pull a model.',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      enabled: false,
      defaultModel: DEFAULT_OPENAI_MODEL,
      baseUrl: 'https://api.openai.com/v1',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      kind: 'anthropic',
      enabled: false,
      defaultModel: DEFAULT_ANTHROPIC_MODEL,
      baseUrl: 'https://api.anthropic.com',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'gemini-api',
      name: 'Gemini API',
      kind: 'gemini',
      enabled: false,
      defaultModel: DEFAULT_GEMINI_MODEL,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'vertex-ai',
      name: 'Vertex AI',
      kind: 'vertex',
      enabled: false,
      defaultModel: DEFAULT_VERTEX_MODEL,
      gcpRegion: 'us-central1',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

async function readLegacyConfig(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(getLegacyConfigFilePath('config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

async function ensureProviderDir() {
  await fs.mkdir(path.dirname(PROVIDERS_FILE), { recursive: true });
}

export async function readProviderStore(): Promise<ProviderStore> {
  try {
    const raw = await fs.readFile(PROVIDERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ProviderStore;
    const providers = Array.isArray(parsed.providers) && parsed.providers.length > 0
      ? parsed.providers
      : defaultProviders();
    return {
      ...parsed,
      providers,
      version: parsed.version || 1,
      selectedProviderId: parsed.selectedProviderId || DEFAULT_PROVIDER_ID,
    };
  } catch {
    const legacy = await readLegacyConfig();
    const providers = defaultProviders();
    const legacyProject = typeof legacy.gcpProject === 'string' ? legacy.gcpProject : '';
    const vertex = providers.find((provider) => provider.id === 'vertex-ai');
    if (vertex && legacyProject) {
      vertex.enabled = true;
      vertex.gcpProject = legacyProject;
      vertex.gcpRegion = typeof legacy.gcpRegion === 'string' ? legacy.gcpRegion : 'us-central1';
    }
    const selectedProviderId = legacyProject ? 'vertex-ai' : DEFAULT_PROVIDER_ID;
    return { version: 1, selectedProviderId, providers };
  }
}

export async function writeProviderStore(store: ProviderStore): Promise<void> {
  await ensureProviderDir();
  await fs.writeFile(PROVIDERS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export async function upsertProviderProfile(input: ProviderProfileInput): Promise<ProviderStore> {
  const store = await readProviderStore();
  const id = input.id || `${input.kind}-${Date.now()}`;
  const existing = store.providers.find((provider) => provider.id === id);
  let apiKeyRef = input.apiKeyRef || existing?.apiKeyRef;
  if (input.apiKey) {
    apiKeyRef = await saveSecret(`${id} API key`, input.apiKey, apiKeyRef);
  }

  const updated: AiProviderProfile = {
    id,
    name: input.name || existing?.name || id,
    kind: input.kind,
    enabled: input.enabled ?? existing?.enabled ?? true,
    defaultModel: input.defaultModel || existing?.defaultModel || DEFAULT_LOCAL_MODEL,
    baseUrl: input.baseUrl ?? existing?.baseUrl,
    apiKeyRef,
    headers: input.headers ?? existing?.headers,
    gcpProject: input.gcpProject ?? existing?.gcpProject,
    gcpRegion: input.gcpRegion ?? existing?.gcpRegion,
    notes: input.notes ?? existing?.notes,
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
  };

  store.providers = existing
    ? store.providers.map((provider) => (provider.id === id ? updated : provider))
    : [...store.providers, updated];
  store.selectedProviderId = input.enabled === false && store.selectedProviderId === id
    ? DEFAULT_PROVIDER_ID
    : (input.id === store.selectedProviderId || input.enabled ? id : store.selectedProviderId);
  await writeProviderStore(store);
  return store;
}

export async function selectProvider(providerId: string): Promise<ProviderStore> {
  const store = await readProviderStore();
  if (store.providers.some((provider) => provider.id === providerId)) {
    store.selectedProviderId = providerId;
    await writeProviderStore(store);
  }
  return store;
}

export async function resolveModelConfig(input: Partial<AiModelConfig> & {
  selectedProviderId?: string;
  selectedModel?: string;
  gcpProject?: string;
  gcpRegion?: string;
} = {}): Promise<AiModelConfig> {
  if (input.providerKind) {
    return {
      providerKind: input.providerKind,
      providerId: input.providerId,
      model: input.model || input.selectedModel || DEFAULT_LOCAL_MODEL,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      baseUrl: input.baseUrl,
      apiKeyRef: input.apiKeyRef,
      headers: input.headers,
      gcpProject: input.gcpProject,
      gcpRegion: input.gcpRegion,
    };
  }

  const store = await readProviderStore();
  const providerId = input.providerId || input.selectedProviderId || store.selectedProviderId;
  const profile = store.providers.find((provider) => provider.id === providerId)
    || store.providers.find((provider) => provider.id === DEFAULT_PROVIDER_ID)
    || defaultProviders()[0];

  if (input.gcpProject && !input.providerId && !input.selectedProviderId) {
    return {
      providerId: 'vertex-ai',
      providerKind: 'vertex',
      model: input.model || input.selectedModel || DEFAULT_VERTEX_MODEL,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      gcpProject: input.gcpProject,
      gcpRegion: input.gcpRegion || 'us-central1',
    };
  }

  return {
    providerId: profile.id,
    providerKind: profile.kind,
    model: input.model || input.selectedModel || profile.defaultModel,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    baseUrl: input.baseUrl ?? profile.baseUrl,
    apiKeyRef: input.apiKeyRef ?? profile.apiKeyRef,
    headers: input.headers ?? profile.headers,
    gcpProject: input.gcpProject ?? profile.gcpProject,
    gcpRegion: input.gcpRegion ?? profile.gcpRegion,
  };
}
