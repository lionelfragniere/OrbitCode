/* OrbitCode — Git Action Evaluator & Executor */
import { execSync } from 'child_process';
import type { RepoState, GitAction, ActionEvaluation, ActionResult, RecoveryAction } from '@/lib/types';
import { inspectRepoState, classifyGitError } from './gitInspect';

function git(args: string, cwd: string): { ok: boolean; out: string } {
  try {
    const out = execSync(`git ${args}`, {
      cwd, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    return { ok: false, out: (err.stderr || err.stdout || err.message || '').trim() };
  }
}

// ── Recovery action builders ──

const RA_COMMIT_FIRST: RecoveryAction = {
  id: 'commit-first', label: '💾 Commit changes first',
  description: 'Stage and commit your current changes before proceeding.',
  risk: 'safe', confirmRequired: false,
};
const RA_STASH_AND_PULL: RecoveryAction = {
  id: 'stash-and-pull', label: '📦 Stash changes and pull',
  description: 'Temporarily saves your tracked changes, pulls remote updates, then reapplies them.',
  risk: 'safe', confirmRequired: false,
};
const RA_STASH_UNTRACKED_AND_PULL: RecoveryAction = {
  id: 'stash-untracked-and-pull', label: '📦 Stash all (incl. untracked) and pull',
  description: 'Stashes both tracked and untracked files, pulls, then reapplies your changes.',
  risk: 'safe', confirmRequired: false,
};
const RA_REVIEW_CHANGES: RecoveryAction = {
  id: 'review-changes', label: '👀 Review changes',
  description: 'Open the diff viewer to review your current changes.',
  risk: 'safe', confirmRequired: false,
};
const RA_DISCARD_ALL: RecoveryAction = {
  id: 'discard-all', label: '🗑 Discard all changes',
  description: 'Permanently discard ALL uncommitted changes. This cannot be undone.',
  risk: 'destructive', confirmRequired: true,
};
const RA_PULL_MERGE: RecoveryAction = {
  id: 'pull-merge', label: '🔀 Pull with merge',
  description: 'Merge remote commits into your branch. Creates a merge commit.',
  risk: 'safe', confirmRequired: false,
};
const RA_PULL_REBASE: RecoveryAction = {
  id: 'pull-rebase', label: '🔄 Pull with rebase',
  description: 'Replay your local commits on top of remote changes. Keeps history linear.',
  risk: 'moderate', confirmRequired: false,
};
const RA_FETCH_ONLY: RecoveryAction = {
  id: 'fetch', label: '📥 Fetch only',
  description: 'Download remote changes without applying them. You can review first.',
  risk: 'safe', confirmRequired: false,
};
const RA_PUBLISH: RecoveryAction = {
  id: 'publish-branch', label: '🚀 Publish branch',
  description: 'Push this branch to the remote and set up tracking.',
  risk: 'safe', confirmRequired: false,
};
const RA_CONTINUE_REBASE: RecoveryAction = {
  id: 'continue-rebase', label: '▶ Continue rebase',
  description: 'Continue the rebase after resolving conflicts.',
  risk: 'safe', confirmRequired: false,
};
const RA_ABORT_REBASE: RecoveryAction = {
  id: 'abort-rebase', label: '⏹ Abort rebase',
  description: 'Cancel the rebase and return to the state before it started.',
  risk: 'safe', confirmRequired: false,
};
const RA_CONTINUE_MERGE: RecoveryAction = {
  id: 'continue-merge', label: '▶ Continue merge',
  description: 'Complete the merge after resolving conflicts.',
  risk: 'safe', confirmRequired: false,
};
const RA_ABORT_MERGE: RecoveryAction = {
  id: 'abort-merge', label: '⏹ Abort merge',
  description: 'Cancel the merge and return to the state before it started.',
  risk: 'safe', confirmRequired: false,
};
const RA_REMOVE_LOCK: RecoveryAction = {
  id: 'remove-lock', label: '🔓 Remove lock file',
  description: 'Delete the .git/index.lock file left by an interrupted operation.',
  risk: 'moderate', confirmRequired: true,
};
const RA_STASH_AND_SWITCH: RecoveryAction = {
  id: 'stash-and-switch', label: '📦 Stash changes and switch',
  description: 'Temporarily saves your changes, switches branch, then you can pop the stash later.',
  risk: 'safe', confirmRequired: false,
};
const RA_CANCEL: RecoveryAction = {
  id: 'cancel', label: 'Cancel',
  description: 'Do nothing and stay on the current branch.',
  risk: 'safe', confirmRequired: false,
};

// ── Evaluator ──

function checkCommonBlockers(state: RepoState): { blockers: string[]; recoveries: RecoveryAction[] } {
  const blockers: string[] = [];
  const recoveries: RecoveryAction[] = [];

  if (state.hasLockFile) {
    blockers.push('Git is locked (index.lock exists). A previous git operation may have been interrupted.');
    recoveries.push(RA_REMOVE_LOCK, RA_CANCEL);
  }
  if (state.isCorrupt) {
    blockers.push('The git repository appears to be corrupted or in an invalid state.');
  }
  if (!state.isRepo) {
    blockers.push('This directory is not a git repository.');
  }
  return { blockers, recoveries };
}

/** Evaluate whether an action can proceed given current repo state */
export function evaluateAction(state: RepoState, action: GitAction): ActionEvaluation {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const recoveryActions: RecoveryAction[] = [];
  let summary = '';
  const details = state.rawStatusOutput;

  // Common blockers
  const common = checkCommonBlockers(state);
  blockers.push(...common.blockers);
  recoveryActions.push(...common.recoveries);
  if (blockers.length > 0) {
    return { canProceed: false, summary: blockers[0], warnings, blockers, recoveryActions, technicalDetails: details };
  }

  const dirtyCount = state.unstagedChanges.length + state.stagedChanges.length + state.untrackedFiles.length;
  const isDirty = !state.isClean;

  switch (action) {
    case 'pull':
    case 'pull-merge':
    case 'pull-rebase':
    case 'stash-and-pull':
    case 'stash-untracked-and-pull':
    case 'sync': {
      // Check operation in progress
      if (state.mergeInProgress) {
        blockers.push('A merge is in progress. Complete or abort it before pulling.');
        recoveryActions.push(RA_CONTINUE_MERGE, RA_ABORT_MERGE);
        summary = 'Merge in progress — resolve it before pulling.';
        break;
      }
      if (state.rebaseInProgress) {
        blockers.push('A rebase is in progress. Complete or abort it before pulling.');
        recoveryActions.push(RA_CONTINUE_REBASE, RA_ABORT_REBASE);
        summary = 'Rebase in progress — resolve it before pulling.';
        break;
      }
      // Check remote
      if (!state.hasRemote) {
        blockers.push('No remote configured for this repository.');
        summary = 'No remote configured.';
        break;
      }
      if (!state.hasUpstream) {
        blockers.push('This branch has no upstream tracking branch.');
        recoveryActions.push(RA_PUBLISH);
        summary = `Branch "${state.branch}" has no upstream tracking.`;
        break;
      }
      // Dirty tree
      if (isDirty && action !== 'stash-and-pull' && action !== 'stash-untracked-and-pull') {
        const hasUntracked = state.untrackedFiles.length > 0;
        const trackedCount = state.unstagedChanges.length + state.stagedChanges.length;
        blockers.push(
          trackedCount > 0 && hasUntracked
            ? `You have ${trackedCount} modified file(s) and ${state.untrackedFiles.length} untracked file(s). These must be committed or stashed before pulling.`
            : trackedCount > 0
              ? `You have ${trackedCount} uncommitted change(s) that would be overwritten by the pull.`
              : `You have ${state.untrackedFiles.length} untracked file(s) that may conflict with incoming changes.`
        );
        recoveryActions.push(RA_STASH_AND_PULL);
        if (hasUntracked) recoveryActions.push(RA_STASH_UNTRACKED_AND_PULL);
        recoveryActions.push(RA_COMMIT_FIRST, RA_REVIEW_CHANGES, RA_DISCARD_ALL, RA_CANCEL);
        summary = `Pull is blocked: ${dirtyCount} uncommitted change(s).`;
        break;
      }
      // Good to go
      if (state.behind > 0 && state.ahead > 0) {
        summary = `Your branch and ${state.upstream} have diverged (${state.ahead} ahead, ${state.behind} behind).`;
        if (action === 'pull' || action === 'sync') {
          recoveryActions.push(RA_PULL_MERGE, RA_PULL_REBASE, RA_FETCH_ONLY, RA_CANCEL);
        }
        warnings.push('You may need to choose merge or rebase strategy.');
      } else if (state.behind > 0) {
        summary = `Your branch is ${state.behind} commit(s) behind ${state.upstream}.`;
      } else {
        summary = 'Your branch is up to date.';
      }
      break;
    }

    case 'push':
    case 'publish-branch': {
      if (!state.hasRemote) {
        blockers.push('No remote configured.');
        summary = 'No remote configured.';
        break;
      }
      if (action === 'push' && !state.hasUpstream) {
        blockers.push('This branch has not been published to the remote.');
        recoveryActions.push(RA_PUBLISH);
        summary = `Branch "${state.branch}" needs to be published first.`;
        break;
      }
      if (state.behind > 0) {
        blockers.push(`Your branch is ${state.behind} commit(s) behind the remote. Pull before pushing.`);
        recoveryActions.push(RA_PULL_MERGE, RA_PULL_REBASE, RA_CANCEL);
        summary = `Push blocked: branch is ${state.behind} behind remote.`;
        break;
      }
      if (state.ahead === 0 && action !== 'publish-branch') {
        summary = 'Nothing to push — branch is up to date.';
        break;
      }
      summary = state.ahead > 0 ? `Ready to push ${state.ahead} commit(s).` : 'Ready to publish branch.';
      break;
    }

    case 'checkout': {
      if (state.mergeInProgress) {
        blockers.push('A merge is in progress. Finish or abort it before switching.');
        recoveryActions.push(RA_CONTINUE_MERGE, RA_ABORT_MERGE);
        summary = 'Cannot switch: merge in progress.';
        break;
      }
      if (state.rebaseInProgress) {
        blockers.push('A rebase is in progress. Finish or abort it before switching.');
        recoveryActions.push(RA_CONTINUE_REBASE, RA_ABORT_REBASE);
        summary = 'Cannot switch: rebase in progress.';
        break;
      }
      if (isDirty) {
        warnings.push(`You have ${dirtyCount} uncommitted change(s) that may be lost.`);
        recoveryActions.push(RA_COMMIT_FIRST, RA_STASH_AND_SWITCH, RA_DISCARD_ALL, RA_CANCEL);
        summary = `${dirtyCount} uncommitted change(s) — commit, stash, or discard before switching.`;
      } else {
        summary = 'Ready to switch branches.';
      }
      break;
    }

    case 'commit': {
      if (state.stagedChanges.length === 0 && state.unstagedChanges.length === 0 && state.untrackedFiles.length === 0) {
        blockers.push('No changes to commit.');
        summary = 'Nothing to commit — working tree is clean.';
      } else {
        summary = `${dirtyCount} change(s) ready to commit.`;
      }
      break;
    }

    case 'continue-rebase': {
      if (!state.rebaseInProgress) {
        blockers.push('No rebase is in progress.');
        summary = 'No rebase to continue.';
      } else if (state.hasConflictMarkers || state.conflictedFiles.length > 0) {
        blockers.push(`${state.conflictedFiles.length} file(s) still have conflicts. Resolve them first.`);
        summary = 'Resolve remaining conflicts before continuing.';
      } else {
        summary = 'Ready to continue rebase.';
      }
      break;
    }

    case 'abort-rebase': {
      if (!state.rebaseInProgress) {
        blockers.push('No rebase is in progress.');
      }
      summary = state.rebaseInProgress ? 'Will abort rebase and restore previous state.' : 'No rebase to abort.';
      break;
    }

    case 'continue-merge': {
      if (!state.mergeInProgress) {
        blockers.push('No merge is in progress.');
      } else if (state.conflictedFiles.length > 0) {
        blockers.push(`${state.conflictedFiles.length} file(s) still have conflicts.`);
        summary = 'Resolve remaining conflicts before continuing.';
      } else {
        summary = 'Ready to complete the merge.';
      }
      break;
    }

    case 'abort-merge': {
      if (!state.mergeInProgress) {
        blockers.push('No merge is in progress.');
      }
      summary = state.mergeInProgress ? 'Will abort merge and restore previous state.' : 'No merge to abort.';
      break;
    }

    default: {
      summary = `Action "${action}" ready.`;
    }
  }

  const hasDirtyBlocker = blockers.length > 0 && recoveryActions.some(r => r.id === 'stash-and-pull' || r.id === 'stash-and-switch');
  const canProceed = blockers.length === 0 || (action === 'checkout' && !state.mergeInProgress && !state.rebaseInProgress && !state.hasLockFile);

  return {
    canProceed: blockers.length === 0,
    summary: summary || (blockers.length > 0 ? blockers[0] : 'Ready.'),
    warnings,
    blockers,
    recoveryActions: recoveryActions.length > 0 ? recoveryActions : (blockers.length > 0 ? [RA_CANCEL] : []),
    technicalDetails: details,
  };
}

// ── Executor ──

/** Execute a git action. Call evaluateAction first to check for blockers. */
export async function executeAction(
  cwd: string, action: GitAction,
  opts?: { branch?: string; message?: string; files?: string[]; stashName?: string }
): Promise<ActionResult> {
  const fail = (msg: string, partial?: string): ActionResult => ({
    success: false, output: msg,
    ...(partial ? { partialSuccess: true, partialMessage: partial } : {}),
  });

  try {
    switch (action) {
      case 'pull-merge': {
        const r = git('pull --no-rebase', cwd);
        if (!r.ok) {
          const cat = classifyGitError(r.out);
          if (cat === 'auth_failed') return fail('Authentication failed. Check your credentials or SSH keys.');
          if (cat === 'conflict') return fail('Pull completed but there are merge conflicts to resolve.', 'Changes were downloaded from remote.');
          if (cat === 'ref_not_found') return fail('The remote branch no longer exists. It may have been renamed or deleted.');
          if (cat === 'would_overwrite' || cat === 'dirty_tree') {
            // Return a structured response the UI can route to the blocked dialog
            return {
              success: false,
              output: 'Pull blocked: your local changes would be overwritten. Stash or commit them first.',
              partialSuccess: false,
              partialMessage: r.out,
            };
          }
          return fail(`Pull failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: r.out || 'Pull complete.' };
      }

      case 'pull-rebase': {
        const r = git('pull --rebase', cwd);
        if (!r.ok) {
          const cat = classifyGitError(r.out);
          if (cat === 'conflict') {
            return fail('Rebase paused due to conflicts. Resolve conflicts, then continue or abort.', 'Remote changes were fetched.');
          }
          if (cat === 'dirty_tree') return fail('Cannot rebase with uncommitted changes. Commit or stash first.');
          if (cat === 'auth_failed') return fail('Authentication failed. Check your credentials or SSH keys.');
          if (cat === 'ref_not_found') return fail('The remote branch no longer exists. It may have been renamed or deleted.');
          return fail(`Pull (rebase) failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: r.out || 'Pull (rebase) complete.' };
      }

      case 'pull': {
        // Default to merge
        return executeAction(cwd, 'pull-merge', opts);
      }

      case 'stash-and-pull':
      case 'stash-untracked-and-pull': {
        const includeUntracked = action === 'stash-untracked-and-pull';
        const name = opts?.stashName || `OG auto-stash before pull - ${new Date().toISOString().slice(0, 19)}`;
        const stashArgs = includeUntracked
          ? `stash push --include-untracked -m "${name.replace(/"/g, '\\"')}"`
          : `stash push -m "${name.replace(/"/g, '\\"')}"`;

        // Step 1: Stash
        const s1 = git(stashArgs, cwd);
        if (!s1.ok) {
          if (s1.out.includes('No local changes')) {
            // Nothing to stash — try pulling directly
          } else {
            return fail(`Stash failed: ${friendlyError(s1.out)}`);
          }
        }
        const didStash = s1.ok && !s1.out.includes('No local changes');

        // Step 2: Pull (merge by default)
        const s2 = git('pull --no-rebase', cwd);
        if (!s2.ok) {
          // Try to restore stash even if pull failed
          if (didStash) git('stash pop', cwd);
          const cat = classifyGitError(s2.out);
          if (cat === 'auth_failed') return fail('Authentication failed. Your changes were restored from stash.');
          if (cat === 'ref_not_found') return fail('Remote branch not found. Your changes were restored from stash.');
          return fail(`Pull failed after stash: ${friendlyError(s2.out)}. Your changes were restored from stash.`);
        }

        if (!didStash) {
          return { success: true, output: 'Pull complete (no local changes needed stashing).' };
        }

        // Step 3: Pop stash
        const s3 = git('stash pop', cwd);
        if (!s3.ok) {
          // Extract conflicted files from output
          const conflictFiles = s3.out.split('\n')
            .filter(l => l.includes('CONFLICT'))
            .map(l => {
              const m = l.match(/CONFLICT.*?:\s*(?:Merge conflict in\s+)?(.+)/i);
              return m ? m[1].trim() : null;
            })
            .filter(Boolean);

          if (s3.out.includes('CONFLICT') || s3.out.includes('conflict')) {
            return {
              success: false,
              output: `Pull succeeded, but reapplying your stashed changes caused conflicts.${conflictFiles.length > 0 ? '\n\nConflicted files:\n• ' + conflictFiles.join('\n• ') : ''}`,
              partialSuccess: true,
              partialMessage: 'Remote changes were pulled successfully. Your stashed changes conflict with the pulled changes. Resolve the conflicts in the affected files, then stage and commit.',
            };
          }
          return fail(`Pull succeeded but restoring your changes failed: ${friendlyError(s3.out)}`, 'Remote changes were pulled. Your stash is preserved — run "git stash pop" manually.');
        }
        return { success: true, output: 'Stash → Pull → Restore complete. Your changes have been reapplied.' };
      }

      case 'push': {
        const r = git('push', cwd);
        if (!r.ok) {
          const cat = classifyGitError(r.out);
          if (cat === 'non_fast_forward') return fail('Push rejected: the remote has newer commits. Pull first, then push.');
          if (cat === 'auth_failed') return fail('Authentication failed. Check your credentials or SSH keys.');
          if (cat === 'ref_not_found') return fail('The remote branch no longer exists.');
          return fail(`Push failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: r.out || 'Push complete.' };
      }

      case 'publish-branch': {
        const branch = opts?.branch || git('rev-parse --abbrev-ref HEAD', cwd).out;
        const r = git(`push -u origin ${branch}`, cwd);
        if (!r.ok) {
          const cat = classifyGitError(r.out);
          if (cat === 'auth_failed') return fail('Authentication failed. Cannot publish branch.');
          return fail(`Publish failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: `Branch "${branch}" published to origin.` };
      }

      case 'commit': {
        if (!opts?.message) return fail('Commit message is required.');
        // Do NOT auto-stage — user must explicitly choose what to commit
        const r = git(`commit -m "${opts.message.replace(/"/g, '\\"')}"`, cwd);
        if (!r.ok) return fail(`Commit failed: ${friendlyError(r.out)}`);
        return { success: true, output: r.out || 'Commit complete.' };
      }

      case 'checkout': {
        if (!opts?.branch) return fail('Branch name required.');
        // Use git switch for normal branch switching
        let r = git(`switch ${opts.branch}`, cwd);
        if (!r.ok) {
          // Fallback: maybe it's a remote branch that needs local tracking
          if (r.out.includes('did not match') || r.out.includes('invalid reference')) {
            r = git(`switch -c ${opts.branch} origin/${opts.branch}`, cwd);
          }
          // Detect untracked file overwrite
          if (!r.ok && (r.out.includes('would be overwritten') || r.out.includes('untracked working tree files'))) {
            return fail(`Cannot switch: local files would be overwritten by the checkout. Review or remove the conflicting files first.`);
          }
          if (!r.ok) return fail(`Switch failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: `Switched to ${opts.branch}.` };
      }

      case 'create-branch': {
        if (!opts?.branch) return fail('Branch name required.');
        const r = git(`switch -c ${opts.branch}`, cwd);
        if (!r.ok) return fail(`Create branch failed: ${friendlyError(r.out)}`);
        return { success: true, output: `Created and switched to ${opts.branch}.` };
      }

      case 'delete-branch': {
        if (!opts?.branch) return fail('Branch name required.');
        const r = git(`branch -d ${opts.branch}`, cwd);
        if (!r.ok) {
          if (r.out.includes('not fully merged')) {
            return fail(`Branch "${opts.branch}" has unmerged changes. Use force delete if you're sure.`);
          }
          return fail(`Delete failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: `Deleted branch ${opts.branch}.` };
      }

      case 'stash': {
        const name = opts?.stashName || `OG stash - ${new Date().toISOString().slice(0, 19)}`;
        const r = git(`stash push -m "${name.replace(/"/g, '\\"')}"`, cwd);
        if (!r.ok) return fail(`Stash failed: ${friendlyError(r.out)}`);
        return { success: true, output: 'Changes stashed.' };
      }

      case 'stash-untracked': {
        const name = opts?.stashName || `OG stash (incl. untracked) - ${new Date().toISOString().slice(0, 19)}`;
        const r = git(`stash push --include-untracked -m "${name.replace(/"/g, '\\"')}"`, cwd);
        if (!r.ok) return fail(`Stash failed: ${friendlyError(r.out)}`);
        return { success: true, output: 'All changes (including untracked files) stashed.' };
      }

      case 'stash-pop': {
        const r = git('stash pop', cwd);
        if (!r.ok) {
          if (r.out.includes('CONFLICT') || r.out.includes('conflict')) {
            return { success: false, output: 'Stash pop created conflicts. Resolve them and commit.', partialSuccess: true, partialMessage: 'Stash was applied but has conflicts.' };
          }
          if (r.out.includes('No stash entries')) return fail('No stash entries found.');
          return fail(`Stash pop failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: 'Stash restored.' };
      }

      case 'fetch': {
        const r = git('fetch origin', cwd);
        if (!r.ok) {
          const cat = classifyGitError(r.out);
          if (cat === 'auth_failed') return fail('Authentication failed during fetch.');
          if (cat === 'ref_not_found') return fail('Remote not found. The remote may have been renamed or deleted.');
          return fail(`Fetch failed: ${friendlyError(r.out)}`);
        }
        return { success: true, output: r.out || 'Fetch complete.' };
      }

      case 'continue-rebase': {
        const r = git('rebase --continue', cwd);
        if (!r.ok) return fail(`Continue rebase failed: ${friendlyError(r.out)}`);
        return { success: true, output: 'Rebase continued.' };
      }

      case 'abort-rebase': {
        const r = git('rebase --abort', cwd);
        if (!r.ok) return fail(`Abort rebase failed: ${friendlyError(r.out)}`);
        return { success: true, output: 'Rebase aborted. Branch restored.' };
      }

      case 'continue-merge': {
        const r = git('commit --no-edit', cwd);
        if (!r.ok) return fail(`Continue merge failed: ${friendlyError(r.out)}`);
        return { success: true, output: 'Merge completed.' };
      }

      case 'abort-merge': {
        const r = git('merge --abort', cwd);
        if (!r.ok) return fail(`Abort merge failed: ${friendlyError(r.out)}`);
        return { success: true, output: 'Merge aborted. Branch restored.' };
      }

      case 'remove-lock': {
        const lockPath = git('rev-parse --git-path index.lock', cwd);
        if (lockPath.ok) {
          try {
            const path = require('path');
            const fs = require('fs');
            fs.unlinkSync(path.resolve(cwd, lockPath.out));
            return { success: true, output: 'Lock file removed.' };
          } catch (e) {
            return fail(`Failed to remove lock file: ${e}`);
          }
        }
        return fail('Could not locate lock file.');
      }

      case 'sync': {
        // Sync = fetch + pull (merge) + push
        const f = git('fetch origin', cwd);
        if (!f.ok) return fail(`Fetch failed: ${friendlyError(f.out)}`);
        const state = inspectRepoState(cwd);
        if (state.behind > 0) {
          const p = git('pull --no-rebase', cwd);
          if (!p.ok) return fail(`Pull failed during sync: ${friendlyError(p.out)}`, 'Fetch completed.');
        }
        if (state.ahead > 0 || state.behind > 0) {
          const ps = git('push', cwd);
          if (!ps.ok) return fail(`Push failed during sync: ${friendlyError(ps.out)}`, 'Pull completed.');
        }
        return { success: true, output: 'Sync complete (fetch + pull + push).' };
      }

      default:
        return fail(`Unknown action: ${action}`);
    }
  } catch (e) {
    return fail(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Convert raw git error to friendlier text */
function friendlyError(raw: string): string {
  // Truncate very long errors
  const s = raw.length > 500 ? raw.slice(0, 500) + '...' : raw;
  // Strip common git noise
  return s
    .replace(/^error: /gm, '')
    .replace(/^fatal: /gm, '')
    .replace(/^hint: .*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export { inspectRepoState, classifyGitError } from './gitInspect';
