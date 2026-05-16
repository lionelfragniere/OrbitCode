'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, XCircle, RefreshCw, Shield, ClipboardCopy } from 'lucide-react';

type Level = 'pass' | 'warn' | 'fail';

interface PreflightCheck {
  id: string;
  label: string;
  level: Level;
  detail: string;
  remediation?: string;
  version?: string;
}

interface PreflightResult {
  overall: Level;
  summary: { pass: number; warn: number; fail: number };
  checks: PreflightCheck[];
  ranAt: string;
}

interface SystemCheckProps {
  projectFolder?: string;
  embedded?: boolean; // if true, renders without the outer chrome
}

const COLORS: Record<Level, string> = {
  pass: 'var(--color-success)',
  warn: '#FFCB38',
  fail: 'var(--color-error)',
};
const ICONS: Record<Level, React.ReactNode> = {
  pass: <CheckCircle size={14} style={{ color: COLORS.pass }} />,
  warn: <AlertTriangle size={14} style={{ color: COLORS.warn }} />,
  fail: <XCircle size={14} style={{ color: COLORS.fail }} />,
};

export default function SystemCheck({ projectFolder, embedded }: SystemCheckProps) {
  const [data, setData] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = projectFolder ? `?projectFolder=${encodeURIComponent(projectFolder)}` : '';
      const res = await fetch(`/api/preflight${qs}`);
      if (!res.ok) throw new Error(`Preflight HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Preflight failed');
    } finally {
      setLoading(false);
    }
  }, [projectFolder]);

  useEffect(() => { load(); }, [load]);

  const copySummary = () => {
    if (!data) return;
    const text = [
      `OrbitCode System Check — ${data.ranAt}`,
      `Overall: ${data.overall.toUpperCase()} (pass=${data.summary.pass} warn=${data.summary.warn} fail=${data.summary.fail})`,
      '',
      ...data.checks.map(c =>
        `- [${c.level.toUpperCase()}] ${c.label}: ${c.detail}${c.remediation ? `\n    remediation: ${c.remediation}` : ''}`
      ),
    ].join('\n');
    navigator.clipboard?.writeText(text);
  };

  const overallColor = data ? COLORS[data.overall] : 'var(--text-disabled)';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      padding: embedded ? 0 : 24,
      overflow: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Shield size={22} style={{ color: overallColor }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>System Check</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Host-environment readiness for OrbitCode
            {data && (
              <> · <span style={{ color: overallColor, fontWeight: 600 }}>Overall: {data.overall.toUpperCase()}</span>
                · pass {data.summary.pass} · warn {data.summary.warn} · fail {data.summary.fail}</>
            )}
          </div>
        </div>
        <button className="btn" onClick={copySummary} disabled={!data} title="Copy summary">
          <ClipboardCopy size={12} style={{ marginRight: 6 }} /> Copy
        </button>
        <button className="btn btn--primary" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} style={{ marginRight: 6 }} />
          {loading ? 'Checking…' : 'Re-run check'}
        </button>
      </div>

      {err && (
        <div style={{ padding: 12, borderRadius: 6, background: 'rgba(232, 92, 14, 0.1)', color: 'var(--color-error)', fontSize: 12, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!data && !err && (
        <div style={{ color: 'var(--text-disabled)', fontSize: 13 }}>Running checks…</div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.checks.map(c => (
            <div key={c.id} style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '12px 14px',
              background: 'var(--bg-secondary)',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}>
              <div style={{ marginTop: 2 }}>{ICONS[c.level]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: COLORS[c.level], textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                    {c.level}
                  </div>
                  {c.version && (
                    <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
                      {c.version}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{c.detail}</div>
                {c.remediation && (
                  <div style={{
                    marginTop: 6,
                    padding: 8,
                    background: 'var(--bg-tertiary)',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {c.remediation}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-disabled)' }}>
          Ran at {new Date(data.ranAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
