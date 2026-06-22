/* OrbitCode — Visual QA Module
 *
 * Playwright-based visual verification for generated web apps.
 * Performs element-specific DOM and style assertions that curl cannot do.
 *
 * Returns structured PASS/FAIL with evidence for each check.
 */

import { chromium, type Browser } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface VisualQaCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
}

export interface VisualQaResult {
  url: string;
  verdict: 'QA_PASS' | 'QA_FAIL';
  checks: VisualQaCheck[];
  screenshotPath?: string;
  errors: string[];
  timestamp: number;
}

/**
 * Run visual QA checks against a running web app.
 * 
 * @param url - The URL to test (e.g. http://localhost:5173)
 * @param projectFolder - Absolute path to the project folder (for saving screenshots)
 * @param options - Optional configuration
 */
export async function runVisualQa(
  url: string,
  projectFolder: string,
  options: { timeout?: number; screenshotDir?: string } = {},
): Promise<VisualQaResult> {
  const timeout = options.timeout ?? 15000;
  const checks: VisualQaCheck[] = [];
  const errors: string[] = [];
  let screenshotPath: string | undefined;
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Collect console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // ── CHECK 1: Page loads without crash ──
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout });
      const status = response?.status() ?? 0;
      if (status >= 400) {
        checks.push({ name: 'Page Load', status: 'fail', detail: `HTTP ${status}` });
      } else {
        checks.push({ name: 'Page Load', status: 'pass', detail: `HTTP ${status}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ name: 'Page Load', status: 'fail', detail: `Navigation failed: ${msg}` });
      // Can't continue if page didn't load
      return buildResult(url, checks, errors, screenshotPath);
    }

    // Wait a moment for any async rendering
    await page.waitForTimeout(1500);

    // ── CHECK 2: Page is not blank ──
    const bodyChildCount = await page.evaluate(() => document.body.children.length);
    const bodyText = await page.evaluate(() => document.body.innerText?.trim().length ?? 0);
    if (bodyChildCount === 0 || bodyText < 10) {
      checks.push({ name: 'Not Blank', status: 'fail', detail: `Body has ${bodyChildCount} children, ${bodyText} chars of text` });
    } else {
      checks.push({ name: 'Not Blank', status: 'pass', detail: `Body has ${bodyChildCount} children, ${bodyText} chars` });
    }

    // ── CHECK 3: No error overlay (Vite/webpack/React) ──
    const hasErrorOverlay = await page.evaluate(() => {
      const overlays = [
        'vite-error-overlay',
        'webpack-dev-server-client-overlay',
        '#error-overlay',
      ];
      for (const sel of overlays) {
        if (document.querySelector(sel)) return sel;
      }
      // Check for React error boundary text
      const body = document.body.innerText || '';
      if (body.includes('Uncaught Error') || body.includes('Something went wrong')) {
        return 'react-error-text';
      }
      return null;
    });
    if (hasErrorOverlay) {
      checks.push({ name: 'No Error Overlay', status: 'fail', detail: `Found: ${hasErrorOverlay}` });
    } else {
      checks.push({ name: 'No Error Overlay', status: 'pass', detail: 'No error overlays detected' });
    }

    // ── CHECK 4: Page has a title ──
    const title = await page.title();
    if (!title || title === 'Vite + React' || title === 'localhost') {
      checks.push({ name: 'Page Title', status: 'warn', detail: `Title is generic: "${title}"` });
    } else {
      checks.push({ name: 'Page Title', status: 'pass', detail: `Title: "${title}"` });
    }

    // ── CHECK 5: CSS is loaded (stylesheets exist and body has non-default styles) ──
    const cssInfo = await page.evaluate(() => {
      const sheets = document.styleSheets.length;
      const bodyStyle = window.getComputedStyle(document.body);
      const bgColor = bodyStyle.backgroundColor;
      const fontFamily = bodyStyle.fontFamily;
      return { sheets, bgColor, fontFamily };
    });
    if (cssInfo.sheets === 0) {
      checks.push({ name: 'CSS Loaded', status: 'fail', detail: 'No stylesheets found' });
    } else {
      // Check if background is pure white (rgba(0,0,0,0) = transparent = browser default)
      const isDefault = cssInfo.bgColor === 'rgba(0, 0, 0, 0)' && cssInfo.fontFamily.startsWith('"Times');
      checks.push({
        name: 'CSS Loaded',
        status: isDefault ? 'warn' : 'pass',
        detail: `${cssInfo.sheets} stylesheets, bg: ${cssInfo.bgColor}, font: ${cssInfo.fontFamily.substring(0, 40)}`,
      });
    }

    // ── CHECK 6: Key layout elements exist ──
    const layoutInfo = await page.evaluate(() => {
      const header = document.querySelector('header, [role="banner"], nav, .header, .navbar');
      const main = document.querySelector('main, [role="main"], .main, .app, .container, #root > div');
      const hasHeading = !!document.querySelector('h1, h2');
      const hasInput = !!document.querySelector('input, textarea');
      const hasButton = !!document.querySelector('button, [role="button"], a.btn');
      return {
        hasHeader: !!header,
        headerTag: header?.tagName || null,
        hasMain: !!main,
        hasHeading,
        hasInput,
        hasButton,
      };
    });
    const layoutParts = [];
    if (layoutInfo.hasHeader) layoutParts.push(`header(${layoutInfo.headerTag})`);
    if (layoutInfo.hasMain) layoutParts.push('main');
    if (layoutInfo.hasHeading) layoutParts.push('heading');
    if (layoutInfo.hasInput) layoutParts.push('input');
    if (layoutInfo.hasButton) layoutParts.push('button');

    if (!layoutInfo.hasHeader && !layoutInfo.hasMain) {
      checks.push({ name: 'Layout Elements', status: 'fail', detail: 'No header or main content area found' });
    } else if (!layoutInfo.hasHeader) {
      checks.push({ name: 'Layout Elements', status: 'warn', detail: `Found: ${layoutParts.join(', ')} (no header)` });
    } else {
      checks.push({ name: 'Layout Elements', status: 'pass', detail: `Found: ${layoutParts.join(', ')}` });
    }

    // ── CHECK 7: Images load successfully ──
    const imageInfo = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const results = imgs.map(img => ({
        src: img.src,
        alt: img.alt,
        loaded: img.naturalWidth > 0 && img.naturalHeight > 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      return results;
    });
    if (imageInfo.length === 0) {
      checks.push({ name: 'Images', status: 'warn', detail: 'No images found on page' });
    } else {
      const broken = imageInfo.filter(i => !i.loaded);
      if (broken.length > 0) {
        const brokenSrcs = broken.map(i => i.src.split('/').pop()).join(', ');
        checks.push({ name: 'Images', status: 'fail', detail: `${broken.length}/${imageInfo.length} broken: ${brokenSrcs}` });
      } else {
        checks.push({ name: 'Images', status: 'pass', detail: `${imageInfo.length} images loaded OK` });
      }
    }

    // ── CHECK 8: Header has themed styling (not raw default) ──
    const headerStyle = await page.evaluate(() => {
      const header = document.querySelector('header, nav, [role="banner"], .header, .navbar');
      if (!header) return null;
      const style = window.getComputedStyle(header);
      return {
        bgColor: style.backgroundColor,
        color: style.color,
        padding: style.padding,
        height: header.getBoundingClientRect().height,
      };
    });
    if (!headerStyle) {
      checks.push({ name: 'Header Styling', status: 'warn', detail: 'No header element found to check' });
    } else {
      // Default/unstyled: transparent bg, black text, no padding, tiny height
      const bgIsDefault = headerStyle.bgColor === 'rgba(0, 0, 0, 0)' || headerStyle.bgColor === 'rgb(255, 255, 255)';
      const isUnstyled = bgIsDefault && headerStyle.height < 20;
      if (isUnstyled) {
        checks.push({ name: 'Header Styling', status: 'fail', detail: `Header appears unstyled: bg=${headerStyle.bgColor}, h=${headerStyle.height}px` });
      } else {
        checks.push({ name: 'Header Styling', status: 'pass', detail: `bg=${headerStyle.bgColor}, h=${headerStyle.height}px, padding=${headerStyle.padding}` });
      }
    }

    // ── CHECK 9: Elements are not collapsed/zero-sized ──
    const sizeInfo = await page.evaluate(() => {
      const root = document.querySelector('#root') || document.body.firstElementChild;
      if (!root) return { rootHeight: 0, childCount: 0 };
      const rect = root.getBoundingClientRect();
      return {
        rootHeight: rect.height,
        rootWidth: rect.width,
        childCount: root.children.length,
      };
    });
    if (sizeInfo.rootHeight < 50) {
      checks.push({ name: 'Layout Not Collapsed', status: 'fail', detail: `Root element height: ${sizeInfo.rootHeight}px (collapsed)` });
    } else {
      checks.push({ name: 'Layout Not Collapsed', status: 'pass', detail: `Root: ${sizeInfo.rootWidth}x${sizeInfo.rootHeight}px, ${sizeInfo.childCount} children` });
    }

    // ── CHECK 10: Console errors ──
    const criticalErrors = consoleErrors.filter(e =>
      /SyntaxError|TypeError|ReferenceError|ChunkLoadError|Failed to fetch/.test(e)
    );
    if (criticalErrors.length > 0) {
      checks.push({ name: 'Console Errors', status: 'fail', detail: `${criticalErrors.length} critical: ${criticalErrors[0].substring(0, 100)}` });
    } else if (consoleErrors.length > 0) {
      checks.push({ name: 'Console Errors', status: 'warn', detail: `${consoleErrors.length} non-critical console errors` });
    } else {
      checks.push({ name: 'Console Errors', status: 'pass', detail: 'No console errors' });
    }

    // ── Take screenshot ──
    try {
      const screenshotDir = options.screenshotDir || path.join(projectFolder, '.orbitcode', 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });
      screenshotPath = path.join(screenshotDir, `visual_qa_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (err) {
      errors.push(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await context.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Visual QA error: ${msg}`);
    checks.push({ name: 'Playwright', status: 'fail', detail: msg });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return buildResult(url, checks, errors, screenshotPath);
}

function buildResult(
  url: string,
  checks: VisualQaCheck[],
  errors: string[],
  screenshotPath?: string,
): VisualQaResult {
  // Verdict: FAIL if any check is 'fail'
  const hasFail = checks.some(c => c.status === 'fail');
  return {
    url,
    verdict: hasFail ? 'QA_FAIL' : 'QA_PASS',
    checks,
    screenshotPath,
    errors,
    timestamp: Date.now(),
  };
}

/**
 * Format a VisualQaResult into a human-readable report for the agent.
 */
export function formatVisualQaReport(result: VisualQaResult): string {
  const lines = [
    `## Visual QA Report`,
    `URL: ${result.url}`,
    `Verdict: **${result.verdict}**`,
    `Timestamp: ${new Date(result.timestamp).toISOString()}`,
    '',
    '### Checks:',
  ];

  for (const check of result.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : check.status === 'warn' ? '⚠️' : '⏭️';
    lines.push(`${icon} **${check.name}**: ${check.detail}`);
  }

  if (result.screenshotPath) {
    lines.push('', `📸 Screenshot saved: ${result.screenshotPath}`);
  }

  if (result.errors.length > 0) {
    lines.push('', '### Errors:', ...result.errors.map(e => `- ${e}`));
  }

  return lines.join('\n');
}
