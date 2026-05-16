import { GoogleGenAI } from '@google/genai';
import { readSecret } from '@/lib/server/secrets';
import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiMessage,
  AiModelConfig,
  AiProviderClient,
  AiToolCall,
} from './types';
import { toAnthropicTools, toGeminiFunctionDeclarations, toOpenAiTools } from './toolSchemas';

type Json = Record<string, unknown>;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseJsonObject(value: unknown): Json {
  if (!value) return {};
  if (typeof value === 'object') return value as Json;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed as Json : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function resolveApiKey(config: AiModelConfig): Promise<string | undefined> {
  return config.apiKey || readSecret(config.apiKeyRef);
}

async function fetchJson(url: string, init: RequestInit): Promise<Json> {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed: Json = {};
  try {
    parsed = text ? JSON.parse(text) as Json : {};
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const message = asText(parsed.error) || asText((parsed.error as Json | undefined)?.message) || text || response.statusText;
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return parsed;
}

function normalizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  return (baseUrl || fallback).replace(/\/$/, '');
}

function openAiMessages(messages: AiMessage[]): Json[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: message.content || '',
      };
    }
    const out: Json = {
      role: message.role,
      content: message.content || '',
    };
    if (message.toolCalls?.length) {
      out.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args || {}),
        },
      }));
    }
    return out;
  });
}

function responseInput(messages: AiMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content || '',
      });
    } else {
      if (message.content) {
        input.push({
          role: message.role,
          content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }],
        });
      }
      for (const call of message.toolCalls || []) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args || {}),
        });
      }
    }
  }
  return input;
}

class OpenAiResponsesClient implements AiProviderClient {
  constructor(private readonly config: AiModelConfig) {}

  async complete(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const apiKey = await resolveApiKey(this.config);
    if (!apiKey) throw new Error('OpenAI API key is not configured.');
    const baseUrl = normalizeBaseUrl(this.config.baseUrl, 'https://api.openai.com/v1');
    const body: Json = {
      model: this.config.model,
      input: responseInput(request.messages),
      instructions: request.systemInstruction,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_output_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
    };
    if (request.tools?.length) body.tools = toOpenAiTools(request.tools);

    const json = await fetchJson(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...this.config.headers,
      },
      body: JSON.stringify(body),
    });

    const output = Array.isArray(json.output) ? json.output as Json[] : [];
    const text: string[] = [];
    const toolCalls: AiToolCall[] = [];
    for (const item of output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content as Json[]) {
          if (part.type === 'output_text' || part.type === 'text') text.push(asText(part.text));
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({
          id: asText(item.call_id) || asText(item.id) || `call_${toolCalls.length}`,
          name: asText(item.name),
          args: parseJsonObject(item.arguments),
        });
      }
    }

    return {
      text: text.join(''),
      toolCalls,
      usage: {
        inputTokens: typeof (json.usage as Json | undefined)?.input_tokens === 'number' ? (json.usage as Json).input_tokens as number : undefined,
        outputTokens: typeof (json.usage as Json | undefined)?.output_tokens === 'number' ? (json.usage as Json).output_tokens as number : undefined,
      },
    };
  }
}

class OpenAiCompatibleClient implements AiProviderClient {
  constructor(private readonly config: AiModelConfig) {}

  async complete(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const baseUrl = normalizeBaseUrl(this.config.baseUrl, 'http://localhost:11434/v1');
    const apiKey = this.config.providerKind === 'ollama'
      ? 'ollama'
      : await resolveApiKey(this.config);
    if (this.config.providerKind !== 'ollama' && !apiKey) {
      throw new Error('API key is not configured for this OpenAI-compatible provider.');
    }

    const messages = request.systemInstruction
      ? [{ role: 'system', content: request.systemInstruction }, ...openAiMessages(request.messages)]
      : openAiMessages(request.messages);

    const body: Json = {
      model: this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
    };
    if (request.tools?.length) body.tools = toOpenAiTools(request.tools);

    const json = await fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...this.config.headers,
      },
      body: JSON.stringify(body),
    });

    const choice = Array.isArray(json.choices) ? json.choices[0] as Json | undefined : undefined;
    const message = choice?.message as Json | undefined;
    const toolCalls = Array.isArray(message?.tool_calls)
      ? (message?.tool_calls as Json[]).map((call, index) => {
          const fn = call.function as Json | undefined;
          return {
            id: asText(call.id) || `call_${index}`,
            name: asText(fn?.name),
            args: parseJsonObject(fn?.arguments),
          };
        })
      : [];

    const usage = json.usage as Json | undefined;
    return {
      text: asText(message?.content),
      toolCalls,
      usage: {
        inputTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens as number : undefined,
        outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens as number : undefined,
      },
    };
  }
}

