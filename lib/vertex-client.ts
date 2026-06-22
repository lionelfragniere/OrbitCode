/* OrbitCode — Vertex AI Client (google-genai SDK with Vertex AI backend)
 * 
 * SECURITY: NO API KEYS. Uses Vertex AI + Application Default Credentials (ADC).
 * Authentication via Service Account or `gcloud auth application-default login`.
 * 
 * Model configurable via GEMINI_MODEL env var (default: gemini-2.5-flash).
 */
import { GoogleGenAI } from '@google/genai';
import { PONYTAIL_SYSTEM_INSTRUCTION } from '@/lib/agent/ponytail';

const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Get the model ID from environment or default.
 */
export function getModelId(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

/**
 * Creates a Vertex AI-configured GoogleGenAI client.
 * Uses Application Default Credentials (ADC) via IAM.
 * User must run `gcloud auth application-default login` before using.
 */
export function createVertexClient(project: string, location: string = 'us-central1') {
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
}

/**
 * Get a Vertex AI client using persisted config.
 * Falls back to environment variables or defaults.
 */
export function getVertexClient(): { client: GoogleGenAI; modelId: string } | null {
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(require('os').homedir(), '.orbitcode', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const project = config.gcpProject || process.env.GCP_PROJECT;
    const region = config.gcpRegion || process.env.GCP_REGION || 'us-central1';
    if (!project) return null;
    return {
      client: createVertexClient(project, region),
      modelId: getModelId(),
    };
  } catch {
    return null;
  }
}

/**
 * Build the system instruction string.
 */
export function buildSystemInstruction(customInstruction: string, editorContext?: {
  filePath?: string;
  language?: string;
  selectedText?: string;
}): string {
  let instruction = `${customInstruction}\n\n${PONYTAIL_SYSTEM_INSTRUCTION}`;

  if (editorContext) {
    instruction += '\n\n--- Current Context ---';
    if (editorContext.filePath) {
      instruction += `\nFile: ${editorContext.filePath}`;
    }
    if (editorContext.language) {
      instruction += `\nLanguage: ${editorContext.language}`;
    }
    if (editorContext.selectedText) {
      instruction += `\nSelected code:\n\`\`\`\n${editorContext.selectedText}\n\`\`\``;
    }
  }

  return instruction;
}

/**
 * Stream a chat response from Gemini via Vertex AI.
 * Model is configurable via GEMINI_MODEL env var.
 * Returns an async generator that yields text chunks.
 */
export async function* streamChat(
  client: GoogleGenAI,
  messages: Array<{ role: string; content: string }>,
  systemInstruction: string,
  options: {
    temperature?: number;
    maxOutputTokens?: number;
    fileContent?: string;
    filePath?: string;
  } = {}
): AsyncGenerator<string, void, unknown> {
  const modelId = getModelId();

  // Build contents array for the API
  const contents = messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // If there's file content, prepend it to the first user message context
  if (options.fileContent && contents.length > 0) {
    const lastUserMsg = contents[contents.length - 1];
    if (lastUserMsg.role === 'user') {
      const fileContext = `\n\n[Current file: ${options.filePath || 'unknown'}]\n\`\`\`\n${options.fileContent}\n\`\`\`\n\n`;
      lastUserMsg.parts[0].text = fileContext + lastUserMsg.parts[0].text;
    }
  }

  const response = await client.models.generateContentStream({
    model: modelId,
    contents,
    config: {
      systemInstruction,
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 65536,
    },
  });

  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}
