/* OrbitCode — Git Repository State Inspector */
import { execSync } from 'child_process';
import type { RepoState, FileChange } from '@/lib/types';

function git(args: string, cwd: string): { ok: boolean; out: string } {
  try {
    const out = execSync(`git ${args}`, {
      cwd, encoding: 'utf-8', timeout: 15000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    return { ok: false, out: (err.stderr || err.stdout || err.message || '').trim() };
  }
}

/** Resolve a git-internal path (works with worktrees) */
function gitPath(cwd: string, subpath: string): string | null {
  const r = git(`rev-parse --git-path ${subpath}`, cwd);
  if (!r.ok) return null;
  // git rev-parse --git-path returns relative to cwd
  const path = require('path');
  return path.resolve(cwd, r.out);
}

function fileExists(p: string | null): boolean {
  if (!p) return false;
  try { require('fs').statSync(p); return true; } catch { return false; }
}

function dirExists(p: string | null): boolean {
  if (!p) return false;
  try { return require('fs').statSync(p).isDirectory(); } catch { return false; }
}

function parseStatusV2(raw: string): { staged: FileChange[]; unstaged: FileChange[]; untracked: string[]; conflicted: string[] } {
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];

  for (const line of raw.split('\n')) {
    if (!line) continue;
    if (line.startsWith('? ')) {
      untracked.push(line.slice(2));
      continue;
    }
    if (line.startsWith('u ')) {
      // Unmerged entry
      const parts = line.split('\t');
      const fp = parts[parts.length - 1] || line.slice(2);
      conflicted.push(fp);
      continue;
    }
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1] || '..';
      const x = xy[0]; // index/staged
      const y = xy[1]; // worktree
      // File path is after the last tab (for renames) or last space
      const tabIdx = line.indexOf('\t');
      const fp = tabIdx >= 0 ? line.slice(tabIdx + 1).split('\t')[0] : parts[parts.length - 1];

      const statusMap: Record<string, FileChange['status']> = {
        'M': 'modified', 'A': 'added', 'D': 'deleted', 'R': 'renamed', 'C': 'copied',
      };
      if (x && x !== '.' && statusMap[x]) {
        staged.push({ path: fp, status: statusMap[x], staged: true });
      }
      if (y && y !== '.' && statusMap[y]) {
        unstaged.push({ path: fp, status: statusMap[y], staged: false });
      }
    }
  }
  return { staged, unstaged, untracked, conflicted };
}

/** Full repo state inspection — the core of the git state engine */
export function inspectRepoState(cwd: string): RepoState {
  const empty: RepoState = {
    isRepo: false, isCorrupt: false, branch: null, isDetachedHead: false,
    isClean: true, unstagedChanges: [], stagedChanges: [], untrackedFiles: [],
    hasConflictMarkers: false, conflictedFiles: [],
    mergeInProgress: false, rebaseInProgress: false,
    cherryPickInProgress: false, revertInProgress: false, hasLockFile: false,
    hasRemote: false, remoteUrl: null, hasUpstream: false, upstream: null,
    ahead: 0, behind: 0, diverged: false, stashCount: 0,
    rawStatusOutput: '',
  };

  // Check if it's a repo
  const gitDir = git('rev-parse --git-dir', cwd);
  if (!gitDir.ok) return { ...empty, inspectionError: 'Not a git repository' };

  try {
    const state = { ...empty, isRepo: true };

    // Branch
    const branch = git('rev-parse --abbrev-ref HEAD', cwd);
    if (branch.ok) {
      state.branch = branch.out === 'HEAD' ? null : branch.out;
      state.isDetachedHead = branch.out === 'HEAD';
    }

    // Status (porcelain v2 for structured parsing)
    const status = git('status --porcelain=v2', cwd);
    state.rawStatusOutput = status.ok ? status.out : status.out;
    if (status.ok && status.out) {
      const parsed = parseStatusV2(status.out);
      state.stagedChanges = parsed.staged;
      state.unstagedChanges = parsed.unstaged;
      state.untrackedFiles = parsed.untracked;
      state.conflictedFiles = parsed.conflicted;
    }
    state.isClean = state.stagedChanges.length === 0
      && state.unstagedChanges.length === 0
      && state.untrackedFiles.length === 0
      && state.conflictedFiles.length === 0;

    // Conflict markers
    if (state.conflictedFiles.length > 0) {
      state.hasConflictMarkers = true;
    } else {
      const diffCheck = git('diff --check', cwd);
      state.hasConflictMarkers = !diffCheck.ok && diffCheck.out.includes('conflict');
    }

    // Operations in progress (via git rev-parse --git-path for worktree safety)
    state.mergeInProgress = fileExists(gitPath(cwd, 'MERGE_HEAD'));
    state.rebaseInProgress = dirExists(gitPath(cwd, 'rebase-merge')) || dirExists(gitPath(cwd, 'rebase-apply'));
    state.cherryPickInProgress = fileExists(gitPath(cwd, 'CHERRY_PICK_HEAD'));
    state.revertInProgress = fileExists(gitPath(cwd, 'REVERT_HEAD'));
    state.hasLockFile = fileExists(gitPath(cwd, 'index.lock'));

    // Remote
    const remote = git('remote get-url origin', cwd);
    state.hasRemote = remote.ok;
    state.remoteUrl = remote.ok ? remote.out : null;

    // Upstream tracking
    const upstream = git('rev-parse --abbrev-ref @{upstream}', cwd);
    state.hasUpstream = upstream.ok;
    state.upstream = upstream.ok ? upstream.out : null;

    // Ahead/behind
    if (state.hasUpstream) {
      const ab = git('rev-list --left-right --count HEAD...@{upstream}', cwd);
      if (ab.ok) {
        const parts = ab.out.split(/\s+/);
        state.ahead = parseInt(parts[0] || '0', 10);
        state.behind = parseInt(parts[1] || '0', 10);
        state.diverged = state.ahead > 0 && state.behind > 0;
      }
    }

    // Stash count
    const stash = git('stash list', cwd);
    state.stashCount = stash.ok && stash.out ? stash.out.split('\n').filter(Boolean).length : 0;

    return state;
  } catch (e) {
    return { ...empty, isRepo: true, isCorrupt: true, inspectionError: String(e) };
  }
}

/** Classify a raw git error string into a known category */
export function classifyGitError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('authentication failed') || s.includes('could not read username') || s.includes('permission denied (publickey)'))
    return 'auth_failed';
  if (s.includes('non-fast-forward') || s.includes('fetch first') || s.includes('updates were rejected'))
    return 'non_fast_forward';
  if (s.includes('would be overwritten by'))
    return 'would_overwrite';
  if (s.includes('conflict') && (s.includes('merge') || s.includes('rebase')))
    return 'conflict';
  if (s.includes('not a git repository'))
    return 'not_repo';
  if (s.includes('does not exist') && s.includes('remote'))
    return 'remote_not_found';
  if (s.includes('couldn\'t find remote ref') || s.includes('no such remote'))
    return 'ref_not_found';
  if (s.includes('index.lock'))
    return 'lock_file';
  if (s.includes('cannot pull with rebase') || s.includes('unstaged changes'))
    return 'dirty_tree';
  if (s.includes('refusing to merge unrelated histories'))
    return 'unrelated_histories';
  return 'unknown';
}
