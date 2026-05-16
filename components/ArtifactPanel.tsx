'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText, ClipboardList, GitPullRequest, TestTube2, 
  ChevronRight, ChevronDown, Clock, Bot, User, Trash2,
  Brain, ScrollText
} from 'lucide-react';

export interface Artifact {
  id: string;
  type: 'plan' | 'walkthrough' | 'summary' | 'test_report' | 'decision';
  title: string;
  content: string;
  source: 'agent' | 'user';
  project: string;
  createdAt: number;
  updatedAt: number;
  taskId?: string;
  tags?: string[];
}

interface ArtifactPanelProps {
  projectPath: string;
  onToast?: (msg: string, type: 'success' | 'error') => void;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  plan: <ClipboardList size={12} style={{ color: 'var(--accent-primary)' }} />,
  walkthrough: <ScrollText size={12} style={{ color: 'var(--color-info)' }} />,
  summary: <FileText size={12} style={{ color: 'var(--accent-secondary)' }} />,
  test_report: <TestTube2 size={12} style={{ color: 'var(--color-success)' }} />,
  decision: <Brain size={12} style={{ color: 'var(--color-warning)' }} />,
};

const TYPE_LABELS: Record<string, string> = {
  plan: 'Implementation Plan',
  walkthrough: 'Walkthrough',
  summary: 'Summary',
  test_report: 'Test Report',
  decision: 'Decision',
};

export default function ArtifactPanel({ projectPath, onToast }: ArtifactPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadArtifacts = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/artifacts?project=${encodeURIComponent(projectPath)}`);
      if (res.ok) {
        const data = await res.json();
        setArtifacts(data.artifacts || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { loadArtifacts(); }, [loadArtifacts]);

  const deleteArtifact = async (id: string) => {
    try {
      await fetch(`/api/artifacts?id=${id}&project=${encodeURIComponent(projectPath)}`, { method: 'DELETE' });
      setArtifacts((prev) => prev.filter((a) => a.id !== id));
      onToast?.('Artifact deleted', 'success');
    } catch {
      onToast?.('Failed to delete', 'error');
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="artifact-panel" style={{ padding: '16px', textAlign: 'center', color: 'var(--text-disabled)', fontSize: '11px' }}>
        Loading artifacts...
      </div>
    );
  }

  return (
    <div className="artifact-panel">
      <div className="artifact-panel__header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          <FileText size={13} style={{ color: 'var(--accent-secondary)' }} />
          Artifacts
          <span style={{ fontSize: '10px', color: 'var(--text-disabled)', fontWeight: 400 }}>
            ({artifacts.length})
          </span>
        </span>
      </div>

      <div className="artifact-panel__list">
        {artifacts.length === 0 && (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-disabled)', fontSize: '11px' }}>
            No artifacts yet.<br />
            Agent plans, walkthroughs, and reports will appear here.
          </div>
        )}

        {artifacts.map((artifact) => (
          <div key={artifact.id} className="artifact-item">
            <button
              className="artifact-item__header"
              onClick={() => setExpanded(expanded === artifact.id ? null : artifact.id)}
            >
              {expanded === artifact.id ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {TYPE_ICONS[artifact.type] || <FileText size={12} />}
              <span className="artifact-item__title">{artifact.title}</span>
              <span className="artifact-item__badge">{TYPE_LABELS[artifact.type] || artifact.type}</span>
              <span className="artifact-item__source">
                {artifact.source === 'agent' ? <Bot size={9} /> : <User size={9} />}
              </span>
            </button>

            {expanded === artifact.id && (
              <div className="artifact-item__body">
                <div className="artifact-item__meta">
                  <Clock size={9} />
                  {formatTime(artifact.createdAt)}
                  {artifact.tags && artifact.tags.length > 0 && (
                    <span style={{ marginLeft: '8px' }}>
                      {artifact.tags.map((t) => (
                        <span key={t} className="artifact-item__tag">{t}</span>
                      ))}
                    </span>
                  )}
                  <button
                    className="icon-btn"
                    onClick={() => deleteArtifact(artifact.id)}
                    title="Delete artifact"
                    style={{ marginLeft: 'auto', color: 'var(--color-error)' }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                <div className="artifact-item__content">
                  {artifact.content}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
