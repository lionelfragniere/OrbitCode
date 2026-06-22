/* OrbitCode — Browser Session API
 * GET:  Return current browser session state
 * POST: Control actions (pause, resume, stop)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveBrowserSession, controlBrowserSession } from '@/lib/agent/browserRunner';
import { getProjectRunsDir } from '@/lib/server/appPaths';
import type { BrowserSessionState } from '@/lib/types';
import fs from 'fs/promises';
import path from 'path';

function compactScreenshot(value?: string) {
  if (!value || value.startsWith('data:')) return undefined;
  return value;
}

async function getLatestPersistedSession(projectFolder: string): Promise<BrowserSessionState | null> {
  try {
    const runsDir = getProjectRunsDir(projectFolder);
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    const manifests = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = path.join(runsDir, entry.name, 'manifest.json');
        try {
          const stat = await fs.stat(manifestPath);
          return { manifestPath, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      }));
    for (const item of manifests.filter(Boolean).sort((a, b) => b!.mtimeMs - a!.mtimeMs)) {
      const parsed = JSON.parse(await fs.readFile(item!.manifestPath, 'utf-8')) as Partial<BrowserSessionState>;
      if (parsed.sessionId && Array.isArray(parsed.steps)) return parsed as BrowserSessionState;
    }
  } catch {
    // No persisted browser run yet.
  }
  return null;
}

function sessionResponse(session: BrowserSessionState) {
  const steps = Array.isArray(session.steps) ? session.steps : [];
  const logs = Array.isArray(session.logs) ? session.logs : [];
  const errors = Array.isArray(session.errors) ? session.errors : [];
  const screenshots = Array.isArray(session.screenshots) ? session.screenshots : [];

  return {
    active: session.status === 'running' || session.status === 'paused',
    session: {
      sessionId: session.sessionId,
      status: session.status,
      currentUrl: session.currentUrl,
      currentStep: session.currentStep,
      stepCount: session.stepCount || steps.length,
      steps: steps.map(s => ({
        id: s.id,
        action: s.action,
        description: s.description,
        url: s.url,
        timestamp: s.timestamp,
        hasScreenshot: !!s.screenshot,
        screenshot: compactScreenshot(s.screenshot),
        error: s.error,
      })),
      logs: logs.slice(-50),
      errors: errors.slice(-20),
      screenshotCount: screenshots.length,
      // Send last screenshot for live preview
      lastScreenshot: screenshots.length > 0
        ? compactScreenshot(screenshots[screenshots.length - 1]) || null
        : null,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    },
  };
}

export async function GET(request: NextRequest) {
  const projectFolder = request.nextUrl.searchParams.get('projectFolder') || undefined;
  const session = getActiveBrowserSession(projectFolder) || (projectFolder ? await getLatestPersistedSession(projectFolder) : null);
  if (!session) {
    return NextResponse.json({ active: false, session: null });
  }

  // Return compact screenshot URLs, not inline image payloads.
  return NextResponse.json(sessionResponse(session));
}

export async function POST(request: NextRequest) {
  const { action } = await request.json();

  if (!action || !['pause', 'resume', 'stop'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Use: pause, resume, stop' }, { status: 400 });
  }

  const success = controlBrowserSession(action as 'pause' | 'resume' | 'stop');

  if (!success) {
    if (action === 'stop') {
      return NextResponse.json({ success: true, action, active: false });
    }
    return NextResponse.json({ error: 'No active browser session' }, { status: 404 });
  }

  return NextResponse.json({ success: true, action });
}
