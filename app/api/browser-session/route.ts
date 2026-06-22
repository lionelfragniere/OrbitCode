/* OrbitCode — Browser Session API
 * GET:  Return current browser session state
 * POST: Control actions (pause, resume, stop)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveBrowserSession, controlBrowserSession } from '@/lib/agent/browserRunner';

export async function GET() {
  const session = getActiveBrowserSession();
  if (!session) {
    return NextResponse.json({ active: false, session: null });
  }

  // Return session state without full screenshot data to keep response small
  // Client can request individual screenshots separately
  return NextResponse.json({
    active: session.status === 'running' || session.status === 'paused',
    session: {
      sessionId: session.sessionId,
      status: session.status,
      currentUrl: session.currentUrl,
      currentStep: session.currentStep,
      stepCount: session.stepCount,
      steps: session.steps.map(s => ({
        id: s.id,
        action: s.action,
        description: s.description,
        url: s.url,
        timestamp: s.timestamp,
        hasScreenshot: !!s.screenshot,
        error: s.error,
      })),
      logs: session.logs.slice(-50),
      errors: session.errors.slice(-20),
      screenshotCount: session.screenshots.length,
      // Send last screenshot for live preview
      lastScreenshot: session.screenshots.length > 0
        ? session.screenshots[session.screenshots.length - 1]
        : null,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    },
  });
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
