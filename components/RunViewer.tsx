'use client';

/* OrbitCode — Historical Run Viewer (first-class)
 *
 * This component replaces the previous "open the file explorer and guess"
 * flow for reviewing past runs. It presents:
 *
 *   ┌─ index ────────────────────────────────────┐
 *   │  list of runs, newest first                │
 *   │  click → opens the detail view             │
 *   └────────────────────────────────────────────┘
 *
 *   ┌─ detail ───────────────────────────────────┐
 *   │  header (id · status · stepCount · when)   │
 *   │  [ Report ] [ Screenshots ] [ Recording ]  │
 *   │  [ Timeline ]                              │
 *   │  — selecting a step focuses its screenshot │
 *   │  — explicit empty states for each panel    │
 *   └────────────────────────────────────────────┘
 *
 * All data is fetched from /api/runs.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, FileText, Image as ImageIcon, Film, List, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Inbox,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface RunViewerProps {
  projectFolder: string;
  /** Open this run immediately. If omitted, show the run index. */
  runId?: string;
  /** Notified when the user opens a run from the index so the parent can
   *  swap tabs / update its URL. */
  onOpenRun?: (runId: string) => void;
  /** Notified when the user goes back from detail → index. */
  onBack?: () => void;
}

interface RunSummary {
  id: string;
  type: 'browser' | 'diagnosis' | 'task';
  timestamp: number;
  status: string;
  stepCount: number;
  intent?: string;
  verdict?: string;
  complexity?: string;
}

interface BrowserStep {
  id?: string;
  action: string;
  description: string;
  url?: string;
  screenshot?: string;
  timestamp?: number;
  duration?: number;
  error?: string;
}

interface RunDetail {
  id: string;
  manifest: {
    status?: string;
    stepCount?: number;
    steps?: BrowserStep[];
    startedAt?: number;
    completedAt?: number;
    currentUrl?: string;
  } | null;
  report: string | null;
  screenshots: string[];
  rawLogs: string;
  videoUrl: string | null;
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString();
}

function statusColor(status: string): string {
  switch (status) {
    case 'complete':
    case 'passed':
      return 'var(--color-success)';
    case 'failed':
    case 'error':
      return 'var(--color-error)';
    case 'running':
      return '#4EC3E0';
    default:
      return 'var(--text-disabled)';
  }
}

function verdictColor(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v === 'PASS' || v === 'SUCCESS') return 'var(--color-success)';
  if (v === 'FAIL' || v === 'FAILED') return 'var(--color-error)';
  if (v === 'PARTIAL') return 'var(--color-warning)';
  return 'var(--text-disabled)';
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  const icon = status === 'complete' || status === 'passed'
    ? <CheckCircle size={12} style={{ color }} />
    : status === 'failed' || status === 'error'
    ? <XCircle size={12} style={{ color }} />
    : <AlertTriangle size={12} style={{ color }} />;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, padding: '2px 8px', borderRadius: 10,
      border: `1px solid ${color}`, color,
    }}>
      {icon}{status}
    </span>
  );
}

