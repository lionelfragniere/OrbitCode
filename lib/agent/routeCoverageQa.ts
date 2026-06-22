/* OrbitCode — Route Coverage QA
 *
 * Discovers all app routes (from DOM links + React Router source),
 * visits each one, and verifies meaningful page content exists.
 *
 * A page that renders only sidebar/header with no real content is a FAIL.
 * Placeholder text ("coming soon", "todo", "lorem ipsum") is a FAIL.
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';

// ════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════

export interface RouteCheckResult {
  route: string;
  status: 'pass' | 'fail' | 'skip';
  reason: string;
  screenshotPath?: string;
  details: {
    httpStatus?: number;
    contentAreaText?: number;     // chars in the main content area
    totalBodyText?: number;       // total text on page
    hasHeading?: boolean;
    hasSemanticContent?: boolean; // table, form, list, card, chart, grid
    hasErrorOverlay?: boolean;
    isPlaceholder?: boolean;
    contentAreaHeight?: number;
    detectedElements?: string[];  // what we found: heading, table, form, etc.
  };
}

export interface RouteCoverageResult {
  verdict: 'COVERAGE_PASS' | 'COVERAGE_FAIL' | 'COVERAGE_PARTIAL';
  routesTested: number;
  routesPassed: number;
  routesFailed: number;
  routes: RouteCheckResult[];
  timestamp: number;
}

// ════════════════════════════════════════════
//  Placeholder / Incomplete Content Patterns
// ════════════════════════════════════════════

const PLACEHOLDER_PATTERNS = [
  /\bcoming soon\b/i,
  /\btodo\b/i,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /\bsample page\b/i,
  /\bunder construction\b/i,
  /\bwork in progress\b/i,
  /\bpage not found\b/i,
  /\bcannot get\b/i,
  /\b404\b.*\bnot found\b/i,
  /\bno content\b/i,
  /\btest page\b/i,
  /\bdefault page\b/i,
  /\bnothing here\b/i,
  /\bthis page is empty\b/i,
];

// ════════════════════════════════════════════
//  Route Discovery
// ════════════════════════════════════════════

/**
 * Discover routes from the running app by inspecting navigation links.
 * Returns unique internal paths.
 */
async function discoverRoutesFromDOM(page: Page, baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;

  const hrefs = await page.evaluate((origin: string) => {
    const links = Array.from(document.querySelectorAll('a[href], [role="link"][href]'));
    const navLinks = Array.from(document.querySelectorAll('nav a, aside a, .sidebar a, .nav a, [class*="sidebar"] a, [class*="nav"] a'));
    const allLinks = [...new Set([...navLinks, ...links])];

    return allLinks
      .map(el => (el as HTMLAnchorElement).getAttribute('href') || '')
      .filter(href => {
        if (!href || href === '#' || href.startsWith('javascript:')) return false;
        // Internal links only
        if (href.startsWith('/') || href.startsWith(origin)) return true;
        // Relative links
        if (!href.startsWith('http')) return true;
        return false;
      })
      .map(href => {
        if (href.startsWith('http')) {
          try { return new URL(href).pathname; } catch { return href; }
        }
        return href;
      });
  }, origin);

  // Deduplicate and normalize
  const uniquePaths = [...new Set(hrefs.map(h => h.replace(/\/+$/, '') || '/'))];
  return uniquePaths.filter(p => p !== '/'); // exclude homepage (already tested)
}

/**
 * Parse routes from React Router source files.
 * Looks for <Route path="..." /> patterns in App.jsx/tsx/js/ts.
 */
