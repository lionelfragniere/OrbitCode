'use client';

import React, { useState, useEffect } from 'react';
import { Circle, GitBranch, Terminal, Shield, Brain, BarChart3 } from 'lucide-react';
import { OpenFile } from '@/lib/types';
import ModelSelector from './ModelSelector';
import BranchManager from './BranchManager';
import { UsageSummary } from '@/lib/models';

interface StatusBarProps {
  gcpProject: string;
  providerId?: string;
  activeFile: OpenFile | null;
  isStreaming: boolean;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  projectFolder: string;
  onToast: (msg: string, type: 'success' | 'error') => void;
  usageSummary?: UsageSummary | null;
  brainEntryCount?: number;
}

interface GitInfo {
  isRepo: boolean;
  branch?: string;
  remote?: string;
  modified?: number;
  added?: number;
  deleted?: number;
  totalChanges?: number;
  diverged?: boolean;
  mergeInProgress?: boolean;
  rebaseInProgress?: boolean;
  hasLockFile?: boolean;
  conflictedFiles?: string[];
  isDetachedHead?: boolean;
  hasUpstream?: boolean;
}

export default function StatusBar({
  gcpProject, providerId, activeFile, isStreaming, terminalOpen, onToggleTerminal,
  selectedModel, onModelChange, projectFolder, onToast,
  usageSummary, brainEntryCount,
}: StatusBarProps) {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  // Poll git status every 10 seconds
  useEffect(() => {
    const fetchGit = async () => {
      if (!projectFolder) return;
      try {
        const res = await fetch(`/api/git?cwd=${encodeURIComponent(projectFolder)}`);
        const data = await res.json();
        setGitInfo(data);
      } catch { /* ignore */ }
    };

    fetchGit();
    const interval = setInterval(fetchGit, 10000);
    return () => clearInterval(interval);
  }, [projectFolder]);

  return (
    <footer className="status-bar">
      {/* Status */}
      <span className="status-bar__item">
        <span
          className="status-bar__dot"
          style={isStreaming ? { background: 'var(--accent-primary)', animation: 'pulse 0.6s ease-in-out infinite' } : {}}
        />
        {isStreaming ? 'Streaming...' : 'Ready'}
      </span>

      {/* Branch manager */}
      {projectFolder && (
        <BranchManager projectFolder={projectFolder} onToast={onToast} />
      )}

      {/* Git changes */}
      {/* Operation in progress indicator */}
      {gitInfo?.mergeInProgress && (
        <span className="status-bar__item" style={{ fontSize: '10px', color: 'var(--color-warning)' }} title="Merge in progress">
          🔀 MERGE
        </span>
      )}
      {gitInfo?.rebaseInProgress && (
        <span className="status-bar__item" style={{ fontSize: '10px', color: 'var(--color-warning)' }} title="Rebase in progress">
          🔄 REBASE
        </span>
      )}
      {gitInfo?.conflictedFiles && gitInfo.conflictedFiles.length > 0 && (
        <span className="status-bar__item" style={{ fontSize: '10px', color: 'var(--color-error)' }} title="Unresolved conflicts">
          ⚠ {gitInfo.conflictedFiles.length} conflict{gitInfo.conflictedFiles.length > 1 ? 's' : ''}
        </span>
      )}

      {gitInfo?.isRepo && (gitInfo.totalChanges ?? 0) > 0 && (
        <span className="status-bar__item" style={{ fontSize: '10px' }}>
          <span style={{ color: 'var(--color-warning)' }}>
            +{gitInfo.added || 0} ~{gitInfo.modified || 0} -{gitInfo.deleted || 0}
          </span>
        </span>
      )}

      {/* Active file info */}
      {activeFile && (
        <>
          <span className="status-bar__item">{activeFile.language}</span>
          <span className="status-bar__item" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
            {activeFile.path}
          </span>
        </>
      )}

      {/* Terminal toggle */}
      {onToggleTerminal && (
        <button
          className="status-bar__item"
          onClick={onToggleTerminal}
          style={{
            cursor: 'pointer', background: 'none', border: 'none',
            color: terminalOpen ? 'var(--accent-secondary)' : 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '11px', padding: 0,
          }}
          title="Toggle Terminal (Ctrl+`)"
        >
          <Terminal size={11} />
          Terminal
        </button>
      )}

      <span className="status-bar__spacer" />

      {/* Brain indicator */}
      {(brainEntryCount ?? 0) > 0 && (
        <span className="status-bar__item" style={{ color: 'var(--accent-secondary)', fontSize: '10px' }} title="Project Brain entries">
          <Brain size={10} />
          {brainEntryCount}
        </span>
      )}

      {/* Session usage */}
      {usageSummary && usageSummary.totalRequests > 0 && (
        <span className="status-bar__item" style={{ fontSize: '9px', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }} title={`${usageSummary.totalRequests} requests · ${usageSummary.totalTokens.toLocaleString()} tokens`}>
          <BarChart3 size={9} />
          {usageSummary.totalTokens > 1000 ? `${(usageSummary.totalTokens / 1000).toFixed(1)}k` : usageSummary.totalTokens} tok
          {usageSummary.totalCostUsd > 0 && ` · $${usageSummary.totalCostUsd.toFixed(4)}`}
        </span>
      )}

      {/* Data privacy indicator */}
      <span className="status-bar__item" style={{ color: 'var(--color-success)', fontSize: '10px' }} title="Provider credentials stay local; local models never leave your machine.">
        <Shield size={10} />
        Local
      </span>

      {/* Provider */}
      <span className="status-bar__item" style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>
        <Circle size={8} style={{ fill: providerId || gcpProject ? 'var(--color-success)' : 'var(--color-error)', color: 'transparent' }} />
        {providerId || gcpProject || 'No provider'}
      </span>

      {/* Model Selector */}
      <ModelSelector selectedModel={selectedModel} onSelect={onModelChange} />
    </footer>
  );
}
