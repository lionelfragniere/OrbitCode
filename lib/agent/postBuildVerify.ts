/* OrbitCode — Post-Build Verification
 *
 * Heavier verification gate that actually starts the dev server,
 * checks for runtime errors, and runs visual QA.
 *
 * Runs after agent completion (both modes) to produce a deterministic
 * pass/fail verdict with evidence.
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { runVisualQa, formatVisualQaReport, type VisualQaResult } from './visualQa';
import { runRouteCoverageQa, formatRouteCoverageReport, type RouteCoverageResult } from './routeCoverageQa';

// ════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════
export interface BuildVerifyResult {
  pass: boolean;
  verdict: string;              // human-readable summary
  phase: 'skip' | 'install' | 'start' | 'http' | 'visual_qa' | 'complete';
  errors: string[];
  warnings: string[];
  devServerUrl?: string;
  httpStatus?: number;
  visualQa?: VisualQaResult;
  routeCoverage?: RouteCoverageResult;
  screenshotPath?: string;
  durationMs: number;
}

export interface BuildVerifyEvidence {
  preCheck?: { pass: boolean; errors: string[]; warnings: string[] };
  buildVerify?: BuildVerifyResult;
  visualQaReport?: string;
  screenshotPath?: string;
  deploymentCheck?: { pass: boolean; url: string; status: number | string; detail: string };
}

// ════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Find the frontend app directory by locating package.json with a "dev" script.
 */
async function findAppDir(projectFolder: string): Promise<string | null> {
  const absDir = path.resolve(projectFolder);

  // Check project root
  if (await hasDevScript(absDir)) return absDir;

  // Check immediate subdirectories
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['node_modules', '.git', 'dist', '.orbitcode'].includes(entry.name)) continue;
      const subDir = path.join(absDir, entry.name);
      if (await hasDevScript(subDir)) return subDir;
    }
  } catch { /* empty */ }

  return null;
}

async function hasDevScript(dir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'));
    return !!(pkg.scripts && pkg.scripts.dev);
  } catch {
    return false;
  }
}

/**
 * Run a command and return { stdout, stderr, exitCode }.
 */
function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number = 60000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      shell: true,
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1 });
    }, timeoutMs);

    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: e.message, exitCode: 1 });
    });
  });
}

/**
 * Start a dev server on a random port. Returns the process and URL.
 */
async function startDevServer(appDir: string, port: number): Promise<{ proc: ChildProcess; url: string }> {
  const proc = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
    cwd: appDir,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' },
  });

  const url = `http://localhost:${port}`;

  // Wait for server to be ready (up to 20s)
  const startTime = Date.now();
  while (Date.now() - startTime < 20000) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok || resp.status < 500) return { proc, url };
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }

  return { proc, url };
}

function killProcess(proc: ChildProcess) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { shell: true });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* already dead */ }
}

