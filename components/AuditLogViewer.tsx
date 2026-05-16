'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Clock, Terminal, FileText, GitBranch,
  Settings, Zap, AlertTriangle, CheckCircle, XCircle,
  Ban, ChevronDown, ChevronRight, RefreshCw
} from 'lucide-react';

interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  category: string;
  user: string;
  project?: string;
  details: Record<string, unknown>;
  safetyLevel?: string;
  result?: string;
}

interface AuditLogViewerProps {
  projectPath?: string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  tool_call: <Zap size={11} style={{ color: 'var(--accent-primary)' }} />,
  file_op: <FileText size={11} style={{ color: 'var(--accent-secondary)' }} />,
  command: <Terminal size={11} style={{ color: 'var(--color-warning)' }} />,
  git: <GitBranch size={11} style={{ color: 'var(--color-info)' }} />,
  config: <Settings size={11} style={{ color: 'var(--text-secondary)' }} />,
  auth: <Shield size={11} style={{ color: 'var(--color-success)' }} />,
  model: <Zap size={11} style={{ color: 'var(--accent-primary)' }} />,
};

const SAFETY_COLORS: Record<string, string> = {
  safe: 'var(--color-success)',
  write: 'var(--color-warning)',
  destructive: 'var(--color-error)',
  blocked: 'var(--color-error)',
};

const RESULT_ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle size={10} style={{ color: 'var(--color-success)' }} />,
  error: <XCircle size={10} style={{ color: 'var(--color-error)' }} />,
  blocked: <Ban size={10} style={{ color: 'var(--color-error)' }} />,
};

export default function AuditLogViewer({ projectPath }: AuditLogViewerProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filter !== 'all') params.set('category', filter);
      if (projectPath) params.set('project', projectPath);
      const res = await fetch(`/api/audit?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [filter, projectPath]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString();

  return (
    <div className="audit-viewer">
      <div className="audit-viewer__header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          <Shield size={13} style={{ color: 'var(--color-success)' }} />
          Audit Log
        </span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontSize: '10px',
              padding: '2px 4px',
            }}
          >
            <option value="all">All</option>
            <option value="tool_call">Tool Calls</option>
            <option value="command">Commands</option>
            <option value="file_op">File Ops</option>
            <option value="git">Git</option>
            <option value="config">Config</option>
          </select>
          <button className="icon-btn" onClick={loadEntries} title="Refresh">
            <RefreshCw size={11} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="audit-viewer__list">
        {entries.length === 0 && (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-disabled)', fontSize: '11px' }}>
            {loading ? 'Loading...' : 'No audit entries found'}
          </div>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className="audit-entry">
            <button
              className="audit-entry__header"
              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
            >
              {expanded === entry.id ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              {CATEGORY_ICONS[entry.category] || <Zap size={11} />}
              <span className="audit-entry__action">{entry.action}</span>
              {entry.safetyLevel && (
                <span
                  className="audit-entry__safety"
                  style={{ color: SAFETY_COLORS[entry.safetyLevel] || 'var(--text-disabled)' }}
                >
                  {entry.safetyLevel}
                </span>
              )}
              {entry.result && RESULT_ICONS[entry.result]}
              <span className="audit-entry__time">
                <Clock size={8} />
                {formatTime(entry.timestamp)}
              </span>
            </button>

            {expanded === entry.id && (
              <div className="audit-entry__details">
                <div style={{ fontSize: '10px', color: 'var(--text-disabled)', marginBottom: '4px' }}>
                  {formatDate(entry.timestamp)} · {entry.user || 'system'} · {entry.project || '—'}
                </div>
                <pre style={{ 
                  fontSize: '10px', 
                  color: 'var(--text-secondary)', 
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: '200px',
                  overflow: 'auto',
                  background: 'var(--bg-tertiary)',
                  padding: '8px',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  {JSON.stringify(entry.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