async function discoverRoutesFromSource(projectDir: string): Promise<string[]> {
  const absDir = path.resolve(projectDir);
  const candidates = [
    'src/App.jsx', 'src/App.tsx', 'src/App.js', 'src/App.ts',
    'src/router.jsx', 'src/router.tsx', 'src/router.js', 'src/router.ts',
    'src/routes.jsx', 'src/routes.tsx', 'src/routes.js', 'src/routes.ts',
    'src/main.jsx', 'src/main.tsx',
  ];

  const routes: string[] = [];

  for (const candidate of candidates) {
    const filePath = path.join(absDir, candidate);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      // Match <Route path="/something" or path={"/something"} or path='/something'
      const routePattern = /(?:path|to)\s*[=:]\s*["'`{]*["'`]([^"'`}]+)["'`]/g;
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        const routePath = match[1].trim();
        // Only include absolute paths, skip wildcards and param-only routes
        if (routePath.startsWith('/') && routePath !== '/' && !routePath.includes('*')) {
          routes.push(routePath);
        }
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return [...new Set(routes)];
}

// ════════════════════════════════════════════
//  Per-Route Content Completeness Check
// ════════════════════════════════════════════

/**
 * Check whether a page has meaningful content beyond just nav/sidebar/header.
 *
 * This is the heart of the completeness gate. The key insight is:
 * we must measure the CONTENT AREA, not the whole page. A page with
 * a perfect sidebar + header but an empty main area is a FAIL.
 */
async function checkRouteCompleteness(page: Page, route: string, url: string): Promise<RouteCheckResult> {
  const fullUrl = new URL(route, url).toString();
  const details: RouteCheckResult['details'] = {};

  try {
    // Navigate
    const response = await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 15000 });
    details.httpStatus = response?.status() ?? 0;

    if ((details.httpStatus ?? 0) >= 400) {
      return {
        route,
        status: 'fail',
        reason: `HTTP ${details.httpStatus} — page returned an error status`,
        details,
      };
    }

    // Wait for rendering
    await page.waitForTimeout(1500);

    // Check for error overlays
    details.hasErrorOverlay = await page.evaluate(() => {
      if (document.querySelector('vite-error-overlay')) return true;
      if (document.querySelector('#webpack-dev-server-client-overlay')) return true;
      const body = document.body.innerText || '';
      if (body.includes('Uncaught Error') || body.includes('Something went wrong')) return true;
      return false;
    });

    if (details.hasErrorOverlay) {
      return {
        route,
        status: 'fail',
        reason: 'Error overlay detected — page has a runtime error',
        details,
      };
    }

    // Measure content OUTSIDE of sidebar/nav/header/footer
    const contentInfo = await page.evaluate(() => {
      // Try to find the "main content area" — the part that changes per route
      const mainContent = document.querySelector(
        'main, [role="main"], .main-content, .content, .page-content, ' +
        '.app-content, [class*="content"], [class*="page-body"]'
      );

      // Fallback: find the largest direct child of #root that ISN'T nav/aside/header/footer
      let contentEl = mainContent;
      if (!contentEl) {
        const root = document.querySelector('#root') || document.body;
        const children = Array.from(root.children);
        // Find the element with the most text that isn't nav/aside/header/footer
        let bestEl: Element | null = null;
        let bestText = 0;
        for (const child of children) {
          const tag = child.tagName.toLowerCase();
          if (['nav', 'aside', 'header', 'footer', 'script', 'style', 'link'].includes(tag)) continue;
          const text = (child as HTMLElement).innerText?.length || 0;
          if (text > bestText) {
            bestText = text;
            bestEl = child;
          }
        }
        contentEl = bestEl;
      }

      // If we still don't have a content element, try the second-level layout
      // Common pattern: root > div.flex > aside + main
      if (!contentEl) {
        const root = document.querySelector('#root') || document.body;
        const firstChild = root.firstElementChild;
        if (firstChild) {
          const children = Array.from(firstChild.children);
          let bestEl: Element | null = null;
          let bestText = 0;
          for (const child of children) {
            const tag = child.tagName.toLowerCase();
            if (['nav', 'aside', 'header', 'footer', 'script', 'style', 'link'].includes(tag)) continue;
            // Skip elements that look like sidebars (narrow, tall)
            const rect = child.getBoundingClientRect();
            if (rect.width < 300 && rect.height > 200) continue; // likely sidebar
            const text = (child as HTMLElement).innerText?.length || 0;
            if (text > bestText) {
              bestText = text;
              bestEl = child;
            }
          }
          contentEl = bestEl;
        }
      }

      // Get nav/sidebar/header text to subtract from total
      const navEls = document.querySelectorAll('nav, aside, header, footer, [class*="sidebar"], [class*="nav"]');
      let navText = '';
      navEls.forEach(el => { navText += (el as HTMLElement).innerText || ''; });

      const totalBodyText = (document.body.innerText || '').trim();
      const contentAreaText = contentEl ? ((contentEl as HTMLElement).innerText || '').trim() : '';
      const contentAreaHeight = contentEl ? contentEl.getBoundingClientRect().height : 0;

      // Check for semantic content elements in the content area
      const searchScope = contentEl || document.body;
      const hasHeading = !!searchScope.querySelector('h1, h2, h3');
      const hasTable = !!searchScope.querySelector('table, [role="table"], [class*="table"]');
      const hasForm = !!searchScope.querySelector('form, [role="form"], input, textarea, select');
      const hasList = !!searchScope.querySelector('ul:not(nav ul), ol, [role="list"], dl');
      const hasCard = !!searchScope.querySelector('[class*="card"], [class*="Card"], [class*="stat"], [class*="kpi"], [class*="metric"]');
      const hasChart = !!searchScope.querySelector('canvas, svg[class*="chart"], [class*="chart"], [class*="graph"]');
      const hasGrid = !!searchScope.querySelector('[class*="grid"], [class*="Grid"], [class*="row"]');
      const hasButton = !!searchScope.querySelector('button, [role="button"], input[type="submit"]');

      const detectedElements: string[] = [];
      if (hasHeading) detectedElements.push('heading');
      if (hasTable) detectedElements.push('table');
      if (hasForm) detectedElements.push('form');
      if (hasList) detectedElements.push('list');
      if (hasCard) detectedElements.push('card');
      if (hasChart) detectedElements.push('chart');
      if (hasGrid) detectedElements.push('grid');
      if (hasButton) detectedElements.push('button');

      return {
        contentAreaText: contentAreaText.length,
        totalBodyText: totalBodyText.length,
        navTextLength: navText.length,
        contentAreaHeight,
        hasHeading,
        hasSemanticContent: hasTable || hasForm || hasList || hasCard || hasChart || hasGrid,
        detectedElements,
        contentTextSample: contentAreaText.substring(0, 200),
      };
    });

    details.contentAreaText = contentInfo.contentAreaText;
    details.totalBodyText = contentInfo.totalBodyText;
    details.hasHeading = contentInfo.hasHeading;
    details.hasSemanticContent = contentInfo.hasSemanticContent;
    details.contentAreaHeight = contentInfo.contentAreaHeight;
    details.detectedElements = contentInfo.detectedElements;

    // ── COMPLETENESS CHECKS ──

    // Check 1: Content area must have meaningful text
    // "Meaningful" = at least 30 chars of text that aren't just nav labels
    if (contentInfo.contentAreaText < 30) {
      // Double-check: is the total body text mostly nav text?
      const nonNavText = contentInfo.totalBodyText - contentInfo.navTextLength;
      if (nonNavText < 30) {
        return {
          route,
          status: 'fail',
          reason: `Page has only ${contentInfo.contentAreaText} chars in content area (min 30). This looks like sidebar/header only with no real page content.`,
          details,
        };
      }
    }

    // Check 2: Content area height (not collapsed)
    if (contentInfo.contentAreaHeight < 50) {
      return {
        route,
        status: 'fail',
        reason: `Content area height is ${contentInfo.contentAreaHeight}px (min 50). Page content is collapsed or empty.`,
        details,
      };
    }

    // Check 3: Placeholder text detection
    const textSample = contentInfo.contentTextSample.toLowerCase();
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(textSample)) {
        details.isPlaceholder = true;
        return {
          route,
          status: 'fail',
          reason: `Page contains placeholder text matching: ${pattern.source}`,
          details,
        };
      }
    }

    // Check 4: Must have at least one semantic content element
    // A page with just a heading and no other content elements is suspicious
    if (!contentInfo.hasSemanticContent && contentInfo.contentAreaText < 100) {
      // Allow pages with substantial text even without semantic elements
      return {
        route,
        status: 'fail',
        reason: `Page has heading but no semantic content (table, form, list, card, chart, grid) and only ${contentInfo.contentAreaText} chars. Looks incomplete.`,
        details,
      };
    }

    // Check 5: Must have a heading (title for the page)
    if (!contentInfo.hasHeading && contentInfo.contentAreaText < 100) {
      return {
        route,
        status: 'fail',
        reason: `Page has no heading and only ${contentInfo.contentAreaText} chars of content. Looks like an empty or stub page.`,
        details,
      };
    }

    // All checks passed
    return {
      route,
      status: 'pass',
      reason: `Content: ${contentInfo.contentAreaText} chars, ${contentInfo.contentAreaHeight}px height, elements: [${contentInfo.detectedElements.join(', ')}]`,
      details,
    };

  } catch (err) {
    return {
      route,
      status: 'fail',
      reason: `Navigation error: ${err instanceof Error ? err.message : String(err)}`,
      details,
    };
  }
}

