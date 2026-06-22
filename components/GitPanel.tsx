'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, GitCommit, ArrowUpFromLine, ArrowDownToLine,
  RefreshCw, AlertCircle, Loader2, Link as LinkIcon, Unlink, Sparkles,
  AlertTriangle, GitMerge, RotateCcw, Archive, ChevronDown, MoreHorizontal
} from 'lucide-react';
import GitActionDialog from './GitActionDialog';
import type { ActionEvaluation, RecoveryAction } from '@/lib/types';

interface GitPanelProps {
  projectFolder: string;
  onToast: (message: string, type: 'success' | 'error') => void;
}

interface GitStatus {
  branch: string;
  remote: string | null;
  added: number;
  modified: number;
  deleted: number;
  untracked: number;
  ahead: number;
  behind: number;
  diverged?: boolean;
  isDetachedHead?: boolean;
  isClean?: boolean;
  mergeInProgress?: boolean;
  rebaseInProgress?: boolean;
  cherryPickInProgress?: boolean;
  hasLockFile?: boolean;
  hasUpstream?: boolean;
  conflictedFiles?: string[];
  stashCount?: number;
}

export default function GitPanel({ projectFolder, onToast }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [dialog, setDialog] = useState<{ title: string; evaluation: ActionEvaluation; pendingAction: string } | null>(null);
  const [showPullMenu, setShowPullMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showMoreMenu && moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  // Fetch git status
  const fetchStatus = useCallback(async () => {
    if (!projectFolder) return;
    try {
      const res = await fetch(`/api/git?cwd=${encodeURIComponent(projectFolder)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setStatus(null);
      } else {
        setStatus(data);
        setError(null);
      }
    } catch {
      setError('Failed to fetch git status');
    }
  }, [projectFolder]);

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 10000);
    return () => clearInterval(iv);
  }, [fetchStatus]);

  // Background fetch on first load (throttled)
  useEffect(() => {
    if (!projectFolder || !status?.remote) return;
    const timer = setTimeout(async () => {
      try {
        await fetch('/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: projectFolder, action: 'fetch' }),
        });
        fetchStatus();
      } catch { /* silent */ }
    }, 2000);
    return () => clearTimeout(timer);
  }, [projectFolder, status?.remote, fetchStatus]); // Only on project open or remote change

  // Build a "blocked by dirty tree" evaluation for would_overwrite failures
  const buildDirtyTreeEvaluation = (): ActionEvaluation => {
    const trackedCount = (status?.modified || 0) + (status?.added || 0) + (status?.deleted || 0);
    const untrackedCount = status?.untracked || 0;
    const hasUntracked = untrackedCount > 0;

    const blockerMsg = trackedCount > 0 && hasUntracked
      ? `You have ${trackedCount} modified file(s) and ${untrackedCount} untracked file(s). These must be committed or stashed before pulling.`
      : trackedCount > 0
        ? `You have ${trackedCount} uncommitted change(s) that would be overwritten by the pull.`
        : `You have ${untrackedCount} untracked file(s) that may conflict with incoming changes.`;

    const recoveryActions: RecoveryAction[] = [
      { id: 'stash-and-pull', label: '📦 Stash changes and pull', description: 'Temporarily saves your tracked changes, pulls remote updates, then reapplies them.', risk: 'safe', confirmRequired: false },
    ];
    if (hasUntracked) {
      recoveryActions.push(
        { id: 'stash-untracked-and-pull', label: '📦 Stash all (incl. untracked) and pull', description: 'Stashes both tracked and untracked files, pulls, then reapplies your changes.', risk: 'safe', confirmRequired: false }
      );
    }
    recoveryActions.push(
      { id: 'commit-first', label: '💾 Commit changes first', description: 'Stage and commit your current changes before proceeding.', risk: 'safe', confirmRequired: false },
      { id: 'review-changes', label: '👀 Review changes', description: 'Open the diff viewer to review your current changes.', risk: 'safe', confirmRequired: false },
      { id: 'cancel', label: 'Cancel', description: 'Do nothing.', risk: 'safe', confirmRequired: false },
    );

    return {
      canProceed: false,
      summary: `Pull is blocked: your local changes would be overwritten.`,
      warnings: [],
      blockers: [blockerMsg],
      recoveryActions,
      technicalDetails: undefined,
    };
  };

  // Smart git operation — routes through engine
  const gitOp = async (action: string, extra?: Record<string, string>) => {
    setLoading(action);
    setShowPullMenu(false);
    setShowMoreMenu(false);
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: projectFolder, action, ...extra }),
      });
      const data = await res.json();

      // Engine returned a blocked evaluation
      if (data.blocked && data.evaluation) {
        setDialog({
          title: getActionTitle(action),
          evaluation: data.evaluation,
          pendingAction: action,
        });
        setLoading(null);
        return;
      }

      if (data.error || !data.success) {
        // Detect would_overwrite failure from executor and show dialog instead of raw error
        if (data.output && (
          data.output.includes('would be overwritten') ||
          data.output.includes('Stash or commit them first') ||
          data.output.includes('uncommitted changes') ||
          (data.partialMessage && data.partialMessage.includes('would be overwritten'))
        )) {
          setDialog({
            title: '⚠ Pull blocked by local changes',
            evaluation: buildDirtyTreeEvaluation(),
            pendingAction: action,
          });
          setLoading(null);
          return;
        }

        // Partial success (e.g., stash-and-pull with conflict on pop)
        if (data.partialSuccess) {
          onToast(data.output || data.partialMessage || `${action} partially completed`, 'error');
        } else {
          onToast(data.output || data.error || `${action} failed`, 'error');
        }
      } else {
        onToast(data.output || `Git ${action} successful`, 'success');
      }
      await fetchStatus();
    } catch {
      onToast(`Git ${action} failed`, 'error');
    }
    setLoading(null);
  };

  const getActionTitle = (action: string): string => {
    const titles: Record<string, string> = {
      'pull': '⚠ Pull blocked', 'pull-merge': '⚠ Pull blocked', 'pull-rebase': '⚠ Pull blocked',
      'push': '⚠ Push blocked', 'checkout': '⚠ Branch switch blocked',
      'sync': '⚠ Sync blocked', 'commit': '⚠ Commit blocked',
    };
    return titles[action] || `⚠ ${action} blocked`;
  };

  // Dialog recovery action handler
  const handleDialogAction = async (actionId: string) => {
    if (actionId === 'cancel') {
      setDialog(null);
      return;
    }
    if (actionId === 'review-changes') {
      setDialog(null);
      onToast('Open the diff viewer to review changes.', 'success');
      return;
    }
    if (actionId === 'commit-first') {
      setDialog(null);
      onToast('Commit your changes first, then try again.', 'success');
      return;
    }
    setLoading(actionId);
    setDialog(null);
    // Execute the recovery action
    await gitOp(actionId);
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      onToast('Please enter a commit message', 'error');
      return;
    }
    // Stage all then commit
    await fetch('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: projectFolder, action: 'add' }),
    });
    await gitOp('commit', { message: commitMessage.trim() });
    setCommitMessage('');
  };

  const handlePush = async () => {
    if (!status?.remote) {
      setShowRemoteInput(true);
      onToast('No remote configured. Set a remote URL first.', 'error');
      return;
    }
    if (!status?.hasUpstream) {
      await gitOp('publish-branch');
      return;
    }
    await gitOp('push');
  };

  const handlePull = async (strategy?: string) => {
    if (!status?.remote) {
      setShowRemoteInput(true);
      onToast('No remote configured. Set a remote URL first.', 'error');
      return;
    }
    await gitOp(strategy || 'pull-merge');
  };

  const handleSetRemote = async () => {
    const url = remoteUrl.trim();
    if (!url) { onToast('Please enter a remote URL', 'error'); return; }
    setLoading('set-remote');
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: projectFolder, operation: 'set-remote', url }),
      });
      const data = await res.json();
      if (data.success) {
        onToast(`Remote set to ${url}`, 'success');
        setShowRemoteInput(false);
        setRemoteUrl('');
        await fetchStatus();
      } else {
        onToast(`Failed: ${data.output || data.error}`, 'error');
      }
    } catch { onToast('Failed to set remote', 'error'); }
    setLoading(null);
  };

  const handleAutofillCommitMsg = async () => {
    if (totalChanges === 0) { onToast('No changes to describe', 'error'); return; }
    setLoading('autofill');
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: projectFolder, action: 'generate-commit-msg' }),
      });
      const data = await res.json();
      if (data.success && data.output) {
        const firstLine = data.output.split('\n')[0]?.trim() || data.output.trim();
        setCommitMessage(firstLine);
        onToast('Commit message generated — review before committing', 'success');
      } else {
        onToast(data.output || 'Failed to generate commit message', 'error');
      }
    } catch { onToast('Failed to generate commit message', 'error'); }
    setLoading(null);
  };

  const totalChanges = status ? status.added + status.modified + status.deleted + (status.untracked || 0) : 0;
  const hasOperationInProgress = status?.mergeInProgress || status?.rebaseInProgress || status?.cherryPickInProgress;

  return (
    <div className="git-panel">
      {/* Branch info */}
      <div className="git-panel__header">
        <div className="git-panel__branch">
          <GitBranch size={13} />
          <span title={status?.branch || ''}>
            {status?.isDetachedHead ? '⚠ DETACHED HEAD' : (status?.branch || '—')}
          </span>
          {status && status.ahead > 0 && (
            <span className="git-panel__badge git-panel__badge--ahead">↑{status.ahead}</span>
          )}
          {status && status.behind > 0 && (
            <span className="git-panel__badge git-panel__badge--behind">↓{status.behind}</span>
          )}
          {status?.diverged && (
            <span className="git-panel__badge git-panel__badge--diverged">diverged</span>
          )}
        </div>
        <button className="icon-btn" onClick={fetchStatus} title="Refresh" disabled={!!loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Remote status */}
      <div className="git-panel__remote" style={{ color: status?.remote ? 'var(--color-success)' : 'var(--text-disabled)' }}>
        {status?.remote ? <LinkIcon size={9} /> : <Unlink size={9} />}
        <span className="git-panel__remote-url" title={status?.remote || 'No remote configured'}>
          {status?.remote ? status.remote.replace('https://github.com/', '') : 'No remote'}
        </span>
        <button
          className="icon-btn"
          onClick={() => setShowRemoteInput(!showRemoteInput)}
          title={status?.remote ? 'Change remote' : 'Set remote'}
          style={{ marginLeft: 'auto', fontSize: '9px', padding: '1px 4px', flexShrink: 0 }}
        >
          {status?.remote ? '✏️' : '🔗'}
        </button>
      </div>

      {/* Remote URL input */}
      {showRemoteInput && (
        <div style={{ display: 'flex', gap: '4px', padding: '4px 0' }}>
          <input
            className="git-panel__input" type="text"
            placeholder="https://github.com/user/repo.git"
            value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSetRemote()}
            disabled={loading === 'set-remote'} style={{ flex: 1 }}
          />
          <button className="btn btn--primary btn--sm" onClick={handleSetRemote}
            disabled={!remoteUrl.trim() || loading === 'set-remote'}
            style={{ padding: '2px 6px', fontSize: '10px' }}>
            {loading === 'set-remote' ? <Loader2 size={10} className="spin" /> : 'Set'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ fontSize: '10px', color: 'var(--color-error)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <AlertCircle size={10} /> {error}
        </div>
      )}

      {/* Operation in progress banner */}
      {status?.mergeInProgress && (
        <div className="git-panel__operation-banner git-panel__operation-banner--merge">
          <GitMerge size={12} />
          <span>Merge in progress</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <button className="btn btn--sm btn--primary" onClick={() => gitOp('continue-merge')}
              disabled={!!loading} style={{ padding: '2px 6px', fontSize: '9px' }}>Continue</button>
            <button className="btn btn--sm btn--ghost" onClick={() => gitOp('abort-merge')}
              disabled={!!loading} style={{ padding: '2px 6px', fontSize: '9px' }}>Abort</button>
          </div>
        </div>
      )}
      {status?.rebaseInProgress && (
        <div className="git-panel__operation-banner git-panel__operation-banner--rebase">
          <RotateCcw size={12} />
          <span>Rebase in progress</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <button className="btn btn--sm btn--primary" onClick={() => gitOp('continue-rebase')}
              disabled={!!loading} style={{ padding: '2px 6px', fontSize: '9px' }}>Continue</button>
            <button className="btn btn--sm btn--ghost" onClick={() => gitOp('abort-rebase')}
              disabled={!!loading} style={{ padding: '2px 6px', fontSize: '9px' }}>Abort</button>
          </div>
        </div>
      )}
      {status?.hasLockFile && (
        <div className="git-panel__operation-banner git-panel__operation-banner--lock">
          <AlertTriangle size={12} />
          <span>Git is locked</span>
          <button className="btn btn--sm btn--ghost" onClick={() => gitOp('remove-lock')}
            disabled={!!loading} style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: '9px' }}>Remove lock</button>
        </div>
      )}

      {/* Conflict files */}
      {status?.conflictedFiles && status.conflictedFiles.length > 0 && (
        <div className="git-panel__operation-banner git-panel__operation-banner--conflict">
          <AlertTriangle size={12} />
          <span>{status.conflictedFiles.length} file(s) with conflicts</span>
        </div>
      )}

      {/* Changes summary */}
      {status && totalChanges > 0 && (
        <div className="git-panel__changes">
          {status.added > 0 && <span className="git-panel__stat git-panel__stat--added">+{status.added}</span>}
          {status.modified > 0 && <span className="git-panel__stat git-panel__stat--modified">~{status.modified}</span>}
          {status.deleted > 0 && <span className="git-panel__stat git-panel__stat--deleted">-{status.deleted}</span>}
          {(status.untracked || 0) > 0 && <span className="git-panel__stat git-panel__stat--untracked">?{status.untracked}</span>}
          <span style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>{totalChanges} change{totalChanges !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Stash count */}
      {status?.stashCount && status.stashCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-tertiary)' }}>
          <Archive size={10} />
          <span>{status.stashCount} stash{status.stashCount !== 1 ? 'es' : ''}</span>
          <button className="btn btn--sm btn--ghost" onClick={() => gitOp('stash-pop')}
            disabled={!!loading} style={{ marginLeft: 'auto', padding: '1px 4px', fontSize: '9px' }}>Pop</button>
        </div>
      )}

      {/* Commit */}
      <div className="git-panel__commit">
        <div className="git-panel__commit-row">
          <input
            className="git-panel__input" type="text"
            placeholder="Commit message..."
            value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
            disabled={!!loading}
          />
          <button className="icon-btn" onClick={handleAutofillCommitMsg}
            disabled={!!loading || totalChanges === 0}
            title="AI: Generate commit message" style={{ color: !!loading || totalChanges === 0 ? undefined : '#0092D1', flexShrink: 0 }}>
            {loading === 'autofill' ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          </button>
        </div>
        <button className="btn btn--primary btn--sm" onClick={handleCommit}
          disabled={!commitMessage.trim() || !!loading || totalChanges === 0}
          title="Stage all & commit" style={{ width: '100%' }}>
          {loading === 'commit' ? <Loader2 size={12} className="spin" /> : <GitCommit size={12} />}
          Commit
        </button>
      </div>

      {/* Pull / Push / More */}
      <div className="git-panel__actions">
        {/* Pull with dropdown */}
        <div style={{ position: 'relative', flex: 1 }}>
          <div style={{ display: 'flex', gap: '0' }}>
            <button className="btn btn--ghost btn--sm" onClick={() => handlePull('pull-merge')}
              disabled={!!loading || !status?.remote} style={{ flex: 1, borderRadius: '6px 0 0 6px' }}
              title={status?.remote ? `Pull from ${status.remote}` : 'Set remote first'}>
              {loading === 'pull-merge' || loading === 'pull' ? <Loader2 size={12} className="spin" /> : <ArrowDownToLine size={12} />}
              Pull
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowPullMenu(!showPullMenu)}
              disabled={!!loading || !status?.remote} style={{ padding: '4px', borderRadius: '0 6px 6px 0', borderLeft: '1px solid var(--border-subtle)' }}>
              <ChevronDown size={10} />
            </button>
          </div>
          {showPullMenu && (
            <div className="git-panel__pull-menu">
              <button onClick={() => { handlePull('pull-merge'); setShowPullMenu(false); }}>
                🔀 Pull (merge)
                <span>Creates a merge commit</span>
              </button>
              <button onClick={() => { handlePull('pull-rebase'); setShowPullMenu(false); }}>
                🔄 Pull (rebase)
                <span>Replays your commits on top</span>
              </button>
              <button onClick={() => { gitOp('fetch'); setShowPullMenu(false); }}>
                📥 Fetch only
                <span>Download without applying</span>
              </button>
            </div>
          )}
        </div>

        {/* Push */}
        <button className="btn btn--ghost btn--sm" onClick={handlePush}
          disabled={!!loading || !status?.remote} style={{ flex: 1 }}
          title={status?.remote ? `Push to ${status.remote}` : 'Set remote first'}>
          {loading === 'push' || loading === 'publish-branch' ? <Loader2 size={12} className="spin" /> : <ArrowUpFromLine size={12} />}
          {!status?.hasUpstream && status?.remote ? 'Publish' : 'Push'}
        </button>

        {/* More menu */}
        <div style={{ position: 'relative' }} ref={moreMenuRef}>
          <button className="btn btn--ghost btn--sm" onClick={() => setShowMoreMenu(!showMoreMenu)}
            disabled={!!loading} title="More actions"
            style={{ padding: '4px 6px' }}>
            <MoreHorizontal size={13} />
          </button>
          {showMoreMenu && (
            <div className="git-panel__more-menu">
              <button onClick={() => gitOp('stash')} disabled={!!loading || totalChanges === 0}>
                📦 Stash changes
                <span>Save tracked changes for later</span>
              </button>
              <button onClick={() => gitOp('stash-untracked')} disabled={!!loading || totalChanges === 0}>
                📦 Stash all (incl. untracked)
                <span>Save all changes including new files</span>
              </button>
              {(status?.stashCount || 0) > 0 && (
                <button onClick={() => gitOp('stash-pop')}>
                  📤 Pop stash
                  <span>Restore most recent stash</span>
                </button>
              )}
              <button onClick={() => gitOp('fetch')}>
                📥 Fetch
                <span>Download remote changes</span>
              </button>
              <button onClick={() => gitOp('sync')}>
                🔄 Sync (fetch + pull + push)
                <span>Full remote synchronization</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* State message */}
      {status && !hasOperationInProgress && (
        <div className="git-panel__state-message">
          {status.diverged
            ? `⚠ Branch and ${status.remote ? 'remote' : 'upstream'} have diverged (↑${status.ahead} ↓${status.behind})`
            : status.behind > 0
              ? `↓ ${status.behind} commit(s) behind remote`
              : status.ahead > 0
                ? `↑ ${status.ahead} commit(s) ahead of remote`
                : status.isClean
                  ? '✓ Up to date'
                  : `${totalChanges} uncommitted change(s)`
          }
        </div>
      )}

      {/* Action dialog */}
      {dialog && (
        <GitActionDialog
          title={dialog.title}
          evaluation={dialog.evaluation}
          onAction={handleDialogAction}
          onClose={() => setDialog(null)}
          loading={loading}
        />
      )}
    </div>
  );
}
