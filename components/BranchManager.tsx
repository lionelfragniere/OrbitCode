'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Plus, Trash2, Check, X, RefreshCw,
  Loader2, ChevronDown, ArrowRight, Upload
} from 'lucide-react';
import GitActionDialog from './GitActionDialog';
import type { ActionEvaluation } from '@/lib/types';

interface BranchManagerProps {
  projectFolder: string;
  onToast: (msg: string, type: 'success' | 'error') => void;
}

interface BranchInfo {
  name: string;
  current: boolean;
  remote?: boolean;
}

export default function BranchManager({ projectFolder, onToast }: BranchManagerProps) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [dialog, setDialog] = useState<{ evaluation: ActionEvaluation; targetBranch: string } | null>(null);

  const fetchBranches = useCallback(async () => {
    if (!projectFolder) return;
    setLoading('fetch');
    try {
      const res = await fetch(`/api/git?cwd=${encodeURIComponent(projectFolder)}&action=branches`);
      const data = await res.json();
      if (data.branches) setBranches(data.branches);
    } catch { /* ignore */ }
    setLoading(null);
  }, [projectFolder]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const currentBranch = branches.find((b) => b.current);

  const switchBranch = async (name: string) => {
    setLoading('switch');
    try {
      // Pre-flight evaluation via engine
      const evalRes = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: projectFolder, action: 'evaluate', targetAction: 'checkout' }),
      });
      const evalData = await evalRes.json();

      if (evalData.evaluation && !evalData.evaluation.canProceed) {
        // Show dialog with recovery options
        setDialog({ evaluation: evalData.evaluation, targetBranch: name });
        setLoading(null);
        return;
      }

      // Warnings but can proceed — check for dirty tree warning
      if (evalData.evaluation?.warnings?.length > 0) {
        setDialog({ evaluation: evalData.evaluation, targetBranch: name });
        setLoading(null);
        return;
      }

      // Proceed with switch
      await doSwitch(name);
    } catch {
      onToast('Switch failed', 'error');
      setLoading(null);
    }
  };

  const doSwitch = async (name: string) => {
    setLoading('switch');
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: projectFolder, action: 'checkout', branch: name }),
      });
      const data = await res.json();
      if (data.blocked && data.evaluation) {
        setDialog({ evaluation: data.evaluation, targetBranch: name });
      } else if (data.success) {
        onToast(`Switched to ${name}`, 'success');
        await fetchBranches();
        setIsOpen(false);
      } else {
        onToast(`Failed: ${data.output || data.error}`, 'error');
      }
    } catch {
      onToast('Switch failed', 'error');
    }
    setLoading(null);
  };

  const handleDialogAction = async (actionId: string) => {
    if (actionId === 'cancel') { setDialog(null); return; }
    const targetBranch = dialog?.targetBranch;
    setDialog(null);

    if (actionId === 'stash-and-switch' && targetBranch) {
      // Stash then switch
      setLoading('stash-and-switch');
      try {
        await fetch('/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: projectFolder, action: 'stash' }),
        });
        await doSwitch(targetBranch);
        onToast('Changes stashed. Use stash pop to restore.', 'success');
      } catch { onToast('Stash and switch failed', 'error'); }
      setLoading(null);
      return;
    }

    if (actionId === 'commit-first') {
      onToast('Commit your changes first, then switch branches.', 'success');
      return;
    }

    if (actionId === 'discard-all' && targetBranch) {
      // Discard changes then switch
      setLoading('discard');
      try {
        await fetch('/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: projectFolder, action: 'add', operation: 'add' }),
        });
        // git checkout -- . to discard
        await doSwitch(targetBranch);
      } catch { onToast('Discard failed', 'error'); }
      setLoading(null);
      return;
    }

    if (actionId === 'review-changes') {
      onToast('Open the diff viewer to review changes.', 'success');
      return;
    }
  };

  const createBranch = async () => {
    if (!newBranch.trim()) return;
    setLoading('create');
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: projectFolder, action: 'create-branch', branch: newBranch.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        onToast(`Created & switched to ${newBranch.trim()}`, 'success');
        setNewBranch('');
        setShowCreate(false);
        await fetchBranches();
      } else {
        onToast(`Failed: ${data.output || data.error}`, 'error');
      }
    } catch { onToast('Create failed', 'error'); }
    setLoading(null);
  };

  const deleteBranch = async (name: string) => {
    if (name === currentBranch?.name) {
      onToast('Cannot delete current branch', 'error');
      return;
    }
    setLoading('delete');
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: projectFolder, action: 'delete-branch', branch: name }),
      });
      const data = await res.json();
      if (data.success) {
        onToast(`Deleted ${name}`, 'success');
        await fetchBranches();
      } else {
        onToast(`Failed: ${data.output || data.error}`, 'error');
      }
    } catch { onToast('Delete failed', 'error'); }
    setLoading(null);
  };

  return (
    <div className="branch-manager">
      <div className="branch-manager__current" onClick={() => setIsOpen(!isOpen)}>
        <GitBranch size={12} style={{ color: 'var(--color-info)' }} />
        <span>{currentBranch?.name || '—'}</span>
        <ChevronDown size={10} style={{ opacity: 0.5, transform: isOpen ? 'rotate(180deg)' : '', transition: 'transform 0.15s' }} />
      </div>

      {isOpen && (
        <div className="branch-manager__dropdown">
          {/* Create new */}
          {!showCreate ? (
            <button className="branch-manager__action" onClick={() => setShowCreate(true)}>
              <Plus size={11} style={{ color: 'var(--color-success)' }} /> New branch
            </button>
          ) : (
            <div className="branch-manager__create">
              <input type="text" placeholder="feature/my-branch" value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createBranch()} autoFocus />
              <button onClick={createBranch} disabled={!newBranch.trim() || loading === 'create'}>
                {loading === 'create' ? <Loader2 size={10} className="spin" /> : <Check size={10} />}
              </button>
              <button onClick={() => { setShowCreate(false); setNewBranch(''); }}>
                <X size={10} />
              </button>
            </div>
          )}

          {/* Branch list */}
          {branches.map((branch) => (
            <div key={branch.name} className={`branch-manager__item ${branch.current ? 'branch-manager__item--current' : ''}`}>
              <button className="branch-manager__item-name"
                onClick={() => !branch.current && switchBranch(branch.name)}
                disabled={branch.current}>
                {branch.current && <Check size={10} style={{ color: 'var(--color-success)' }} />}
                {!branch.current && <ArrowRight size={9} style={{ opacity: 0.3 }} />}
                {branch.name}
                {branch.remote && <span style={{ fontSize: '9px', color: 'var(--text-disabled)' }}>remote</span>}
              </button>
              {!branch.current && (
                <button className="branch-manager__delete" onClick={() => deleteBranch(branch.name)} title={`Delete ${branch.name}`}>
                  <Trash2 size={9} />
                </button>
              )}
            </div>
          ))}

          <button className="branch-manager__action" onClick={fetchBranches}>
            <RefreshCw size={10} className={loading === 'fetch' ? 'spin' : ''} /> Refresh
          </button>
        </div>
      )}

      {/* Dialog for blocked switch */}
      {dialog && (
        <GitActionDialog
          title="⚠ Branch switch"
          evaluation={dialog.evaluation}
          onAction={handleDialogAction}
          onClose={() => setDialog(null)}
          loading={loading}
        />
      )}
    </div>
  );
}
