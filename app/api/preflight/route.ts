/* OrbitCode — Startup Preflight API
 *
 * GET  /api/preflight?projectFolder=...
 * Runs a small set of host-environment checks and returns a structured
 * PASS / WARN / FAIL report with remediation hints for each item.
 *
 * Why this exists: the audit found that OrbitCode depends on Node, Git,
 * gcloud, and Playwright being installed on the host. When any of those is
 * missing, the failures used to leak out through the terminal with cryptic
 * messages. Preflight surfaces them in the UI before the user tries to run
 * anything.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const pexec = promisify(exec);

export type PreflightLevel = 'pass' | 'warn' | 'fail';

export interface PreflightCheck {
  id: string;
  label: string;
  level: PreflightLevel;
  detail: string;
  remediation?: string;
  version?: string;
}

/** Run a shell command with a short timeout and return stdout + ok flag. */
async function run(cmd: string, timeoutMs = 6000): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const { stdout, stderr } = await pexec(cmd, { timeout: timeoutMs, windowsHide: true });
    return { ok: true, out: (stdout || '').trim(), err: (stderr || '').trim() };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, out: '', err: msg };
  }
}

async function checkNode(): Promise<PreflightCheck> {
  const nodeVer = process.versions.node; // always present — we're running inside Next
  const major = parseInt(nodeVer.split('.')[0], 10);
  if (!major || major < 18) {
    return {
      id: 'node',
      label: 'Node.js runtime',
      level: 'fail',
      detail: `Node ${nodeVer} detected — OrbitCode requires Node 18+.`,
      remediation: 'Install Node.js 18 LTS or newer from https://nodejs.org.',
      version: nodeVer,
    };
  }
  if (major < 20) {
    return {
      id: 'node',
      label: 'Node.js runtime',
      level: 'warn',
      detail: `Node ${nodeVer} works but 20+ is recommended.`,
      remediation: 'Upgrade to Node 20 LTS for best compatibility with Next.js 16.',
      version: nodeVer,
    };
  }
  return { id: 'node', label: 'Node.js runtime', level: 'pass', detail: `Node ${nodeVer}`, version: nodeVer };
}

async function checkBinary(id: string, label: string, cmd: string, versionCmd: string, remediation: string): Promise<PreflightCheck> {
  const probe = await run(cmd);
  if (!probe.ok) {
    return { id, label, level: 'fail', detail: `${label} is not on PATH.`, remediation };
  }
  const ver = await run(versionCmd);
  const version = (ver.out.split('\n')[0] || '').trim();
  return { id, label, level: 'pass', detail: version || probe.out.split('\n')[0] || 'Available', version };
}

async function checkGcloudAuth(): Promise<PreflightCheck> {
  const present = await run(process.platform === 'win32' ? 'where gcloud' : 'command -v gcloud');
  if (!present.ok) {
    return {
      id: 'gcloud',
      label: 'gcloud CLI',
      level: 'warn',
      detail: 'gcloud not on PATH. GCP deploy features will be disabled.',
      remediation: 'Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install',
    };
  }
  const auth = await run('gcloud auth list --format="value(account)"', 10000);
  const accounts = auth.out.split('\n').filter(Boolean);
  if (accounts.length === 0) {
    return {
      id: 'gcloud',
      label: 'gcloud CLI',
      level: 'warn',
      detail: 'gcloud installed but no authenticated account.',
      remediation: 'Run: gcloud auth login && gcloud auth application-default login',
    };
  }
  const proj = await run('gcloud config get-value project', 6000);
  const project = proj.out.trim();
  if (!project || project === '(unset)') {
    return {
      id: 'gcloud',
      label: 'gcloud CLI',
      level: 'warn',
      detail: `Authenticated as ${accounts[0]} but no active project set.`,
      remediation: 'Run: gcloud config set project <YOUR_PROJECT_ID>',
    };
  }
  return {
    id: 'gcloud',
    label: 'gcloud CLI',
    level: 'pass',
    detail: `Authenticated as ${accounts[0]}, project=${project}`,
    version: project,
  };
}

