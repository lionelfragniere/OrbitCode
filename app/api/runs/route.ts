/* OrbitCode — Runs API Route
 * Handles retrieving past test and diagnosis runs from disk.
 *
 * GET /api/runs?projectFolder=...
 * - Returns a list of all historical runs for the project
 *
 * GET /api/runs?projectFolder=...&runId=...
 * - Returns details for a specific run including manifest and report
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getLegacyProjectRunsDir, getProjectRunsDir, legacyProjectDataRelative, projectDataRelative } from '@/lib/server/appPaths';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectFolder = searchParams.get('projectFolder');
  const runId = searchParams.get('runId');

  if (!projectFolder) {
    return NextResponse.json({ error: 'projectFolder is required' }, { status: 400 });
  }

  let runsDir = getProjectRunsDir(projectFolder);
  let relRoot = projectDataRelative('runs');

  try {
    await fs.access(runsDir);
  } catch {
    runsDir = getLegacyProjectRunsDir(projectFolder);
    relRoot = legacyProjectDataRelative('runs');
    try {
      await fs.access(runsDir);
    } catch {
      return NextResponse.json(runId ? { error: 'Run not found' } : { runs: [] }, { status: runId ? 404 : 200 });
    }
  }

  if (runId) {
    // Return specific run details
    const runFolder = path.join(runsDir, runId);
    
    // Prevent path traversal
    if (!runFolder.startsWith(runsDir)) {
      return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
    }

    try {
      let manifest = null;
      let report = null;

      try {
        const manifestData = await fs.readFile(path.join(runFolder, 'manifest.json'), 'utf-8');
        manifest = JSON.parse(manifestData);
      } catch {}

      try {
        report = await fs.readFile(path.join(runFolder, 'report.md'), 'utf-8');
      } catch {}

      // Get screenshot URIs
      let screenshots: string[] = [];
      try {
        const screens = await fs.readdir(path.join(runFolder, 'screenshots'));
        screenshots = screens.map(s => `/api/preview?projectFolder=${encodeURIComponent(projectFolder)}&filePath=${encodeURIComponent(`${relRoot}/${runId}/screenshots/${s}`)}`);
      } catch {}

      // Get raw logs
      let rawLogs = '';
      try {
        rawLogs = await fs.readFile(path.join(runFolder, 'browser_logs.txt'), 'utf-8');
      } catch {}

      // Get video URI
      let videoUrl: string | null = null;
      try {
        const videos = await fs.readdir(path.join(runFolder, 'video'));
        if (videos.length > 0) {
          videoUrl = `/api/preview?projectFolder=${encodeURIComponent(projectFolder)}&filePath=${encodeURIComponent(`${relRoot}/${runId}/video/${videos[0]}`)}`;
        }
      } catch {}

      return NextResponse.json({
        id: runId,
        manifest,
        report,
        screenshots,
        rawLogs,
        videoUrl
      });
    } catch {
      return NextResponse.json({ error: 'Run data could not be parsed' }, { status: 500 });
    }
  }

  // Otherwise list all runs
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    const runPromises = entries.filter(e => e.isDirectory()).map(async (entry) => {
      const runFolder = path.join(runsDir, entry.name);
      
      let type: 'browser' | 'diagnosis' | 'task' = 'task';
      let timestamp = Date.now();
      let status = 'unknown';
      let stepCount = 0;
      let intent = '';
      let verdict = '';
      let complexity = '';

      // Check if it has a manifest
      try {
        const manifestData = await fs.readFile(path.join(runFolder, 'manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestData);
        timestamp = manifest.startedAt || manifest.completedAt || timestamp;
        status = manifest.status || status;
        stepCount = manifest.stepCount || manifest.stages?.length || 0;
        
        // Determine run type from manifest shape
        if (manifest.intent && manifest.verdict) {
          // Orchestrator task run (has intent, verdict, complexity)
          type = 'task';
          intent = manifest.intent;
          verdict = manifest.verdict;
          complexity = manifest.complexity || '';
        } else if (manifest.sessionId) {
          // Browser session run
          type = 'browser';
        }
      } catch {}

      // Check if it has a report.md (diagnosis) 
      try {
        const stat = await fs.stat(path.join(runFolder, 'report.md'));
        if (type === 'task' && !intent) {
            type = 'diagnosis';
        }
        if (!timestamp || timestamp === Date.now()) {
          timestamp = stat.mtimeMs;
        }
      } catch {}

      return {
        id: entry.name,
        type,
        timestamp,
        status,
        stepCount,
        intent: intent ? intent.substring(0, 100) : undefined,
        verdict: verdict || undefined,
        complexity: complexity || undefined,
      };
    });

    const runs = await Promise.all(runPromises);
    
    // Sort descending by timestamp
    runs.sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json({ runs });
  } catch {
    return NextResponse.json({ error: 'Failed to list runs' }, { status: 500 });
  }
}
