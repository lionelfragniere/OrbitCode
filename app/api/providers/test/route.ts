import { NextRequest, NextResponse } from 'next/server';
import { generateAiText } from '@/lib/ai/providerClient';
import { resolveModelConfig } from '@/lib/ai/providerStore';

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const config = await resolveModelConfig({
      providerId: body.providerId,
      providerKind: body.providerKind,
      model: body.model,
      selectedModel: body.selectedModel,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      headers: body.headers,
      gcpProject: body.gcpProject,
      gcpRegion: body.gcpRegion,
      temperature: 0,
      maxOutputTokens: 64,
    });
    const text = await generateAiText(
      config,
      [{ role: 'user', content: 'Reply with exactly: OrbitCode provider OK' }],
      'You are a connection test. Keep the response short.',
    );
    return NextResponse.json({ ok: true, providerKind: config.providerKind, model: config.model, text });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Provider test failed',
    }, { status: 400 });
  }
}