class AnthropicClient implements AiProviderClient {
  constructor(private readonly config: AiModelConfig) {}

  async complete(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const apiKey = await resolveApiKey(this.config);
    if (!apiKey) throw new Error('Anthropic API key is not configured.');
    const baseUrl = normalizeBaseUrl(this.config.baseUrl, 'https://api.anthropic.com');
    const messages: Json[] = [];
    for (const message of request.messages) {
      if (message.role === 'tool') {
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content || '',
          }],
        });
      } else if (message.role === 'assistant' && message.toolCalls?.length) {
        const content: Json[] = [];
        if (message.content) content.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls) {
          content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
        }
        messages.push({ role: 'assistant', content });
      } else {
        messages.push({ role: message.role, content: message.content || '' });
      }
    }

    const body: Json = {
      model: this.config.model,
      max_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens ?? 4096,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      system: request.systemInstruction,
      messages,
    };
    if (request.tools?.length) body.tools = toAnthropicTools(request.tools);

    const json = await fetchJson(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...this.config.headers,
      },
      body: JSON.stringify(body),
    });

    const content = Array.isArray(json.content) ? json.content as Json[] : [];
    const text: string[] = [];
    const toolCalls: AiToolCall[] = [];
    for (const part of content) {
      if (part.type === 'text') text.push(asText(part.text));
      if (part.type === 'tool_use') {
        toolCalls.push({
          id: asText(part.id) || `call_${toolCalls.length}`,
          name: asText(part.name),
          args: parseJsonObject(part.input),
        });
      }
    }
    const usage = json.usage as Json | undefined;
    return {
      text: text.join(''),
      toolCalls,
      usage: {
        inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens as number : undefined,
        outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens as number : undefined,
      },
    };
  }
}

function geminiContents(messages: AiMessage[]): Json[] {
  const contents: Json[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: message.toolName || 'tool',
            response: { result: message.content || '' },
          },
        }],
      });
    } else if (message.role === 'assistant') {
      const parts: Json[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls || []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      contents.push({ role: 'model', parts });
    } else {
      contents.push({ role: 'user', parts: [{ text: message.content || '' }] });
    }
  }
  return contents;
}

class GeminiClient implements AiProviderClient {
  constructor(private readonly config: AiModelConfig) {}

  async complete(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const apiKey = await resolveApiKey(this.config);
    if (this.config.providerKind === 'gemini' && !apiKey) throw new Error('Gemini API key is not configured.');
    if (this.config.providerKind === 'vertex' && !this.config.gcpProject) throw new Error('Vertex AI project is not configured.');

    const client = this.config.providerKind === 'vertex'
      ? new GoogleGenAI({
          vertexai: true,
          project: this.config.gcpProject,
          location: this.config.gcpRegion || 'us-central1',
        })
      : new GoogleGenAI({ apiKey });

    const response = await client.models.generateContent({
      model: this.config.model,
      contents: geminiContents(request.messages),
      config: {
        systemInstruction: request.systemInstruction,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        maxOutputTokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
        tools: request.tools?.length ? [{ functionDeclarations: toGeminiFunctionDeclarations(request.tools) }] : undefined,
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((part) => part.text).map((part) => part.text).join('');
    const toolCalls = (response.functionCalls || []).map((call, index) => ({
      id: `call_${index}_${call.name || 'tool'}`,
      name: call.name || '',
      args: (call.args || {}) as Json,
    })).filter((call) => call.name);

    return { text, toolCalls };
  }
}

export function createAiProviderClient(config: AiModelConfig): AiProviderClient {
  if (config.providerKind === 'openai') return new OpenAiResponsesClient(config);
  if (config.providerKind === 'anthropic') return new AnthropicClient(config);
  if (config.providerKind === 'gemini' || config.providerKind === 'vertex') return new GeminiClient(config);
  return new OpenAiCompatibleClient(config);
}

export async function generateAiText(
  config: AiModelConfig,
  messages: Array<{ role: string; content: string }>,
  systemInstruction?: string,
): Promise<string> {
  const client = createAiProviderClient(config);
  const response = await client.complete({
    messages: messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    })),
    systemInstruction,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
  });
  return response.text;
}
