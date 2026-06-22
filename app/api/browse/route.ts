/* OrbitCode — Browse Directories API Route */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const dirPath = searchParams.get('path');

  // If no path provided, return system roots & common locations
  if (!dirPath) {
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    
    const locations: Array<{ name: string; path: string; type: string }> = [];

    // Home directory
    locations.push({ name: 'Home', path: home, type: 'home' });

    // Desktop
    locations.push({ name: 'Desktop', path: path.join(/* turbopackIgnore: true */ home, 'Desktop'), type: 'desktop' });

    // Common dev folders
    const devFolders = ['projects', 'Projects', 'dev', 'Development', 'repos', 'code', 'workspace', 'src'];
    for (const folder of devFolders) {
      const p = path.join(/* turbopackIgnore: true */ home, folder);
      try {
        await fs.access(/* turbopackIgnore: true */ p);
        locations.push({ name: folder, path: p, type: 'dev' });
      } catch { /* doesn't exist */ }
    }

    // Windows drives
    if (isWin) {
      const drives = ['C:', 'D:', 'E:', 'F:'];
      for (const drive of drives) {
        try {
          await fs.access(/* turbopackIgnore: true */ drive + '\\');
          locations.push({ name: `${drive}\\`, path: `${drive}\\`, type: 'drive' });
        } catch { /* not available */ }
      }
    } else {
      locations.push({ name: '/', path: '/', type: 'drive' });
    }

    return NextResponse.json({ locations });
  }

  // List directories in the given path
  try {
    const resolved = path.resolve(/* turbopackIgnore: true */ dirPath);
    const entries = await fs.readdir(/* turbopackIgnore: true */ resolved, { withFileTypes: true });
    
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        name: e.name,
        path: path.join(/* turbopackIgnore: true */ resolved, e.name).replace(/\\/g, '/'),
      }));

    const parent = path.dirname(/* turbopackIgnore: true */ resolved);
    
    return NextResponse.json({
      current: resolved.replace(/\\/g, '/'),
      parent: parent !== resolved ? parent.replace(/\\/g, '/') : null,
      directories: dirs,
    });
  } catch {
    return NextResponse.json({ error: 'Cannot access directory' }, { status: 404 });
  }
}
