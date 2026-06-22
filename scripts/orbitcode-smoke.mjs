#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.ORBITCODE_BASE || 'http://localhost:3000';
const outputPath = process.env.ORBITCODE_SMOKE_OUT || path.join(repoRoot, '.orbitcode', 'qa', 'orbitcode-smoke.json');
const runGui = process.env.ORBITCODE_SMOKE_GUI !== '0';
const runAgentBrowser = process.env.ORBITCODE_SMOKE_AGENT_BROWSER !== '0';
const runProvider = process.env.ORBITCODE_SMOKE_PROVIDER === '1';
const runAgent = process.env.ORBITCODE_SMOKE_AGENT === '1';
const providerBaseUrl = process.env.ORBITCODE_SMOKE_PROVIDER_BASE || 'http://localhost:11434/v1';
const providerModel = process.env.ORBITCODE_SMOKE_MODEL || 'qwen3:14b';

const checks = [];

function slash(p) {
  return p.replace(/\\/g, '/');
}

function samePath(a, b) {
  return slash(path.resolve(a)).toLowerCase() === slash(path.resolve(b)).toLowerCase();
}

function fail(message) {
  throw new Error(message);
}

async function check(name, fn) {
  const startedAt = Date.now();
  try {
    const details = await fn();
    checks.push({ name, pass: true, durationMs: Date.now() - startedAt, details: details || '' });
  } catch (error) {
    checks.push({
      name,
      pass: false,
      durationMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

async function findMontheyProject() {
  if (process.env.ORBITCODE_SMOKE_PROJECT) return path.resolve(process.env.ORBITCODE_SMOKE_PROJECT);
  const workspace = process.env.ORBITCODE_WORKSPACE || path.join(repoRoot, 'D');
  const entries = await fs.readdir(workspace, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('monthey-crop-intel-')) continue;
    const fullPath = path.join(workspace, entry.name);
    const stat = await fs.stat(fullPath);
    candidates.push({ path: fullPath, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates[0]) fail(`No monthey-crop-intel-* project found in ${workspace}`);
  return candidates[0].path;
}

function url(pathname, params = {}) {
  const u = new URL(pathname, base);
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, value);
  return u;
}

async function request(pathname, options = {}, params = {}) {
  const res = await fetch(url(pathname, params), options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Plain-text endpoints are fine.
  }
  return { res, text, json };
}

function parseSseEvents(text) {
  return text.split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function startStubProvider(projectFolder) {
  const previewUrl = String(url('/api/preview', { projectFolder, filePath: 'index.html' }));
  const browserScript = `
    await page.goto(${JSON.stringify(previewUrl)}, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body');
    const text = await page.innerText('body');
    if (!text.includes('Crop identification for Monthey')) {
      throw new Error('Monthey preview marker missing');
    }
    logs.push('agent-browser-smoke-ok');
  `;
  let callCount = 0;

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const body = JSON.parse(await readBody(req) || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const sawToolResult = messages.some((message) => message.role === 'tool');
    callCount += 1;
    const toolName = sawToolResult ? 'task_complete' : 'run_browser_test';
    const args = sawToolResult
      ? { summary: 'Agent browser smoke complete' }
      : { script: browserScript };

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `chatcmpl-smoke-${callCount}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'stub-browser-smoke',
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: `call_smoke_${callCount}`,
            type: 'function',
            function: {
              name: toolName,
              arguments: JSON.stringify(args),
            },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') fail('Stub provider did not bind to a local port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get callCount() { return callCount; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function attr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runGuiSmoke(project) {
  const projectName = path.basename(project);
  const screenshotPath = outputPath.replace(/\.json$/i, '.png');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('OrbitCode'), null, { timeout: 15000 });
    let body = await page.locator('body').innerText();
    const nestedButtonLikes = await page.locator('button button, [role="button"] button').count();
    if (nestedButtonLikes) fail(`GUI has nested button-like controls: ${nestedButtonLikes}`);

    if (!body.includes(projectName) || !body.includes('index.html')) {
      const opener = page.locator(`[title="Open ${attr(projectName)}"]`);
      if (await opener.count() < 1) fail(`Project card not visible: ${projectName}`);
      await opener.first().click();
      await page.waitForFunction((name) => document.body.innerText.includes(name), projectName, { timeout: 15000 });
      await page.waitForFunction(() => document.body.innerText.includes('index.html'), null, { timeout: 15000 });
      body = await page.locator('body').innerText();
    }

    for (const marker of [projectName, 'index.html', 'gee', 'OrbitCode Agent']) {
      if (!body.includes(marker)) fail(`GUI missing ${marker}`);
    }

    const indexFile = page.locator('aside').getByRole('button', { name: 'index.html' });
    if (await indexFile.count() !== 1) fail('File tree index.html button not visible');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/files') && res.url().includes('filePath=index.html'), { timeout: 20000 }),
      indexFile.click(),
    ]);
    try {
      await page.waitForFunction(() => /Monthey\s+Crop\s+Intel/.test(document.body.innerText), null, { timeout: 15000 });
    } catch {
      const text = await page.locator('body').innerText({ timeout: 5000 });
      fail(`index.html did not open in editor: ${text.slice(0, 500)}`);
    }

    const previewToggle = page.locator('[title="Toggle Preview"]');
    if (await previewToggle.count() !== 1) fail('Preview toggle not visible');
    const previewFrame = page.locator('iframe[title="Preview"]');
    if (await previewFrame.count() === 0) fail('Preview did not open automatically for index.html');
    await previewFrame.waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => {
      const iframe = document.querySelector('iframe[title="Preview"]');
      return iframe?.getAttribute('src')?.includes('filePath=index.html');
    }, null, { timeout: 15000 });
    const preview = page.frameLocator('iframe[title="Preview"]');
    await preview.getByText('Crop identification for Monthey').waitFor({ timeout: 20000 });
    const previewText = await preview.locator('body').innerText({ timeout: 5000 });
    if (!/Crop\s+identification\s+for\s+Monthey/.test(previewText)) {
      fail(`Preview iframe did not render Monthey app: ${previewText.slice(0, 300)}`);
    }
    if (/Unhandled Runtime Error|Application error|Module not found|404|500/.test(`${body}\n${previewText}`)) {
      fail('GUI contains runtime error text');
    }
    await page.locator('[title="Close preview"]').click();
    await previewFrame.waitFor({ state: 'detached', timeout: 15000 });
    await indexFile.click();
    await previewFrame.waitFor({ state: 'attached', timeout: 15000 });
    await preview.getByText('Crop identification for Monthey').waitFor({ timeout: 20000 });

    await page.screenshot({ path: screenshotPath, fullPage: false });
    if (consoleErrors.length) fail(`Console/page errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
    return `screenshot=${screenshotPath}`;
  } finally {
    await browser.close();
  }
}

async function main() {
  const project = await findMontheyProject();
  const workspace = process.env.ORBITCODE_WORKSPACE || path.dirname(project);
  const projectFolder = slash(project);

  await check('server responds', async () => {
    const { res, text } = await request('/');
    if (!res.ok || !text.includes('OrbitCode')) fail(`HTTP ${res.status}`);
    return `base=${base}`;
  });

  await check('projects API lists Monthey project', async () => {
    const { json } = await request('/api/projects', {}, { workspace });
    const found = json?.projects?.find((p) => samePath(p.path, project));
    if (!found?.isGitRepo) fail('Project missing or not reported as its own git repo');
    return `branch=${found.branch || ''}, fileCount=${found.fileCount}`;
  });

  await check('files API tree and read work', async () => {
    const tree = await request('/api/files', {}, { projectFolder });
    const names = (tree.json?.tree || []).map((node) => node.name);
    for (const expected of ['docs', 'gee', 'pages', 'public', 'src', 'tests', 'index.html', 'README.md', 'styles.css']) {
      if (!names.includes(expected)) fail(`Missing ${expected}`);
    }
    const file = await request('/api/files', {}, { projectFolder, filePath: 'gee/monthey_crop_workflow.py' });
    if (!file.json?.content?.includes('Earth Engine') || !file.json.content.includes('Monthey')) {
      fail('GEE workflow markers missing');
    }
    return names.join(',');
  });

  await check('files API rejects traversal', async () => {
    const { res } = await request('/api/files', {}, { projectFolder, filePath: '../package.json' });
    if (res.status !== 403) fail(`Expected 403, got ${res.status}`);
  });

  await check('preview API serves app and public fallback', async () => {
    const index = await request('/api/preview', {}, { projectFolder, filePath: 'index.html' });
    if (!index.res.ok || !index.text.includes('orbitcode:preview-location') || !index.text.includes('Monthey Crop Intel')) {
      fail(`Index preview failed: HTTP ${index.res.status}`);
    }
    const mark = await request('/api/preview', {}, { projectFolder, filePath: 'mark.svg' });
    const type = mark.res.headers.get('content-type') || '';
    if (!mark.res.ok || !type.includes('image/svg+xml')) fail(`Public asset failed: HTTP ${mark.res.status}, ${type}`);
    const traversal = await request('/api/preview', {}, { projectFolder, filePath: '../package.json' });
    if (traversal.res.status !== 403) fail(`Preview traversal expected 403, got ${traversal.res.status}`);
    return `assetType=${type}`;
  });

  await check('git API state and target validation work', async () => {
    const state = await request('/api/git', {}, { cwd: projectFolder, action: 'state' });
    if (!state.json?.isRepo || !state.json.branch) fail('Git state missing repo/branch');
    const bad = await request('/api/git', {}, { cwd: projectFolder, action: 'diff', target: '--output=C:/tmp/nope' });
    if (bad.res.status !== 400) fail(`Bad diff target expected 400, got ${bad.res.status}`);
    return `branch=${state.json.branch}`;
  });

  await check('browser-session stop is idempotent', async () => {
    const { json } = await request('/api/browser-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    if (!json?.success) fail('Stop did not return success');
  });

  await check('preflight API reports runnable workspace', async () => {
    const { res, json, text } = await request('/api/preflight', {}, { projectFolder });
    if (!res.ok) fail(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    const checks = new Map((json?.checks || []).map((item) => [item.id, item]));
    for (const id of ['node', 'git', 'workspace', 'runs']) {
      const item = checks.get(id);
      if (!item || item.level === 'fail') fail(`Preflight ${id} failed or missing`);
    }
    return `overall=${json.overall}, pass=${json.summary?.pass}, warn=${json.summary?.warn}, fail=${json.summary?.fail}`;
  });

  if (runAgentBrowser) {
    await check('agent browser tool drives observable preview', async () => {
      const provider = await startStubProvider(projectFolder);
      try {
        const { res, text } = await request('/api/agent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: 'Use run_browser_test once to verify the Monthey preview, then finish.',
            projectFolder,
            projectContext: 'Deterministic OrbitCode smoke test. Do not write files or run shell commands.',
            providerKind: 'ollama',
            baseUrl: provider.baseUrl,
            model: 'stub-browser-smoke',
            maxAgentTurns: 3,
            orchestrated: false,
          }),
        });
        if (!res.ok) fail(`HTTP ${res.status}: ${text.slice(0, 500)}`);
        const events = parseSseEvents(text);
        const textDump = events.map((event) => `${event.type}:${event.toolName || ''}:${event.content || ''}`).join('\n');
        if (!events.some((event) => event.type === 'tool_call' && event.toolName === 'run_browser_test')) {
          fail('SSE missing run_browser_test tool call');
        }
        if (!events.some((event) => event.toolName === 'browser_step')) {
          fail('SSE missing browser_step progress');
        }
        if (!/Browser session completed successfully/.test(textDump)) {
          fail('Browser runner did not report success');
        }
        if (!events.some((event) => event.type === 'complete' && String(event.content || '').includes('Agent browser smoke complete'))) {
          fail('Agent did not complete after browser tool');
        }
        if (/ERROR during browser execution|BUILD VERIFICATION FAILED/.test(textDump)) {
          fail('Agent browser smoke reported an error');
        }

        const session = await request('/api/browser-session', {}, { projectFolder });
        if (!session.json?.session?.stepCount || session.json.session.stepCount < 2) {
          fail('Browser session API did not expose captured steps');
        }
        return `events=${events.length}, steps=${session.json.session.stepCount}, providerCalls=${provider.callCount}`;
      } finally {
        await provider.close();
      }
    });

    await check('runs API exposes browser evidence', async () => {
      const list = await request('/api/runs', {}, { projectFolder });
      const browserRun = list.json?.runs?.find((run) => run.type === 'browser' && run.status === 'complete' && run.stepCount >= 2);
      if (!browserRun) fail('No completed browser run listed');

      const detail = await request('/api/runs', {}, { projectFolder, runId: browserRun.id });
      if (!detail.res.ok) fail(`Run detail HTTP ${detail.res.status}`);
      if (!detail.json?.manifest?.sessionId || detail.json.manifest.status !== 'complete') {
        fail('Run detail missing completed browser manifest');
      }
      if (!Array.isArray(detail.json.screenshots) || detail.json.screenshots.length < 2) {
        fail('Run detail missing browser screenshots');
      }
      if (!String(detail.json.rawLogs || '').includes('agent-browser-smoke-ok')) {
        fail('Run detail missing browser log');
      }
      return `run=${browserRun.id}, screenshots=${detail.json.screenshots.length}`;
    });
  }

  await check('Monthey project logic smoke passes', async () => {
    const result = spawnSync(process.execPath, ['tests/logic-smoke.mjs'], { cwd: project, encoding: 'utf8' });
    if (result.status !== 0) fail((result.stderr || result.stdout || 'logic smoke failed').trim());
    return result.stdout.trim();
  });

  if (runGui) {
    await check('GUI opens project and renders preview', () => runGuiSmoke(project));
  }

  if (runProvider) {
    await check('provider test returns visible text', async () => {
      const { res, json, text } = await request('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerKind: 'ollama', baseUrl: providerBaseUrl, model: providerModel }),
      });
      if (!res.ok || !json?.ok || !String(json.text || '').trim()) fail(text || `HTTP ${res.status}`);
      return `${json.providerKind}/${json.model}: ${json.text}`;
    });
  }

  if (runAgent) {
    await check('agent SSE list-files smoke passes', async () => {
      const { res, text } = await request('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Run a read-only smoke test: list files in the project root using list_files once, then call task_complete with exactly "Agent smoke listed files". Do not write files or run commands.',
          projectFolder,
          projectContext: 'Read-only OrbitCode smoke test project.',
          providerKind: 'ollama',
          baseUrl: providerBaseUrl,
          model: providerModel,
          maxAgentTurns: 4,
          orchestrated: false,
        }),
      });
      if (!res.ok) fail(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      const events = parseSseEvents(text);
      const types = events.map((event) => event.type);
      const tools = events.map((event) => event.toolName).filter(Boolean);
      if (!types.includes('tool_call') || !tools.includes('list_files') || !text.includes('Agent smoke listed files')) {
        fail(`Agent smoke missing expected events: ${types.join(',')}`);
      }
      return `events=${events.length}`;
    });
  }

  const summary = {
    ok: checks.every((item) => item.pass),
    base,
    project: projectFolder,
    checkedAt: new Date().toISOString(),
    checks,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch(async (error) => {
  const summary = {
    ok: false,
    base,
    checkedAt: new Date().toISOString(),
    fatal: error instanceof Error ? error.message : String(error),
    checks,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), 'utf8');
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
});
