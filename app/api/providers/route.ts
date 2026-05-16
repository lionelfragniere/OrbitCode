import { NextRequest, NextResponse } from 'next/server';
import { readProviderStore, selectProvider, upsertProviderProfile } from '@/lib/ai/providerStore';

function publicStore(store: Awaited<ReturnType<typeof readProviderStore>>) {
  return {
    ...store,
    providers: store.providers.map(({ apiKeyRef, ...provider }) => ({
      ...provider,
      hasApiKey: Boolean(apiKeyRef),
    })),
  };
}

export async function GET() {
  return NextResponse.json(publicStore(await readProviderStore()));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (body.action === 'select') {
    return NextResponse.json(publicStore(await selectProvider(body.providerId)));
  }
  const store = await upsertProviderProfile(body);
  return NextResponse.json(publicStore(store));
}
