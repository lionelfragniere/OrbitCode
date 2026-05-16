/* OrbitCode - Model Registry + Usage Tracking */
import type { AiProviderKind } from './ai/types';

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  providerKind: AiProviderKind;
  providerId?: string;
  maxOutputTokens: number;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  tier: 'local' | 'fast' | 'pro' | 'custom';
  default?: boolean;
}

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: 'qwen3:8b',
    name: 'Qwen3 8B',
    description: 'Fast local default through Ollama',
    providerKind: 'ollama',
    providerId: 'local-ollama',
    maxOutputTokens: 8192,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    tier: 'local',
    default: true,
  },
  {
    id: 'qwen3:14b',
    name: 'Qwen3 14B',
    description: 'Balanced local model for stronger reasoning',
    providerKind: 'ollama',
    providerId: 'local-ollama',
    maxOutputTokens: 8192,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    tier: 'local',
  },
  {
    id: 'qwen3-coder:30b',
    name: 'Qwen3-Coder 30B',
    description: 'Coding-heavy local model; slower but stronger for agentic work',
    providerKind: 'ollama',
    providerId: 'local-ollama',
    maxOutputTokens: 16384,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    tier: 'local',
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    description: 'OpenAI coding and long-context model',
    providerKind: 'openai',
    providerId: 'openai',
    maxOutputTokens: 32768,
    inputPricePerMToken: 2,
    outputPricePerMToken: 8,
    tier: 'pro',
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic model for coding and tool use',
    providerKind: 'anthropic',
    providerId: 'anthropic',
    maxOutputTokens: 8192,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    tier: 'pro',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Gemini via API key or Vertex AI',
    providerKind: 'vertex',
    providerId: 'vertex-ai',
    maxOutputTokens: 65536,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    tier: 'fast',
  },
];

export function getModel(id: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function getDefaultModel(): ModelInfo {
  return MODEL_REGISTRY.find((m) => m.default) || MODEL_REGISTRY[0];
}

export interface UsageRecord {
  id: string;
  model: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  duration: number;
  type: 'chat' | 'agent';
  project?: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const info = getModel(model);
  if (!info) return 0;
  return (inputTokens / 1_000_000) * info.inputPricePerMToken +
         (outputTokens / 1_000_000) * info.outputPricePerMToken;
}
