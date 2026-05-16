/* OrbitCode — GCP Workflow Helper API
 *
 * GET  /api/gcp?action=preflight           → readiness check (gcloud + auth + project + region)
 * POST /api/gcp  body={ action:'preflight' }           → same as GET, for convenience
 * POST /api/gcp  body={ action:'deploy-plan', ... }    → returns a structured deploy plan
 *   - This does NOT execute a deploy. It produces the command set, estimated impact,
 *     and explicit approval payload that the UI must show to the user before
 *     any gcloud command is actually run.
 *
 * Why this exists: the audit noted that "Fully autonomous deployment" was an
 * overstatement. This endpoint replaces the one-shot `gcloud run` invocation
 * with a gated, structured plan/readiness flow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const pexec = promisify(exec);

type Level = 'pass' | 'warn' | 'fail';

async function run(cmd: string, timeoutMs = 6000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await pexec(cmd, { timeout: timeoutMs, windowsHide: true });
    return { ok: true, out: (stdout || '').trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

interface GcpCheck {
  id: string;
  label: string;
  level: Level;
  detail: string;
  remediation?: string;
}

async function gcpPreflight(): Promise<{ overall: Level; checks: GcpCheck[] }> {
  const checks: GcpCheck[] = [];

  const present = await run(process.platform === 'win32' ? 'where gcloud' : 'command -v gcloud');
  if (!present.ok) {
    checks.push({
      id: 'cli', label: 'gcloud CLI',
      level: 'fail',
      detail: 'gcloud not on PATH.',
      remediation: 'Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install',
    });
    return { overall: 'fail', checks };
  }
  const ver = await run('gcloud --version');
  checks.push({
    id: 'cli', label: 'gcloud CLI',
    level: 'pass',
    detail: ver.out.split('\n')[0] || 'available',
  });

  const auth = await run('gcloud auth list --format="value(account)"', 10000);
  const accounts = auth.out.split('\n').filter(Boolean);
  if (accounts.length === 0) {
    checks.push({
      id: 'auth', label: 'Authenticated account',
      level: 'fail',
      detail: 'No authenticated gcloud account.',
      remediation: 'Run: gcloud auth login && gcloud auth application-default login',
    });
  } else {
    checks.push({
      id: 'auth', label: 'Authenticated account',
      level: 'pass',
      detail: accounts[0],
    });
  }

  const project = (await run('gcloud config get-value project')).out.trim();
  if (!project || project === '(unset)') {
    checks.push({
      id: 'project', label: 'Active project',
      level: 'fail',
      detail: 'No active project.',
      remediation: 'Run: gcloud config set project <YOUR_PROJECT_ID>',
    });
  } else {
    checks.push({ id: 'project', label: 'Active project', level: 'pass', detail: project });
  }

  const region = (await run('gcloud config get-value run/region')).out.trim();
  if (!region || region === '(unset)') {
    checks.push({
      id: 'region', label: 'Default Cloud Run region',
      level: 'warn',
      detail: 'No default region configured.',
      remediation: 'Run: gcloud config set run/region us-central1',
    });
  } else {
    checks.push({ id: 'region', label: 'Default Cloud Run region', level: 'pass', detail: region });
  }

  // Application-default credentials file (required for Vertex SDK as well)
  const adc = await run(
    process.platform === 'win32'
      ? 'if exist "%APPDATA%\\gcloud\\application_default_credentials.json" (echo yes) else (echo no)'
      : 'test -f "$HOME/.config/gcloud/application_default_credentials.json" && echo yes || echo no',
    3000
  );
  if (/yes/i.test(adc.out)) {
    checks.push({ id: 'adc', label: 'Application default credentials', level: 'pass', detail: 'present' });
  } else {
    checks.push({
      id: 'adc', label: 'Application default credentials',
      level: 'warn',
      detail: 'ADC file not found — Vertex AI calls will fail.',
      remediation: 'Run: gcloud auth application-default login',
    });
  }

  const fail = checks.find(c => c.level === 'fail');
  const warn = checks.find(c => c.level === 'warn');
  return { overall: fail ? 'fail' : warn ? 'warn' : 'pass', checks };
}

interface DeployPlanInput {
  service: string;
  image?: string;
  region?: string;
  allowUnauthenticated?: boolean;
  env?: Record<string, string>;
}

function buildDeployPlan(input: DeployPlanInput, activeProject: string, defaultRegion: string) {
  const region = input.region || defaultRegion || 'us-central1';
  const image = input.image || `gcr.io/${activeProject}/${input.service}:latest`;

  const flags = [
    `--image ${image}`,
    `--region ${region}`,
    input.allowUnauthenticated ? '--allow-unauthenticated' : '--no-allow-unauthenticated',
  ];
  if (input.env && Object.keys(input.env).length > 0) {
    const pairs = Object.entries(input.env).map(([k, v]) => `${k}=${v}`).join(',');
    flags.push(`--set-env-vars ${pairs}`);
  }

  const command = `gcloud run deploy ${input.service} ${flags.join(' ')}`;

  const impact: string[] = [
    `Service: ${input.service}`,
    `Region: ${region}`,
    `Image: ${image}`,
    `Project: ${activeProject}`,
    input.allowUnauthenticated
      ? 'PUBLIC — the service will be reachable by unauthenticated callers.'
      : 'PRIVATE — IAM will be required to invoke.',
  ];

  return { command, flags, impact };
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action') || 'preflight';
  if (action === 'preflight') {
    return NextResponse.json(await gcpPreflight());
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: { action?: string } & Partial<DeployPlanInput> = {};
  try { body = await request.json(); } catch { /* fine */ }

  const action = body.action || 'preflight';

  if (action === 'preflight') {
    return NextResponse.json(await gcpPreflight());
  }

  if (action === 'deploy-plan') {
    if (!body.service) {
      return NextResponse.json({ error: 'service is required' }, { status: 400 });
    }
    const pre = await gcpPreflight();
    if (pre.overall === 'fail') {
      return NextResponse.json({
        error: 'GCP preflight failed — cannot plan deploy',
        preflight: pre,
      }, { status: 409 });
    }
    const project = pre.checks.find(c => c.id === 'project')?.detail || '';
    const region = pre.checks.find(c => c.id === 'region')?.detail || 'us-central1';
    const plan = buildDeployPlan(body as DeployPlanInput, project, region);
    return NextResponse.json({
      preflight: pre,
      plan,
      requiresApproval: true,
      notes: [
        'This plan is NOT executed automatically.',
        'Review the command and impact, then run it from the guarded terminal.',
        'The terminal will classify `gcloud ... delete` as destructive and require a second approval.',
      ],
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
