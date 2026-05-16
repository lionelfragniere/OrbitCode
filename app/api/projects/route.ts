/* OrbitCode — Projects API Route
 * Manages projects within the user's workspace directory.
 * Each project = a folder on disk, optionally a git repo.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

interface ProjectInfo {
  name: string;
  path: string;
  isGitRepo: boolean;
  branch?: string;
  remote?: string;
  lastModified: number;
  fileCount: number;
}

function runGitSilent(args: string, cwd: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

// GET: List projects in workspace
export async function GET(request: NextRequest) {
  const workspacePath = request.nextUrl.searchParams.get('workspace');
  if (!workspacePath) {
    return NextResponse.json({ error: 'workspace param required' }, { status: 400 });
  }

  try {
    await fs.access(workspacePath);
  } catch {
    return NextResponse.json({ error: 'Workspace directory not accessible' }, { status: 404 });
  }

  try {
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const projectPath = path.join(workspacePath, entry.name);
      const stat = await fs.stat(projectPath);

      // Check if it's a git repo
      const branch = runGitSilent('rev-parse --abbrev-ref HEAD', projectPath);
      const remote = runGitSilent('remote get-url origin', projectPath);

      // Count files (shallow)
      let fileCount = 0;
      try {
        const children = await fs.readdir(projectPath);
        fileCount = children.filter((c) => !c.startsWith('.') && c !== 'node_modules').length;
      } catch { /* ignore */ }

      projects.push({
        name: entry.name,
        path: projectPath.replace(/\\/g, '/'),
        isGitRepo: branch !== null,
        branch: branch || undefined,
        remote: remote || undefined,
        lastModified: stat.mtimeMs,
        fileCount,
      });
    }

    // Sort by last modified (most recent first)
    projects.sort((a, b) => b.lastModified - a.lastModified);

    return NextResponse.json({ projects });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list projects';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST: Create new project
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { workspace, name, initGit, gitRemote } = body as {
    workspace: string;
    name: string;
    initGit?: boolean;
    gitRemote?: string;
  };

  if (!workspace || !name) {
    return NextResponse.json({ error: 'workspace and name required' }, { status: 400 });
  }

  // Sanitize project name
  const safeName = name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
  if (!safeName) {
    return NextResponse.json({ error: 'Invalid project name' }, { status: 400 });
  }

  const projectPath = path.join(workspace, safeName);

  try {
    // Check if already exists
    try {
      await fs.access(projectPath);
      return NextResponse.json({ error: 'Project already exists' }, { status: 409 });
    } catch { /* Good — doesn't exist */ }

    // Create directory
    await fs.mkdir(projectPath, { recursive: true });

    // Create a basic README
    await fs.writeFile(
      path.join(projectPath, 'README.md'),
      `# ${safeName}\n\nCreated with OrbitCode.\n`,
      'utf-8'
    );

    // Initialize git if requested
    if (initGit !== false) {
      runGitSilent('init', projectPath);
      runGitSilent('add .', projectPath);
      runGitSilent('commit -m "Initial commit — created with OrbitCode"', projectPath);

      // Add remote if provided
      if (gitRemote) {
        runGitSilent(`remote add origin ${gitRemote}`, projectPath);
      }
    }

    return NextResponse.json({
      success: true,
      project: {
        name: safeName,
        path: projectPath.replace(/\\/g, '/'),
        isGitRepo: initGit !== false,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create project';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
