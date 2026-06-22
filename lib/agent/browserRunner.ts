/* OrbitCode — Browser Runner (Enhanced)
 * Executes Playwright browser automation with step-by-step event streaming.
 * Each navigation, click, and type action emits a structured browser_step event
 * with a screenshot, enabling near-live observation in the Agent Browser panel.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Browser, ConsoleMessage, Page, Request } from 'playwright';
import type { ExecutorContext } from './executor';
import type { BrowserStep, BrowserSessionState } from '../types';

type PageGotoOptions = Parameters<Page['goto']>[1];
type PageClickOptions = Parameters<Page['click']>[1];
type PageFillOptions = Parameters<Page['fill']>[2];
type PageTypeOptions = Parameters<Page['type']>[2];
type PageWaitForSelectorOptions = Parameters<Page['waitForSelector']>[1];
type PageScreenshotOptions = Parameters<Page['screenshot']>[0];
type PageEvaluateFunction = Parameters<Page['evaluate']>[0];

// ════════════════════════════════════════════
//  Session state — keyed by project folder for isolation
// ════════════════════════════════════════════
const activeSessions: Map<string, BrowserSessionState> = new Map();

export function getActiveBrowserSession(projectId?: string): BrowserSessionState | null {
  if (projectId) return activeSessions.get(projectId) || null;
  // Fallback: return last active session
  const sessions = Array.from(activeSessions.values());
  return sessions[sessions.length - 1] || null;
}

export function controlBrowserSession(action: 'pause' | 'resume' | 'stop', projectId?: string): boolean {
  const session = projectId ? activeSessions.get(projectId) : getActiveBrowserSession();
  if (!session) return false;
  if (action === 'pause') { session.status = 'paused'; return true; }
  if (action === 'resume') { session.status = 'running'; return true; }
  if (action === 'stop') {
    if (session.status === 'running' || session.status === 'paused' || session.status === 'idle') {
      session.status = 'failed';
    }
    return true;
  }
  return false;
}

/** Clean up all browser sessions for a project */
export function cleanupProjectBrowserSessions(projectId: string): void {
  const session = activeSessions.get(projectId);
  if (session) {
    session.status = 'failed';
    activeSessions.delete(projectId);
  }
}


// ════════════════════════════════════════════
//  Persist Session State
// ════════════════════════════════════════════
async function flushSessionState(ctx: ExecutorContext, session: BrowserSessionState) {
  try {
    const runPath = path.join(/* turbopackIgnore: true */ ctx.projectFolder, '.orbitcode', 'runs', ctx.taskId);
    await fs.mkdir(/* turbopackIgnore: true */ runPath, { recursive: true });
    
    // Output serialized session
    await fs.writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ runPath, 'manifest.json'), JSON.stringify(session, null, 2), 'utf-8');
    
    // Output raw logs for convenience
    await fs.writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ runPath, 'browser_logs.txt'), session.logs.join('\n'), 'utf-8');
  } catch (err) {
    console.error('Failed to flush session state', err);
  }
}

// ════════════════════════════════════════════
//  Step ID generator
// ════════════════════════════════════════════
let stepCounter = 0;
function nextStepId(): string {
  return `bs_${Date.now()}_${++stepCounter}`;
}

// ════════════════════════════════════════════
//  Emit a browser step event
// ════════════════════════════════════════════
function emitBrowserStep(
  ctx: ExecutorContext,
  session: BrowserSessionState,
  step: BrowserStep,
) {
  session.steps.push(step);
  session.stepCount = session.steps.length;
  session.currentUrl = step.url;
  session.currentStep = step.description;

  if (step.screenshot) {
    session.screenshots.push(step.screenshot);
  }

  // Emit as structured SSE event for the UI
  flushSessionState(ctx, session).catch(() => {});

  ctx.onProgress?.({
    type: 'command_output',
    toolName: 'browser_step',
    detail: JSON.stringify({
      sessionId: session.sessionId,
      status: session.status,
      step: {
        id: step.id,
        action: step.action,
        description: step.description,
        url: step.url,
        timestamp: step.timestamp,
        screenshot: step.screenshot,
        error: step.error,
      },
      stepCount: session.stepCount,
      currentUrl: session.currentUrl,
    }),
  });

  // Also emit screenshot separately for TaskPanel inline rendering
  if (step.screenshot) {
    ctx.onProgress?.({
      type: 'command_output',
      toolName: 'browser_screenshot',
      detail: step.screenshot,
    });
  }
}