async function checkPlaywright(projectFolder?: string): Promise<PreflightCheck> {
  // We look for the installed browser cache. If the user hasn't run
  // `npx playwright install` this will be missing.
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
      : path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
    projectFolder ? path.join(projectFolder, 'node_modules', '@playwright') : undefined,
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    try {
      const entries = await fs.readdir(dir);
      if (entries.some(e => /chromium/i.test(e))) {
        return { id: 'playwright', label: 'Playwright / Chromium', level: 'pass', detail: `Found at ${dir}` };
      }
    } catch { /* keep trying */ }
  }
  return {
    id: 'playwright',
    label: 'Playwright / Chromium',
    level: 'warn',
    detail: 'Chromium binary not found. Browser QA and recording will fail.',
    remediation: 'Run: npx playwright install chromium',
  };
}

async function checkEnv(): Promise<PreflightCheck> {
  const missing: string[] = [];
  const needGcp = !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT;
  if (needGcp) missing.push('GOOGLE_CLOUD_PROJECT');

  if (missing.length === 0) {
    return { id: 'env', label: 'Environment variables', level: 'pass', detail: 'Core env vars present' };
  }
  return {
    id: 'env',
    label: 'Environment variables',
    level: 'warn',
    detail: `Missing: ${missing.join(', ')}`,
    remediation: 'Set GOOGLE_CLOUD_PROJECT or GOOGLE_APPLICATION_CREDENTIALS for GCP Vertex AI calls.',
  };
}

async function checkWorkspace(projectFolder?: string): Promise<PreflightCheck> {
  if (!projectFolder) {
    return {
      id: 'workspace',
      label: 'Workspace folder',
      level: 'warn',
      detail: 'No project folder selected yet.',
      remediation: 'Open a project from the dashboard before running live tasks.',
    };
  }
  try {
    const s = await fs.stat(projectFolder);
    if (!s.isDirectory()) {
      return { id: 'workspace', label: 'Workspace folder', level: 'fail', detail: `${projectFolder} is not a directory.` };
    }
    // Writable test
    const probe = path.join(projectFolder, `.orbitcode_preflight_${Date.now()}.tmp`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return { id: 'workspace', label: 'Workspace folder', level: 'pass', detail: `${projectFolder} (writable)` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: 'workspace',
      label: 'Workspace folder',
      level: 'fail',
      detail: `Cannot access / write to ${projectFolder}: ${msg}`,
      remediation: 'Check folder permissions or pick a different folder.',
    };
  }
}

async function checkRunsDir(projectFolder?: string): Promise<PreflightCheck> {
  if (!projectFolder) {
    return { id: 'runs', label: 'Run artifact folder', level: 'warn', detail: 'Depends on workspace folder.' };
  }
  const runs = path.join(projectFolder, '.orbitcode', 'runs');
  try {
    await fs.mkdir(runs, { recursive: true });
    return { id: 'runs', label: 'Run artifact folder', level: 'pass', detail: runs };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id: 'runs', label: 'Run artifact folder', level: 'fail', detail: msg };
  }
}

export async function GET(request: NextRequest) {
  const projectFolder = request.nextUrl.searchParams.get('projectFolder') || undefined;

  const checks: PreflightCheck[] = await Promise.all([
    checkNode(),
    checkBinary('git', 'Git',
      process.platform === 'win32' ? 'where git' : 'command -v git',
      'git --version',
      'Install Git: https://git-scm.com/downloads'),
    checkGcloudAuth(),
    checkPlaywright(projectFolder),
    checkEnv(),
    checkWorkspace(projectFolder),
    checkRunsDir(projectFolder),
  ]);

  const summary = {
    pass: checks.filter(c => c.level === 'pass').length,
    warn: checks.filter(c => c.level === 'warn').length,
    fail: checks.filter(c => c.level === 'fail').length,
  };
  const overall: PreflightLevel = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass';

  return NextResponse.json({
    overall,
    summary,
    checks,
    ranAt: new Date().toISOString(),
  });
}
