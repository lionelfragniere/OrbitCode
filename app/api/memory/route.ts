import { NextRequest, NextResponse } from 'next/server';
import {
  getMemoryStatus,
  mempalaceInit,
  mempalaceMine,
  mempalaceNote,
  mempalaceSearch,
  mempalaceWakeUp,
} from '@/lib/memory/mempalace';

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action') || 'status';
  const projectFolder = request.nextUrl.searchParams.get('projectFolder') || undefined;

  try {
    if (action === 'status') return NextResponse.json(await getMemoryStatus());
    if (action === 'wake-up') return NextResponse.json({ context: await mempalaceWakeUp(projectFolder) });
    if (action === 'search') {
      const query = request.nextUrl.searchParams.get('query') || '';
      if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });
      return NextResponse.json({ results: await mempalaceSearch(query, projectFolder) });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Memory operation failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, projectFolder } = body;
  if (!projectFolder) return NextResponse.json({ error: 'projectFolder required' }, { status: 400 });
  try {
    if (action === 'init') return NextResponse.json({ output: await mempalaceInit(projectFolder) });
    if (action === 'mine') return NextResponse.json({ output: await mempalaceMine(projectFolder) });
    if (action === 'note') {
      return NextResponse.json({
        output: await mempalaceNote(projectFolder, body.title || 'OrbitCode note', body.content || '', body.room),
      });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Memory operation failed' }, { status: 500 });
  }
}