// ════════════════════════════════════════════
//  Main Verification
// ════════════════════════════════════════════
export async function runPostBuildVerify(projectFolder: string): Promise<BuildVerifyResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Find the app directory
  const appDir = await findAppDir(projectFolder);
  if (!appDir) {
    return {
      pass: true, // No frontend app — might be backend-only, don't fail
      verdict: 'No frontend app with dev script found — skipping build verification.',
      phase: 'skip',
      errors: [],
      warnings: ['No package.json with dev script found'],
      durationMs: Date.now() - startTime,
    };
  }

  // 2. Install dependencies if needed
  const nodeModules = path.join(appDir, 'node_modules');
  if (!await fileExists(nodeModules)) {
    console.log('[PostBuildVerify] Installing dependencies...');
    const install = await runCommand('npm', ['install', '--no-audit', '--no-fund'], appDir, 120000);
    if (install.exitCode !== 0) {
      errors.push(`npm install failed (exit ${install.exitCode}): ${install.stderr.substring(0, 500)}`);
      return {
        pass: false,
        verdict: `BUILD FAILED: npm install failed with exit code ${install.exitCode}`,
        phase: 'install',
        errors,
        warnings,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // 3. Start dev server
  const port = 4300 + Math.floor(Math.random() * 100);
  console.log(`[PostBuildVerify] Starting dev server on port ${port}...`);
  let devProc: ChildProcess | null = null;

  try {
    const { proc, url } = await startDevServer(appDir, port);
    devProc = proc;

    // Collect any stderr from dev server
    let devStderr = '';
    proc.stderr?.on('data', (d) => { devStderr += d.toString(); });

    // 4. HTTP check
    let httpStatus = 0;
    let httpBody = '';
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      httpStatus = resp.status;
      httpBody = await resp.text();
    } catch (e) {
      errors.push(`Dev server unreachable at ${url}: ${e instanceof Error ? e.message : 'unknown'}`);
      return {
        pass: false,
        verdict: `BUILD FAILED: Dev server did not respond at ${url}`,
        phase: 'http',
        errors,
        warnings,
        devServerUrl: url,
        durationMs: Date.now() - startTime,
      };
    }

    if (httpStatus >= 400) {
      errors.push(`Dev server returned HTTP ${httpStatus}`);
      return {
        pass: false,
        verdict: `BUILD FAILED: Dev server returned HTTP ${httpStatus}`,
        phase: 'http',
        errors,
        warnings,
        httpStatus,
        devServerUrl: url,
        durationMs: Date.now() - startTime,
      };
    }

    // Check for Vite error patterns in stderr
    const viteErrors = [
      /Failed to resolve import/,
      /Module not found/,
      /Cannot find module/,
      /SyntaxError/,
      /PostCSS plugin.*failed/,
    ];
    for (const pattern of viteErrors) {
      if (pattern.test(devStderr)) {
        const match = devStderr.match(pattern);
        errors.push(`Vite/build error detected: ${match?.[0]}`);
      }
    }

    // 5. Run visual QA (homepage)
    console.log('[PostBuildVerify] Running visual QA...');
    let visualQa: VisualQaResult | undefined;
    let screenshotPath: string | undefined;
    try {
      visualQa = await runVisualQa(url, projectFolder);
      screenshotPath = visualQa.screenshotPath;

      if (visualQa.verdict === 'QA_FAIL') {
        const failedChecks = visualQa.checks.filter(c => c.status === 'fail');
        for (const check of failedChecks) {
          errors.push(`Visual QA ❌ ${check.name}: ${check.detail}`);
        }
      }
    } catch (qaError) {
      warnings.push(`Visual QA could not run: ${qaError instanceof Error ? qaError.message : 'unknown'}`);
    }

    // 6. Run route coverage QA (all routes)
    let routeCoverage: RouteCoverageResult | undefined;
    try {
      console.log('[PostBuildVerify] Running route coverage QA...');
      routeCoverage = await runRouteCoverageQa(url, projectFolder);
      console.log(`[PostBuildVerify] Route coverage: ${routeCoverage.verdict} (${routeCoverage.routesPassed}/${routeCoverage.routesTested} passed)`);

      if (routeCoverage.verdict !== 'COVERAGE_PASS') {
        const failedRoutes = routeCoverage.routes.filter(r => r.status === 'fail');
        for (const route of failedRoutes) {
          errors.push(`Route ❌ ${route.route}: ${route.reason}`);
        }
      }
    } catch (coverageError) {
      warnings.push(`Route coverage QA could not run: ${coverageError instanceof Error ? coverageError.message : 'unknown'}`);
    }

    const pass = errors.length === 0;
    const coverageSuffix = routeCoverage
      ? `, routes ${routeCoverage.routesPassed}/${routeCoverage.routesTested}`
      : '';
    const verdict = pass
      ? `BUILD VERIFIED: App loads at ${url}, HTTP ${httpStatus}, visual QA ${visualQa?.verdict === 'QA_PASS' ? 'PASS' : 'N/A'}${coverageSuffix}`
      : `BUILD FAILED: ${errors.length} error(s) detected — ${errors[0]}`;

    return {
      pass,
      verdict,
      phase: 'complete',
      errors,
      warnings,
      devServerUrl: url,
      httpStatus,
      visualQa,
      routeCoverage,
      screenshotPath,
      durationMs: Date.now() - startTime,
    };

  } finally {
    // Always kill the dev server
    if (devProc) {
      console.log('[PostBuildVerify] Killing dev server...');
      killProcess(devProc);
    }
  }
}

// ════════════════════════════════════════════
//  Deployment Smoke Test
// ════════════════════════════════════════════
export async function runDeploymentSmokeTest(
  deployedUrl: string,
): Promise<{ pass: boolean; status: number | string; detail: string }> {
  try {
    const resp = await fetch(deployedUrl, {
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    const status = resp.status;
    const body = await resp.text();
    const contentType = resp.headers.get('content-type') || '';

    // Auth-protected detection
    if (status === 401 || status === 403) {
      return {
        pass: false,
        status,
        detail: `Verification blocked by auth (HTTP ${status}). The deployed URL requires authentication. Manual verification needed.`,
      };
    }

    // Redirect to login page
    if (body.includes('Sign in') && body.includes('accounts.google.com')) {
      return {
        pass: false,
        status: 'auth-redirect',
        detail: 'Verification blocked by auth: page redirects to Google Sign-In. The service may require IAP or OAuth. Manual verification needed.',
      };
    }

    if (status >= 400) {
      return {
        pass: false,
        status,
        detail: `Deployment returned HTTP ${status}. Expected 200.`,
      };
    }

    // Check for minimal content
    if (body.length < 50) {
      return {
        pass: false,
        status,
        detail: `Deployment returned HTTP ${status} but response body is suspiciously short (${body.length} chars).`,
      };
    }

    // Check for HTML content (not raw JSON error pages)
    if (contentType.includes('text/html') && body.includes('<div')) {
      return {
        pass: true,
        status,
        detail: `Deployment verified: HTTP ${status}, HTML content (${body.length} chars), content-type: ${contentType}`,
      };
    }

    return {
      pass: true,
      status,
      detail: `Deployment reachable: HTTP ${status}, content-type: ${contentType}, body: ${body.length} chars`,
    };

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
      return {
        pass: false,
        status: 'unreachable',
        detail: `Deployed URL is unreachable: ${msg}`,
      };
    }
    if (msg.includes('TimeoutError') || msg.includes('timed out')) {
      return {
        pass: false,
        status: 'timeout',
        detail: `Deployed URL timed out after 15s: ${msg}`,
      };
    }
    return {
      pass: false,
      status: 'error',
      detail: `Deployment check error: ${msg}`,
    };
  }
}

/**
 * Format build verification result for display.
 */
export function formatBuildVerifyReport(result: BuildVerifyResult): string {
  const lines: string[] = [
    `## Post-Build Verification`,
    `Verdict: **${result.pass ? 'BUILD VERIFIED' : 'BUILD FAILED'}**`,
    `Duration: ${result.durationMs}ms`,
    `Phase reached: ${result.phase}`,
  ];

  if (result.devServerUrl) lines.push(`Dev server: ${result.devServerUrl}`);
  if (result.httpStatus) lines.push(`HTTP status: ${result.httpStatus}`);

  if (result.errors.length > 0) {
    lines.push('', '### ❌ Errors:');
    for (const e of result.errors) lines.push(`- ${e}`);
  }

  if (result.warnings.length > 0) {
    lines.push('', '### ⚠️ Warnings:');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }

  if (result.screenshotPath) {
    lines.push(``, `📸 Screenshot: ${result.screenshotPath}`);
  }

  return lines.join('\n');
}
