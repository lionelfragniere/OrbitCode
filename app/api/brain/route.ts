/* OrbitCode — Project Brain API
 * GET: Load brain for a project
 * PUT: Save/update brain
 * Storage: ~/.orbitcode/brains/<project-hash>/brain.json
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const BRAINS_DIR = path.join(os.homedir(), '.orbitcode', 'brains');

function getProjectHash(projectPath: string): string {
  return crypto.createHash('sha256').update(projectPath).digest('hex').substring(0, 16);
}

function getBrainPath(projectPath: string): string {
  const hash = getProjectHash(projectPath);
  return path.join(BRAINS_DIR, hash, 'brain.json');
}

export async function GET(req: NextRequest) {
  const projectPath = req.nextUrl.searchParams.get('projectPath')
    || req.nextUrl.searchParams.get('project');
  if (!projectPath) {
    return NextResponse.json({
      error: 'projectPath query parameter required. Example: /api/brain?projectPath=/path/to/project',
    }, { status: 400 });
  }

  const brainPath = getBrainPath(projectPath);
  try {
    const data = await fs.readFile(brainPath, 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json({ entries: [], projectPath, message: 'No brain data yet for this project' });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const brain = await req.json();
    if (!brain.projectPath) return NextResponse.json({ error: 'projectPath required' }, { status: 400 });

    const brainPath = getBrainPath(brain.projectPath);
    await fs.mkdir(path.dirname(brainPath), { recursive: true });
    await fs.writeFile(brainPath, JSON.stringify(brain, null, 2));

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