function RunIndex({ projectFolder, onOpenRun }: { projectFolder: string; onOpenRun?: (id: string) => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/runs?projectFolder=${encodeURIComponent(projectFolder)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }, [projectFolder]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 24, background: 'var(--bg-primary)', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <List size={20} style={{ color: 'var(--text-primary)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Historical Runs</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Past agent runs, diagnoses, and browser verifications</div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} style={{ marginRight: 6 }} />
          Refresh
        </button>
      </div>

      {err && (
        <div style={{ padding: 12, background: 'rgba(232, 92, 14, 0.1)', color: 'var(--color-error)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!runs && !err && <div style={{ fontSize: 13, color: 'var(--text-disabled)' }}>Loading runs…</div>}

      {runs && runs.length === 0 && (
        <div style={{
          padding: 40, textAlign: 'center', border: '1px dashed var(--border-subtle)', borderRadius: 8,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-disabled)',
        }}>
          <Inbox size={28} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>No runs yet</div>
          <div style={{ fontSize: 12 }}>Launch an agent task — diagnoses, implement cycles, and browser QA will appear here.</div>
        </div>
      )}

      {runs && runs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {runs.map(r => (
            <button
              key={r.id}
              onClick={() => onOpenRun?.(r.id)}
              style={{
                textAlign: 'left',
                border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
                borderRadius: 6, padding: '10px 14px', color: 'var(--text-primary)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 16,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{r.id}</span>
                  <StatusBadge status={r.status || r.type} />
                  {r.verdict && (
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                      color: verdictColor(r.verdict),
                      border: `1px solid ${verdictColor(r.verdict)}`,
                    }}>
                      {r.verdict}
                    </span>
                  )}
                  {r.complexity && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 600,
                      background: r.complexity === 'complex' ? 'rgba(232, 92, 14, 0.15)' :
                                  r.complexity === 'moderate' ? 'rgba(0, 146, 209, 0.15)' :
                                  'rgba(103, 173, 86, 0.15)',
                      color: r.complexity === 'complex' ? '#E85C0E' :
                             r.complexity === 'moderate' ? '#0092D1' :
                             '#67AD56',
                    }}>
                      {r.complexity}
                    </span>
                  )}
                </div>
                {r.intent && (
                  <div style={{ fontSize: 11, color: 'var(--text-primary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.intent}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {r.type} · {r.stepCount} step{r.stepCount === 1 ? '' : 's'} · {fmt(r.timestamp)}
                </div>
              </div>
              <ArrowLeft size={14} style={{ transform: 'rotate(180deg)', color: 'var(--text-disabled)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RunDetailView({ projectFolder, runId, onBack }: { projectFolder: string; runId: string; onBack?: () => void }) {
  const [data, setData] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'report' | 'screenshots' | 'recording'>('screenshots');
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/runs?projectFolder=${encodeURIComponent(projectFolder)}&runId=${encodeURIComponent(runId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d);
      // Auto-select first step if there are steps.
      const steps = d.manifest?.steps || [];
      if (steps.length > 0) setSelectedStep(0);
      // If there's no screenshot stream but there's a report, default to report.
      if ((d.screenshots?.length || 0) === 0 && d.report) setTab('report');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load run');
    } finally {
      setLoading(false);
    }
  }, [projectFolder, runId]);

  useEffect(() => { load(); }, [load]);

  const steps = data?.manifest?.steps || [];
  const screenshots = data?.screenshots || [];
  const activeShot = useMemo(() => {
    if (!data) return null;
    if (selectedStep !== null && steps[selectedStep]?.screenshot) return steps[selectedStep].screenshot!;
    return screenshots[0] || null;
  }, [data, selectedStep, steps, screenshots]);

  const status = data?.manifest?.status || 'unknown';

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <button className="icon-btn" onClick={onBack} title="Back to run list"><ArrowLeft size={14} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {runId}
            <StatusBadge status={status} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {steps.length} step{steps.length === 1 ? '' : 's'}
            {data?.manifest?.startedAt ? ` · started ${fmt(data.manifest.startedAt)}` : ''}
          </div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} style={{ marginRight: 6 }} /> Reload
        </button>
      </div>

      {err && (
        <div style={{ padding: 12, background: 'rgba(232, 92, 14, 0.1)', color: 'var(--color-error)', margin: 12, borderRadius: 6, fontSize: 12 }}>
          {err}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Timeline */}
        <div style={{
          width: 280, flexShrink: 0, borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.5 }}>
            TIMELINE
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {steps.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 11 }}>
                No step timeline available for this run.
              </div>
            )}
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => { setSelectedStep(i); if (s.screenshot) setTab('screenshots'); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none', background: selectedStep === i ? 'var(--bg-tertiary)' : 'transparent',
                  borderLeft: selectedStep === i ? '3px solid #4EC3E0' : '3px solid transparent',
                  color: 'var(--text-primary)', cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600 }}>{i + 1}. {s.action}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.description || s.url || '(no description)'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
          }}>
            {([
              ['screenshots', <ImageIcon size={12} key="ss" />, 'Screenshots'],
              ['report', <FileText size={12} key="rp" />, 'Report'],
              ['recording', <Film size={12} key="rc" />, 'Recording'],
            ] as const).map(([id, icon, label]) => (
              <button
                key={id}
                onClick={() => setTab(id as typeof tab)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', fontSize: 11, fontWeight: 600,
                  background: tab === id ? 'var(--bg-secondary)' : 'transparent',
                  color: tab === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: '1px solid ' + (tab === id ? 'var(--border-default)' : 'transparent'),
                  borderRadius: 4, cursor: 'pointer',
                }}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {tab === 'screenshots' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeShot ? (
                  failedImages.has(activeShot) ? (
                    <div style={{ padding: 24, border: '1px dashed var(--color-error)', borderRadius: 6, color: 'var(--color-error)', fontSize: 12 }}>
                      Screenshot failed to load: <span style={{ fontFamily: 'var(--font-mono)' }}>{activeShot}</span>
                    </div>
                  ) : (
                    <img
                      src={activeShot}
                      alt="Step capture"
                      onError={() => setFailedImages(prev => new Set(prev).add(activeShot))}
                      style={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border-subtle)', background: '#000' }}
                    />
                  )
                ) : (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 12, border: '1px dashed var(--border-subtle)', borderRadius: 6 }}>
                    No screenshots were captured for this run.
                  </div>
                )}
                {screenshots.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {screenshots.map((s, i) => (
                      <div
                        key={s}
                        onClick={() => {
                          const idx = steps.findIndex(st => st.screenshot === s);
                          if (idx >= 0) setSelectedStep(idx);
                        }}
                        style={{
                          width: 120, height: 70, cursor: 'pointer',
                          border: s === activeShot ? '2px solid #4EC3E0' : '1px solid var(--border-subtle)',
                          borderRadius: 4, overflow: 'hidden', background: 'var(--bg-tertiary)',
                        }}
                        title={`Screenshot ${i + 1}`}
                      >
                        {failedImages.has(s) ? (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-error)', fontSize: 10 }}>broken</div>
                        ) : (
                          <img src={s} onError={() => setFailedImages(prev => new Set(prev).add(s))} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'report' && (
              <div style={{ padding: '24px 32px', maxWidth: 920, margin: '0 auto' }}>
                {data?.report ? (
                  <div className="report-markdown" style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.report}</ReactMarkdown>
                  </div>
                ) : (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 12, border: '1px dashed var(--border-subtle)', borderRadius: 6 }}>
                    No report.md was generated for this run.
                  </div>
                )}
              </div>
            )}

            {tab === 'recording' && (
              <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
                {data?.videoUrl ? (
                  <video
                    controls
                    src={data.videoUrl}
                    style={{ maxWidth: '100%', maxHeight: 600, borderRadius: 6, border: '1px solid var(--border-subtle)', background: '#000' }}
                  />
                ) : (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 12, border: '1px dashed var(--border-subtle)', borderRadius: 6, maxWidth: 500 }}>
                    No browser recording was captured for this run.<br />
                    (The browser subagent only records when the QA stage actually runs.)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RunViewer({ projectFolder, runId, onOpenRun, onBack }: RunViewerProps) {
  if (runId) {
    return <RunDetailView projectFolder={projectFolder} runId={runId} onBack={onBack} />;
  }
  return <RunIndex projectFolder={projectFolder} onOpenRun={onOpenRun} />;
}
