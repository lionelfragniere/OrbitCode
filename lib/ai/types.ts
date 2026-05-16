export type AiProviderKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'vertex'
  | 'ollama'
  | 'openai-compatible';

export interface AiModelConfig {
  providerId?: string;
  providerKind: AiProviderKind;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  baseUrl?: string;
  apiKeyRef?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  gcpProject?: string;
  gcpRegion?: string;
}

export interface AiProviderProfile {
  id: string;
  name: string;
  kind: AiProviderKind;
  enabled: boolean;
  defaultModel: string;
  baseUrl?: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  gcpProject?: string;
  gcpRegion?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface AiToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiGenerateRequest {
  messages: AiMessage[];
  systemInstruction?: string;
  tools?: AiToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiGenerateResponse {
  text: string;
  toolCalls: AiToolCall[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AiProviderClient {
  complete(request: AiGenerateRequest): Promise<AiGenerateResponse>;
}