// ════════════════════════════════════════════
//  Main Route Coverage QA
// ════════════════════════════════════════════

export async function runRouteCoverageQa(
  url: string,
  projectDir: string,
  options: { screenshotDir?: string; timeout?: number } = {},
): Promise<RouteCoverageResult> {
  const routes: RouteCheckResult[] = [];
  let browser: Browser | undefined;

  try {
    // 1. Discover routes from source files
    const sourceRoutes = await discoverRoutesFromSource(projectDir);
    console.log(`[RouteCoverageQA] Routes from source: ${sourceRoutes.join(', ') || '(none)'}`);

    // 2. Launch browser and discover routes from DOM
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Navigate to homepage first to discover nav links
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeout ?? 15000 });
      await page.waitForTimeout(1500);
    } catch (err) {
      return {
        verdict: 'COVERAGE_FAIL',
        routesTested: 0,
        routesPassed: 0,
        routesFailed: 0,
        routes: [{
          route: '/',
          status: 'fail',
          reason: `Homepage failed to load: ${err instanceof Error ? err.message : String(err)}`,
          details: {},
        }],
        timestamp: Date.now(),
      };
    }

    const domRoutes = await discoverRoutesFromDOM(page, url);
    console.log(`[RouteCoverageQA] Routes from DOM: ${domRoutes.join(', ') || '(none)'}`);

    // 3. Merge and deduplicate routes
    const allRoutes = [...new Set([...sourceRoutes, ...domRoutes])].sort();
    console.log(`[RouteCoverageQA] Total unique routes to test: ${allRoutes.length}`);

    if (allRoutes.length === 0) {
      // Single-page app with no declared routes — skip coverage
      return {
        verdict: 'COVERAGE_PASS',
        routesTested: 0,
        routesPassed: 0,
        routesFailed: 0,
        routes: [],
        timestamp: Date.now(),
      };
    }

    // 4. Test each route
    const screenshotDir = options.screenshotDir ||
      path.join(path.resolve(projectDir), '.orbitcode', 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    for (const route of allRoutes) {
      console.log(`[RouteCoverageQA] Testing route: ${route}`);
      const result = await checkRouteCompleteness(page, route, url);

      // Take screenshot for every route
      try {
        const screenshotPath = path.join(screenshotDir, `route_qa_${route.replace(/\//g, '_') || 'root'}_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        result.screenshotPath = screenshotPath;
      } catch {
        // Screenshot failure is not critical
      }

      routes.push(result);
    }

    await context.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    routes.push({
      route: '*',
      status: 'fail',
      reason: `Route coverage QA error: ${msg}`,
      details: {},
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // 5. Compute verdict
  const passed = routes.filter(r => r.status === 'pass').length;
  const failed = routes.filter(r => r.status === 'fail').length;
  let verdict: RouteCoverageResult['verdict'];
  if (failed === 0) {
    verdict = 'COVERAGE_PASS';
  } else if (passed > 0) {
    verdict = 'COVERAGE_PARTIAL';
  } else {
    verdict = 'COVERAGE_FAIL';
  }

  return {
    verdict,
    routesTested: routes.length,
    routesPassed: passed,
    routesFailed: failed,
    routes,
    timestamp: Date.now(),
  };
}

// ════════════════════════════════════════════
//  Report Formatting
// ════════════════════════════════════════════

export function formatRouteCoverageReport(result: RouteCoverageResult): string {
  const lines = [
    `## Route Coverage QA`,
    `Verdict: **${result.verdict}**`,
    `Routes tested: ${result.routesTested} | Passed: ${result.routesPassed} | Failed: ${result.routesFailed}`,
    '',
    '### Route Scorecard:',
  ];

  for (const route of result.routes) {
    const icon = route.status === 'pass' ? '✅' : route.status === 'fail' ? '❌' : '⏭️';
    const elements = route.details.detectedElements?.length
      ? ` [${route.details.detectedElements.join(', ')}]`
      : '';
    lines.push(`${icon} \`${route.route}\` — ${route.reason}${elements}`);
  }

  return lines.join('\n');
}
