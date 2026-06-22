/* OrbitCode — File System API Routes */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Security: prevent path traversal
function sanitizePath(basePath: string, requestedPath: string): string | null {
  const root = path.resolve(/* turbopackIgnore: true */ basePath);
  const resolved = path.resolve(/* turbopackIgnore: true */ root, requestedPath);
  const normalize = (p: string) => path.resolve(/* turbopackIgnore: true */ p).replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = normalize(root);
  const normalizedTarget = normalize(resolved);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return null;
  }
  return resolved;
}

// Ignored directories/files
const IGNORED = new Set([
  'node_modules', '.git', '.next', '__pycache__', '.DS_Store',
  'dist', 'build', '.cache', '.vscode', '.idea', 'coverage',
  '.env', '.env.local', '.env.production',
]);

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  size?: number;
}

async function buildFileTree(dirPath: string, basePath: string, depth: number = 0): Promise<FileTreeNode[]> {
  if (depth > 6) return []; // Limit recursion depth
  
  try {
    const entries = await fs.readdir(/* turbopackIgnore: true */ dirPath, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    // Sort: directories first, then alphabetically
    const sorted = entries
      .filter((e) => !IGNORED.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of sorted) {
      const fullPath = path.join(/* turbopackIgnore: true */ dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        const children = await buildFileTree(fullPath, basePath, depth + 1);
        nodes.push({
          name: entry.name,
          path: relativePath,
          isDirectory: true,
          children,
        });
      } else {
        const stat = await fs.stat(/* turbopackIgnore: true */ fullPath);
        nodes.push({
          name: entry.name,
          path: relativePath,
          isDirectory: false,
          size: stat.size,
        });
      }
    }

    return nodes;
  } catch {
    return [];
  }
}

// GET: Read file tree or single file content
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectFolder = searchParams.get('projectFolder');
  const filePath = searchParams.get('filePath');

  if (!projectFolder) {
    return NextResponse.json({ error: 'projectFolder is required' }, { status: 400 });
  }

  // If filePath provided, return file content
  if (filePath) {
    const safePath = sanitizePath(projectFolder, filePath);
    if (!safePath) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }
    try {
      const content = await fs.readFile(/* turbopackIgnore: true */ safePath, 'utf-8');
      return NextResponse.json({ content, path: filePath });
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
  }

  // Otherwise, return file tree
  try {
    const projectRoot = path.resolve(/* turbopackIgnore: true */ projectFolder);
    await fs.access(/* turbopackIgnore: true */ projectRoot);
    const tree = await buildFileTree(projectRoot, projectRoot);
    return NextResponse.json({ tree });
  } catch {
    return NextResponse.json({ error: 'Project folder not accessible' }, { status: 404 });
  }
}

// POST: Create file or folder
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectFolder, filePath, content, isDirectory } = body;

  if (!projectFolder || !filePath) {
    return NextResponse.json({ error: 'projectFolder and filePath are required' }, { status: 400 });
  }

  const safePath = sanitizePath(projectFolder, filePath);
  if (!safePath) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    if (isDirectory) {
      await fs.mkdir(/* turbopackIgnore: true */ safePath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(/* turbopackIgnore: true */ safePath), { recursive: true });
      await fs.writeFile(/* turbopackIgnore: true */ safePath, content || '', 'utf-8');
    }
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to create';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT: Update file content
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { projectFolder, filePath, content } = body;

  if (!projectFolder || !filePath) {
    return NextResponse.json({ error: 'projectFolder and filePath are required' }, { status: 400 });
  }

  const safePath = sanitizePath(projectFolder, filePath);
  if (!safePath) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    await fs.writeFile(/* turbopackIgnore: true */ safePath, content, 'utf-8');
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to save';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE: Delete file or folder
export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectFolder = searchParams.get('projectFolder');
  const filePath = searchParams.get('filePath');

  if (!projectFolder || !filePath) {
    return NextResponse.json({ error: 'projectFolder and filePath are required' }, { status: 400 });
  }

  const safePath = sanitizePath(projectFolder, filePath);
  if (!safePath) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    const stat = await fs.stat(/* turbopackIgnore: true */ safePath);
    if (stat.isDirectory()) {
      await fs.rm(/* turbopackIgnore: true */ safePath, { recursive: true });
    } else {
      await fs.unlink(/* turbopackIgnore: true */ safePath);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to delete';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