// ════════════════════════════════════════════
//  Main browser test executor
// ════════════════════════════════════════════
export async function executeBrowserTest(
  ctx: ExecutorContext,
  args: Record<string, unknown>
): Promise<string> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return 'ERROR: Playwright is not installed. Run: npm install playwright';
  }

  const scriptLines = (args.script as string) || '';

  if (!scriptLines) {
    return 'ERROR: No script provided.';
  }

  // Initialize session state
  const session: BrowserSessionState = {
    sessionId: `bsess_${Date.now()}`,
    status: 'running',
    currentUrl: 'about:blank',
    currentStep: 'Initializing browser...',
    stepCount: 0,
    steps: [],
    logs: [],
    errors: [],
    screenshots: [],
    startedAt: Date.now(),
  };
  activeSessions.set(ctx.projectFolder, session);

  // Emit session start
  ctx.onProgress?.({
    type: 'tool_start',
    toolName: 'browser_session',
    detail: JSON.stringify({ sessionId: session.sessionId, status: 'running' }),
  });

  let browser: Browser | undefined;
  try {
    const runPath = path.join(/* turbopackIgnore: true */ ctx.projectFolder, '.orbitcode', 'runs', ctx.taskId);
    const videoPath = path.join(/* turbopackIgnore: true */ runPath, 'video');
    await fs.mkdir(/* turbopackIgnore: true */ videoPath, { recursive: true }).catch(() => {});

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ 
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: videoPath }
    });
    const page = await context.newPage();

    // ── Console + error capture ──
    page.on('console', (msg: ConsoleMessage) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      session.logs.push(entry);
      if (msg.type() === 'error' || msg.type() === 'warning') {
        session.errors.push(entry);
      }
    });

    page.on('pageerror', (err: Error) => {
      const entry = `[PageError] ${err.message}`;
      session.logs.push(entry);
      session.errors.push(entry);
    });

    // ── Network failure capture ──
    page.on('requestfailed', (req: Request) => {
      const entry = `[NetworkFail] ${req.method()} ${req.url()} — ${req.failure()?.errorText || 'unknown'}`;
      session.logs.push(entry);
      session.errors.push(entry);
    });

    // ── Helper: take screenshot + emit step ──
    const captureStep = async (action: string, description: string) => {
      // Check for pause
      while (session.status === 'paused') {
        await new Promise(r => setTimeout(r, 500));
      }
      if (session.status === 'failed') throw new Error('Session stopped by user');

      const startTime = Date.now();
      let screenshotData = '';
      const stepId = nextStepId();
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
        
        const runPath = path.join(/* turbopackIgnore: true */ ctx.projectFolder, '.orbitcode', 'runs', ctx.taskId);
        const screenshotsPath = path.join(/* turbopackIgnore: true */ runPath, 'screenshots');
        await fs.mkdir(/* turbopackIgnore: true */ screenshotsPath, { recursive: true });
        
        const fileName = `${stepId}.jpg`;
        await fs.writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ screenshotsPath, fileName), buf);
        
        screenshotData = `/api/preview?projectFolder=${encodeURIComponent(ctx.projectFolder)}&filePath=${encodeURIComponent('.orbitcode/runs/' + ctx.taskId + '/screenshots/' + fileName)}`;
      } catch {
        // Screenshot may fail on about:blank
      }

      const step: BrowserStep = {
        id: stepId,
        action,
        description,
        url: page.url(),
        timestamp: Date.now(),
        screenshot: screenshotData || undefined,
        duration: Date.now() - startTime,
      };

      emitBrowserStep(ctx, session, step);
    };

    // ── Wrapped page methods for step tracking ──
    const wrappedPage = {
      goto: async (url: string, options?: PageGotoOptions) => {
        await captureStep('navigate', `Navigating to ${url}`);
        await page.goto(url, options);
        await captureStep('navigate', `Loaded ${url}`);
      },
      click: async (selector: string, options?: PageClickOptions) => {
        await page.click(selector, options);
        await captureStep('click', `Clicked: ${selector}`);
      },
      fill: async (selector: string, value: string, options?: PageFillOptions) => {
        await page.fill(selector, value, options);
        await captureStep('type', `Typed "${value.substring(0, 30)}${value.length > 30 ? '...' : ''}" into ${selector}`);
      },
      type: async (selector: string, text: string, options?: PageTypeOptions) => {
        await page.type(selector, text, options);
        await captureStep('type', `Typed "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}" into ${selector}`);
      },
      waitForSelector: async (selector: string, options?: PageWaitForSelectorOptions) => {
        const el = options === undefined
          ? await page.waitForSelector(selector)
          : await page.waitForSelector(selector, options);
        await captureStep('wait', `Found: ${selector}`);
        return el;
      },
      waitForTimeout: async (ms: number) => {
        await page.waitForTimeout(ms);
        await captureStep('wait', `Waited ${ms}ms`);
      },
      screenshot: async (options?: PageScreenshotOptions) => {
        const buf = await page.screenshot(options);
        const data = 'data:image/png;base64,' + buf.toString('base64');
        const step: BrowserStep = {
          id: nextStepId(),
          action: 'screenshot',
          description: 'Manual screenshot captured',
          url: page.url(),
          timestamp: Date.now(),
          screenshot: data,
        };
        emitBrowserStep(ctx, session, step);
        return buf;
      },
      // Pass-through for everything else
      url: () => page.url(),
      content: () => page.content(),
      title: () => page.title(),
      evaluate: (fn: PageEvaluateFunction, arg?: unknown) => page.evaluate(fn, arg),
      locator: (s: string) => page.locator(s),
      getByText: (t: string) => page.getByText(t),
      getByRole: (r: Parameters<typeof page.getByRole>[0], o?: Parameters<typeof page.getByRole>[1]) => page.getByRole(r, o),
      $: (s: string) => page.$(s),
      $$: (s: string) => page.$$(s),
      textContent: (s: string) => page.textContent(s),
      innerText: (s: string) => page.innerText(s),
      innerHTML: (s: string) => page.innerHTML(s),
      isVisible: (s: string) => page.isVisible(s),
      reload: async () => { await page.reload(); await captureStep('navigate', 'Page reloaded'); },
      goBack: async () => { await page.goBack(); await captureStep('navigate', 'Navigated back'); },
      goForward: async () => { await page.goForward(); await captureStep('navigate', 'Navigated forward'); },
      // Raw page access for advanced scripts
      _raw: page,
    };

    // ── Execute the user script ──
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

    // Legacy emitProgress for backward compat
    const emitProgress = (type: string, detail: string) => {
      if (type === 'screenshot') {
        const stepId = nextStepId();
        const runPath = path.join(/* turbopackIgnore: true */ ctx.projectFolder, '.orbitcode', 'runs', ctx.taskId);
        const screenshotsPath = path.join(/* turbopackIgnore: true */ runPath, 'screenshots');
        fs.mkdir(/* turbopackIgnore: true */ screenshotsPath, { recursive: true }).then(() => {
          const buf = Buffer.from(detail, 'base64');
          return fs.writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ screenshotsPath, `${stepId}.png`), buf);
        }).catch(() => {});
        
        const s: BrowserStep = {
          id: stepId,
          action: 'screenshot',
          description: 'Screenshot captured via emitProgress',
          url: page.url(),
          timestamp: Date.now(),
          screenshot: `/api/preview?projectFolder=${encodeURIComponent(ctx.projectFolder)}&filePath=${encodeURIComponent('.orbitcode/runs/' + ctx.taskId + '/screenshots/' + stepId + '.png')}`,
        };
        emitBrowserStep(ctx, session, s);
      }
    };

    const fn = new AsyncFunction('page', 'emitProgress', 'logs', `
      try {
        ${scriptLines}
      } catch (err) {
        logs.push('[ScriptError] ' + err.message);
        throw err;
      }
    `);

    // Pass wrappedPage as 'page' so scripts get auto-tracking
    await fn(wrappedPage, emitProgress, session.logs);

    // Final screenshot
    try {
      const finalBuf = await page.screenshot({ type: 'jpeg', quality: 70 });
      const stepId = nextStepId();
      const runPath = path.join(/* turbopackIgnore: true */ ctx.projectFolder, '.orbitcode', 'runs', ctx.taskId);
      const screenshotsPath = path.join(/* turbopackIgnore: true */ runPath, 'screenshots');
      await fs.mkdir(/* turbopackIgnore: true */ screenshotsPath, { recursive: true });
      const fileName = `${stepId}.jpg`;
      await fs.writeFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ screenshotsPath, fileName), finalBuf);
      
      const finalData = `/api/preview?projectFolder=${encodeURIComponent(ctx.projectFolder)}&filePath=${encodeURIComponent('.orbitcode/runs/' + ctx.taskId + '/screenshots/' + fileName)}`;
      
      const finalStep: BrowserStep = {
        id: stepId,
        action: 'screenshot',
        description: 'Final state',
        url: page.url(),
        timestamp: Date.now(),
        screenshot: finalData,
      };
      emitBrowserStep(ctx, session, finalStep);
    } catch { /* ignore */ }

    await browser.close();

    session.status = 'complete';
    session.completedAt = Date.now();

    await flushSessionState(ctx, session);

    // Emit session complete
    ctx.onProgress?.({
      type: 'tool_end',
      toolName: 'browser_session',
      detail: JSON.stringify({
        sessionId: session.sessionId,
        status: 'complete',
        stepCount: session.stepCount,
        errorCount: session.errors.length,
        duration: session.completedAt - session.startedAt,
      }),
    });

    const summary = [
      `Browser session completed successfully.`,
      `Steps: ${session.stepCount}`,
      `Screenshots: ${session.screenshots.length}`,
      `Console logs: ${session.logs.length}`,
      `Errors: ${session.errors.length}`,
      '',
      session.errors.length > 0 ? `Errors:\n${session.errors.slice(0, 10).join('\n')}` : '',
      session.logs.length > 0 ? `\nLast 5 logs:\n${session.logs.slice(-5).join('\n')}` : '',
    ].filter(Boolean).join('\n');

    return summary;

  } catch (error: unknown) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    const message = error instanceof Error ? error.message : String(error);
    session.status = 'failed';
    session.completedAt = Date.now();
    session.errors.push(`[Fatal] ${message}`);

    ctx.onProgress?.({
      type: 'tool_end',
      toolName: 'browser_session',
      detail: JSON.stringify({
        sessionId: session.sessionId,
        status: 'failed',
        error: message,
      }),
    });

    return `ERROR during browser execution: ${message}\n\nLogs:\n${session.logs.join('\n')}`;
  }
}
