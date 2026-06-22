/* OrbitCode — Git API Route (State-Engine Driven) */
import { NextRequest, NextResponse } from 'next/server';
import { generateAiText } from '@/lib/ai/providerClient';
import { resolveModelConfig } from '@/lib/ai/providerStore';
import { inspectRepoState } from '@/lib/git/gitInspect';
import { evaluateAction, executeAction } from '@/lib/git/gitStateEngine';
import type { GitAction } from '@/lib/types';
import { execFileSync } from 'child_process';

function runGit(args: string[], cwd: string): { success: boolean; output: string } {
  try {
    const output = execFileSync('git', args, {
      cwd, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    const msg = error instanceof Error ? (error as NodeJS.ErrnoException & { stderr?: string }).stderr || error.message : 'Git error';
    return { success: false, output: typeof msg === 'string' ? msg.trim() : String(msg) };
  }
}

function safeGitRef(value: string): string | null {
  if (!value || value.startsWith('-') || !/^[A-Za-z0-9._/@{}^~:+-]+$/.test(value)) return null;
  return value;
}

// GET: Git status info, branches, diff, full state
export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get('cwd');
  const action = request.nextUrl.searchParams.get('action');
  if (!cwd) return NextResponse.json({ error: 'cwd required' }, { status: 400 });

  // Full repo state (new engine-powered endpoint)
  if (action === 'state') {
    const state = inspectRepoState(cwd);
    return NextResponse.json(state);
  }

  // Branch listing
  if (action === 'branches') {
    const result = runGit(['branch', '-a'], cwd);
    if (!result.success) return NextResponse.json({ branches: [] });
    const branches = result.output.split('\n').filter(Boolean).map((line) => {
      const current = line.startsWith('*');
      const name = line.replace(/^\*?\s+/, '').replace(/^remotes\/origin\//, '').trim();
      const remote = line.includes('remotes/');
      if (name.includes('HEAD')) return null;
      return { name, current, remote };
    }).filter(Boolean);
    const seen = new Set<string>();
    const unique = branches.filter((b) => {
      if (!b || seen.has(b.name)) return false;
      seen.add(b.name);
      return true;
    });
    return NextResponse.json({ branches: unique });
  }

  // Diff
  if (action === 'diff') {
    const diffTarget = safeGitRef(request.nextUrl.searchParams.get('target') || 'HEAD');
    if (!diffTarget) return NextResponse.json({ error: 'Invalid diff target' }, { status: 400 });
    const result = runGit(['diff', diffTarget], cwd);
    const stagedResult = runGit(['diff', '--cached'], cwd);
    return NextResponse.json({
      diff: result.success ? result.output : '',
      staged: stagedResult.success ? stagedResult.output : '',
    });
  }

  // PR summary generation
  if (action === 'pr-info') {
    const baseBranch = safeGitRef(request.nextUrl.searchParams.get('base') || 'main');
    if (!baseBranch) return NextResponse.json({ error: 'Invalid base branch' }, { status: 400 });
    const range = `${baseBranch}..HEAD`;
    const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    const log = runGit(['log', range, '--oneline'], cwd);
    const diffstat = runGit(['diff', '--stat', range], cwd);
    const diff = runGit(['diff', range], cwd);
    return NextResponse.json({
      branch: branch.success ? branch.output : '—',
      base: baseBranch,
      commits: log.success ? log.output.split('\n').filter(Boolean) : [],
      diffstat: diffstat.success ? diffstat.output : '',
      diff: diff.success ? diff.output.substring(0, 50000) : '',
    });
  }

  // Default: Full status (backward-compatible + engine state)
  const state = inspectRepoState(cwd);
  if (!state.isRepo) {
    return NextResponse.json({ isRepo: false, error: state.inspectionError || 'Not a git repository' });
  }

  const log = runGit(['log', '--oneline', '-5'], cwd);

  return NextResponse.json({
    isRepo: true,
    branch: state.branch || 'HEAD (detached)',
    remote: state.remoteUrl,
    modified: state.unstagedChanges.filter(c => c.status === 'modified').length,
    added: state.stagedChanges.filter(c => c.status === 'added').length + state.unstagedChanges.filter(c => c.status === 'added').length,
    deleted: state.unstagedChanges.filter(c => c.status === 'deleted').length,
    untracked: state.untrackedFiles.length,
    ahead: state.ahead,
    behind: state.behind,
    diverged: state.diverged,
    totalChanges: state.unstagedChanges.length + state.stagedChanges.length + state.untrackedFiles.length,
    recentCommits: log.success ? log.output.split('\n').filter(Boolean) : [],
    statusLines: state.rawStatusOutput.split('\n').filter(Boolean).slice(0, 50),
    // Engine state extras
    isDetachedHead: state.isDetachedHead,
    isClean: state.isClean,
    mergeInProgress: state.mergeInProgress,
    rebaseInProgress: state.rebaseInProgress,
    cherryPickInProgress: state.cherryPickInProgress,
    hasLockFile: state.hasLockFile,
    hasUpstream: state.hasUpstream,
    conflictedFiles: state.conflictedFiles,
    stashCount: state.stashCount,
  });
}

// POST: Git operations — all routed through state engine
export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action || body.operation;
  const { cwd, message, branch: branchName, files, url } = body;

  if (!action || !cwd) {
    return NextResponse.json({ error: 'action and cwd required' }, { status: 400 });
  }

  // Evaluate action: pre-flight check (new engine endpoint)
  if (action === 'evaluate') {
    const targetAction = body.targetAction as GitAction;
    if (!targetAction) return NextResponse.json({ error: 'targetAction required' }, { status: 400 });
    const state = inspectRepoState(cwd);
    const evaluation = evaluateAction(state, targetAction);
    return NextResponse.json({ evaluation, state });
  }

  // Engine-powered actions
  const engineActions: Set<string> = new Set([
    'pull', 'pull-merge', 'pull-rebase', 'push', 'publish-branch',
    'checkout', 'create-branch', 'delete-branch',
    'stash', 'stash-untracked', 'stash-pop', 'stash-and-pull', 'stash-untracked-and-pull',
    'fetch', 'sync',
    'continue-rebase', 'abort-rebase', 'continue-merge', 'abort-merge',
    'remove-lock',
  ]);

  if (engineActions.has(action)) {
    // Pre-flight state check
    const state = inspectRepoState(cwd);
    const evaluation = evaluateAction(state, action as GitAction);

    // For blocking actions, return evaluation instead of executing
    // Exception: composite/recovery actions handle their own blocking
    const bypassBlocker = new Set([
      'stash-and-pull', 'stash-untracked-and-pull',
      'stash', 'stash-untracked', 'stash-pop',
      'abort-rebase', 'abort-merge', 'remove-lock',
    ]);
    if (!evaluation.canProceed && !bypassBlocker.has(action)) {
      return NextResponse.json({
        blocked: true,
        evaluation,
        state,
      });
    }

    // Execute
    const result = await executeAction(cwd, action as GitAction, {
      branch: branchName,
      message,
      files,
    });

    // Attach updated state
    result.updatedState = inspectRepoState(cwd);

    return NextResponse.json({
      success: result.success,
      output: result.output,
      partialSuccess: result.partialSuccess,
      partialMessage: result.partialMessage,
      state: result.updatedState,
      blocked: false,
    });
  }

  // Legacy actions still handled directly
  let result;
  switch (action) {
    case 'add':
      result = runGit(['add', '--', ...(Array.isArray(files) && files.length ? files.map(String) : ['.'])], cwd);
      break;
    case 'commit':
      if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
      runGit(['add', '-A', '--', '.'], cwd);
      result = runGit(['commit', '-m', String(message)], cwd);
      break;
    case 'set-remote': {
      if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
      runGit(['remote', 'remove', 'origin'], cwd);
      result = runGit(['remote', 'add', 'origin', String(url)], cwd);
      if (result.success) {
        const branchResult = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
        if (branchResult.success) {
          runGit(['fetch', 'origin'], cwd);
        }
      }
      break;
    }
    case 'branches':
      result = runGit(['branch', '-a'], cwd);
      break;
    case 'generate-commit-msg': {
      // AI-powered commit message generation using the selected provider.
      const diffResult = runGit(['diff', 'HEAD'], cwd);
      const statusResult = runGit(['status', '--porcelain'], cwd);
      if (!diffResult.output && !statusResult.output) {
        return NextResponse.json({ success: false, output: 'No changes to describe' });
      }
      try {
        const diffText = (diffResult.output || '').substring(0, 8000);
        const statusText = statusResult.output || '';
        const prompt = [
          'Generate a concise, professional git commit message for the following changes.',
          'Format: First line is a short summary (max 72 chars, imperative mood).',
          'Then a blank line, then 2-4 bullet points describing key changes.',
          'Do not include markdown formatting or code fences. Plain text only.',
          '', '--- STATUS ---', statusText, '', '--- DIFF ---', diffText,
        ].join('\n');

        const aiConfig = await resolveModelConfig({ temperature: 0.3, maxOutputTokens: 256 });
        const commitMsg = (await generateAiText(
          aiConfig,
          [{ role: 'user', content: prompt }],
          'You are a commit message generator. Output ONLY the commit message, nothing else.',
        )).trim();
        return NextResponse.json({ success: true, output: commitMsg });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'AI generation failed';
        return NextResponse.json({ success: false, output: `Commit message generation failed: ${errMsg}` });
      }
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  return NextResponse.json(result);
}
