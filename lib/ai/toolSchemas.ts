import type { FunctionDeclaration } from '@google/genai';
import { ALL_TOOLS } from '@/lib/agent/tools';
import type { AiToolDefinition } from './types';

type JsonObject = Record<string, unknown>;

function normalizeType(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const upper = value.toUpperCase();
  const map: Record<string, string> = {
    OBJECT: 'object',
    ARRAY: 'array',
    STRING: 'string',
    NUMBER: 'number',
    INTEGER: 'integer',
    BOOLEAN: 'boolean',
  };
  return map[upper] || value.toLowerCase();
}

export function normalizeSchema(schema: unknown): JsonObject {
  if (!schema || typeof schema !== 'object') return {};
  if (Array.isArray(schema)) return schema.map(normalizeSchema) as unknown as JsonObject;
  const input = schema as JsonObject;
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'type') {
      output[key] = normalizeType(value);
    } else if (Array.isArray(value)) {
      output[key] = value.map((item) => (typeof item === 'object' && item ? normalizeSchema(item) : item));
    } else if (value && typeof value === 'object') {
      output[key] = normalizeSchema(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function toolsFromGoogleDeclarations(declarations: FunctionDeclaration[] = ALL_TOOLS): AiToolDefinition[] {
  return declarations.map((tool) => ({
    name: tool.name || '',
    description: tool.description,
    inputSchema: normalizeSchema(tool.parameters || { type: 'object', properties: {} }),
  })).filter((tool) => tool.name);
}

export function toOpenAiTools(tools: AiToolDefinition[] = []): JsonObject[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema,
    },
  }));
}

export function toAnthropicTools(tools: AiToolDefinition[] = []): JsonObject[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    input_schema: tool.inputSchema,
  }));
}

export function toGeminiFunctionDeclarations(tools: AiToolDefinition[] = []): JsonObject[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    parameters: tool.inputSchema,
  }));
}
