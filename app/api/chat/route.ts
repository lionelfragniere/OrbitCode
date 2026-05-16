/* OrbitCode - Chat API Route (SSE streaming) */
import { NextRequest } from 'next/server';
import { buildSystemInstruction } from '@/lib/vertex-client';
import { generateAiText } from '@/lib/ai/providerClient';
import { resolveModelConfig } from '@/lib/ai/providerStore';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      messages,
      settings,
      editorContext,
    } = body as {
      messages: Array<{ role: string; content: string }>;
      settings: {
        providerId?: string;
        providerKind?: string;
        selectedProviderId?: string;
        selectedModel?: string;
        model?: string;
        baseUrl?: string;
        headers?: Record<string, string>;
        gcpProject?: string;
        gcpRegion?: string;
        temperature: number;
        maxTokens: number;
        systemInstruction: string;
        beginnerMode?: boolean;
      };
      editorContext?: {
        filePath?: string;
        language?: string;
        content?: string;
        selectedText?: string;
      };
    };

    const aiConfig = await resolveModelConfig({
      providerId: settings.providerId || settings.selectedProviderId,
      providerKind: settings.providerKind as never,
      selectedModel: settings.selectedModel || settings.model,
      baseUrl: settings.baseUrl,
      headers: settings.headers,
      gcpProject: settings.gcpProject,
      gcpRegion: settings.gcpRegion,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxTokens,
    });

    const systemInstruction = buildSystemInstruction(
      `${settings.systemInstruction}${settings.beginnerMode ? '\n\nBeginner mode: explain in plain language, keep code-heavy detail hidden unless the user asks, and give one clear next step.' : ''}`,
      editorContext,
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const text = await generateAiText(
            aiConfig,
            messages.map((message) => {
              if (message.role === 'assistant') return message;
              if (message.role === 'user' && editorContext?.content && message === messages[messages.length - 1]) {
                const fileContext = `\n\n[Current file: ${editorContext.filePath || 'unknown'}]\n\`\`\`\n${editorContext.content}\n\`\`\`\n\n`;
                return { ...message, content: fileContext + message.content };
              }
              return message;
            }),
            systemInstruction,
          );
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', content: '' })}\n\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown provider error';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: message })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
