'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GitCompare, RefreshCw, Plus, Minus, FileText } from 'lucide-react';

interface DiffViewerProps {
  projectFolder: string;
  isOpen: boolean;
  onClose: () => void;
}

interface DiffHunk {
  file: string;
  additions: number;
  deletions: number;
  lines: Array<{ type: 'add' | 'del' | 'context' | 'header'; content: string }>;
}

function parseDiff(raw: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  if (!raw.trim()) return hunks;

  let current: DiffHunk | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/);
      current = {
        file: match?.[1] || 'unknown',
        additions: 0,
        deletions: 0,
        lines: [],
      };
      hunks.push(current);
    } else if (current) {
      if (line.startsWith('@@')) {
        current.lines.push({ type: 'header', content: line });
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        current.additions++;
        current.lines.push({ type: 'add', content: line.substring(1) });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.deletions++;
        current.lines.push({ type: 'del', content: line.substring(1) });
      } else if (line.startsWith(' ')) {
        current.lines.push({ type: 'context', content: line.substring(1) });
      }
    }
  }
  return hunks;
}

const LINE_COLORS: Record<string, string> = {
  add: 'rgba(52, 211, 153, 0.1)',
  del: 'rgba(248, 113, 113, 0.1)',
  context: 'transparent',
  header: 'rgba(96, 165, 250, 0.08)',
};

const LINE_TEXT_COLORS: Record<string, string> = {
  add: 'var(--color-success)',
  del: 'var(--color-error)',
  context: 'var(--text-secondary)',
  header: 'var(--color-info)',
};

export default function DiffViewer({ projectFolder, isOpen, onClose }: DiffViewerProps) {
  const [hunks, setHunks] = useState<DiffHunk[]>([]);
  const [stagedHunks, setStagedHunks] = useState<DiffHunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'working' | 'staged'>('working');

  const loadDiff = useCallback(async () => {
    if (!projectFolder) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/git?cwd=${encodeURIComponent(projectFolder)}&action=diff`);
      const data = await res.json();
      setHunks(parseDiff(data.diff || ''));
      setStagedHunks(parseDiff(data.staged || ''));
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectFolder]);

  useEffect(() => {
    if (isOpen) loadDiff();
  }, [isOpen, loadDiff]);

  if (!isOpen) return null;

  const activeHunks = activeTab === 'working' ? hunks : stagedHunks;
  const totalAdditions = activeHunks.reduce((s, h) => s + h.additions, 0);
  const totalDeletions = activeHunks.reduce((s, h) => s + h.deletions, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '800px', maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <h2 className="modal__title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitCompare size={18} style={{ color: 'var(--accent-primary)' }} />
            Changes
            <span style={{ fontSize: '11px', color: 'var(--text-disabled)', fontWeight: 400 }}>
              <span style={{ color: 'var(--color-success)' }}>+{totalAdditions}</span>
              {' / '}
              <span style={{ color: 'var(--color-error)' }}>-{totalDeletions}</span>
              {' in '}
              {activeHunks.length} file{activeHunks.length !== 1 ? 's' : ''}
            </span>
          </h2>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button className="icon-btn" onClick={loadDiff} title="Refresh">
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
            </button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: '0', borderBottom: '1px solid var(--border-subtle)',
          padding: '0 16px',
        }}>
          <button
            onClick={() => setActiveTab('working')}
            style={{
              padding: '6px 12px', fontSize: '11px', fontWeight: 600, border: 'none', background: 'none',
              color: activeTab === 'working' ? 'var(--accent-primary)' : 'var(--text-tertiary)',
              borderBottom: activeTab === 'working' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Working ({hunks.length})
          </button>
          <button
            onClick={() => setActiveTab('staged')}
            style={{
              padding: '6px 12px', fontSize: '11px', fontWeight: 600, border: 'none', background: 'none',
              color: activeTab === 'staged' ? 'var(--color-success)' : 'var(--text-tertiary)',
              borderBottom: activeTab === 'staged' ? '2px solid var(--color-success)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Staged ({stagedHunks.length})
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {activeHunks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-disabled)', fontSize: '12px' }}>
              {loading ? 'Loading diff...' : 'No changes detected'}
            </div>
          )}

          {activeHunks.map((hunk, i) => (
            <div key={i} style={{ marginBottom: '12px' }}>
              {/* File header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 16px',
                background: 'var(--bg-secondary)', fontSize: '11px', fontWeight: 600,
                color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                <FileText size={11} />
                {hunk.file}
                <span style={{ marginLeft: 'auto', fontWeight: 400, display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--color-success)' }}><Plus size={9} /> {hunk.additions}</span>
                  <span style={{ color: 'var(--color-error)' }}><Minus size={9} /> {hunk.deletions}</span>
                </span>
              </div>

              {/* Lines */}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.5' }}>
                {hunk.lines.slice(0, 200).map((line, j) => (
                  <div
                    key={j}
                    style={{
                      padding: '0 16px',
                      background: LINE_COLORS[line.type],
                      color: LINE_TEXT_COLORS[line.type],
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    <span style={{ opacity: 0.4, marginRight: '8px', userSelect: 'none' }}>
                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'header' ? '@@' : ' '}
                    </span>
                    {line.content}
                  </div>
                ))}
                {hunk.lines.length > 200 && (
                  <div style={{ padding: '4px 16px', color: 'var(--text-disabled)', fontSize: '10px' }}>
                    ... {hunk.lines.length - 200} more lines
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
