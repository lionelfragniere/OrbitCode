/* OrbitCode - Chat History API */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { LEGACY_PROJECT_DATA_DIR, PROJECT_DATA_DIR } from '@/lib/orbitcode';
import { getLegacyProjectDataDir, getProjectDataDir } from '@/lib/server/appPaths';

function getChatFile(projectFolder: string) {
  return path.join(getProjectDataDir(projectFolder), 'chat-history.json');
}

function getLegacyChatFile(projectFolder: string) {
  return path.join(getLegacyProjectDataDir(projectFolder), 'chat-history.json');
}

async function ensureIgnored(projectFolder: string) {
  const gitignore = path.join(projectFolder, '.gitignore');
  try {
    const content = await fs.readFile(gitignore, 'utf-8').catch(() => '');
    const lines = [];
    if (!content.includes(PROJECT_DATA_DIR)) lines.push(`${PROJECT_DATA_DIR}/`);
    if (!content.includes(LEGACY_PROJECT_DATA_DIR)) lines.push(`${LEGACY_PROJECT_DATA_DIR}/`);
    if (lines.length > 0) {
      const prefix = content && !content.endsWith('\n') ? '\n' : '';
      await fs.writeFile(gitignore, `${content}${prefix}${lines.join('\n')}\n`);
    }
  } catch {
    // Ignore gitignore failures; chat history is still local project state.
  }
}

export async function GET(request: NextRequest) {
  const projectFolder = request.nextUrl.searchParams.get('projectFolder');
  if (!projectFolder) return NextResponse.json({ error: 'projectFolder required' }, { status: 400 });

  try {
    let raw: string;
    try {
      raw = await fs.readFile(getChatFile(projectFolder), 'utf-8');
    } catch {
      raw = await fs.readFile(getLegacyChatFile(projectFolder), 'utf-8');
    }
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { projectFolder, messages } = body;
  if (!projectFolder) return NextResponse.json({ error: 'projectFolder required' }, { status: 400 });

  const file = getChatFile(projectFolder);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await ensureIgnored(projectFolder);
  await fs.writeFile(file, JSON.stringify({ messages: messages || [], updatedAt: Date.now() }, null, 2), 'utf-8');
  return NextResponse.json({ success: true });
}
