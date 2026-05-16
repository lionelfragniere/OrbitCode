/* OrbitCode — Artifacts API
 * GET: List artifacts for a project
 * POST: Create a new artifact
 * DELETE: Remove an artifact
 * Storage: ~/.orbitcode/artifacts/<project-hash>/
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const ARTIFACTS_BASE = path.join(os.homedir(), '.orbitcode', 'artifacts');

function getProjectDir(project: string): string {
  const hash = crypto.createHash('sha256').update(project).digest('hex').substring(0, 16);
  return path.join(ARTIFACTS_BASE, hash);
}

export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get('project');
  if (!project) return NextResponse.json({ error: 'project required' }, { status: 400 });

  const dir = getProjectDir(project);
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const artifacts = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = await fs.readFile(path.join(dir, file), 'utf-8');
        artifacts.push(JSON.parse(data));
      } catch { /* skip */ }
    }
    // Sort by date descending
    artifacts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return NextResponse.json({ artifacts });
  } catch (err) {
    return NextResponse.json({ artifacts: [], error: String(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const artifact = await req.json();
    if (!artifact.project) return NextResponse.json({ error: 'project required' }, { status: 400 });

    artifact.id = artifact.id || `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    artifact.createdAt = artifact.createdAt || Date.now();
    artifact.updatedAt = Date.now();

    const dir = getProjectDir(artifact.project);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${artifact.id}.json`), JSON.stringify(artifact, null, 2));

    return NextResponse.json({ success: true, id: artifact.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const project = req.nextUrl.searchParams.get('project');
  if (!id || !project) return NextResponse.json({ error: 'id and project required' }, { status: 400 });

  try {
    const dir = getProjectDir(project);
    await fs.unlink(path.join(dir, `${id}.json`));
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }
}
