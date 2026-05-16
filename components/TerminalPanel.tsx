'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as TerminalIcon, X, Play, Square, Trash2, ShieldAlert, Ban, ShieldCheck } from 'lucide-react';

interface TerminalLine {
  type: 'stdout' | 'stderr' | 'command' | 'system' | 'guard';
  content: string;
  timestamp: number;
}

interface SafetyCheck {
  level: 'safe' | 'write' | 'destructive' | 'blocked';
  reason: string;
  requiresApproval: boolean;
}

interface ComplianceResult {
  status: 'ok' | 'warn' | 'blocked';
  reason: string;
  category?: string;
}

interface TerminalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  projectFolder: string;
  externalCommand?: string | null;
  onExternalCommandDone?: () => void;
}

interface PendingApproval {
  command: string;
  isAutoExec: boolean;
  classification: SafetyCheck;
  compliance: ComplianceResult;
  confirmToken: string;
}

export default function TerminalPanel({ isOpen, onToggle, projectFolder, externalCommand, onExternalCommandDone }: TerminalPanelProps) {
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: 'system', content: '⚡ OrbitCode Terminal — Ready (guarded mode)', timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [height, setHeight] = useState(220);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => { if (isOpen) inputRef.current?.focus(); }, [isOpen]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: height };
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setHeight(Math.max(100, Math.min(600, dragRef.current.startHeight + delta)));
    };
    const up = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [height]);

  const pushLine = useCallback((type: TerminalLine['type'], content: string) =>
    setLines(prev => [...prev, { type, content, timestamp: Date.now() }]),
  []);

  const streamExecute = useCallback(async (
    command: string,
    isAutoExec: boolean,
    extra: { confirmed?: boolean; confirmToken?: string } = {}
  ) => {
    pushLine('command', `${isAutoExec ? '🤖' : '$'} ${command}`);
    if (isAutoExec) pushLine('system', '⚡ Auto-executing command from AI…');
    setIsRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, cwd: projectFolder, ...extra }),
        signal: controller.signal,
      });

      // Guarded responses (blocked / needs approval / bad path) arrive as JSON, not SSE.
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('text/event-stream')) {
        const data = await res.json().catch(() => null);
        if (res.status === 403 && data) {
          pushLine('guard', `🚫 Blocked: ${data.reason || 'command violates policy'}`);
          return;
        }
        if (res.status === 409 && data?.needsApproval) {
          setPendingApproval({
            command,
            isAutoExec,
            classification: data.classification,
            compliance: data.compliance,
            confirmToken: data.confirmToken,
          });
          pushLine('guard', `⚠ Destructive command requires approval: ${data.reason}`);
          return;
        }
        pushLine('stderr', `Error ${res.status}: ${(data && data.error) || res.statusText}`);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const raw of chunks) {
          const line = raw.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'classification') {
              const c: SafetyCheck = data.classification;
              pushLine('guard',
                c.level === 'safe'
                  ? `✓ Classified ${c.level}: ${c.reason}`
                  : `• Classified ${c.level}: ${c.reason}`
              );
              if (data.compliance?.status === 'warn') {
                pushLine('guard', `⚠ Compliance warning: ${data.compliance.reason}`);
              }
            } else if (data.type === 'stdout' || data.type === 'stderr') {
              pushLine(data.type, data.content);
            } else if (data.type === 'exit') {
              pushLine(data.code === 0 ? 'system' : 'stderr', `Process exited with code ${data.code}`);
            } else if (data.type === 'error') {
              pushLine('stderr', data.content);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        pushLine('stderr', `Error: ${error.message}`);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [projectFolder, pushLine]);

  const runCommand = useCallback(async (cmd: string, isAutoExec = false) => {
    if (!cmd.trim() || isRunning) return;
    await streamExecute(cmd, isAutoExec);
  }, [isRunning, streamExecute]);

  useEffect(() => {
    if (externalCommand && !isRunning) {
      runCommand(externalCommand, true);
      onExternalCommandDone?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalCommand]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    runCommand(input.trim());
    setInput('');
  };

  const handleApprove = async () => {
    if (!pendingApproval) return;
    const p = pendingApproval;
    setPendingApproval(null);
    pushLine('guard', `✓ User approved destructive command`);
    await streamExecute(p.command, p.isAutoExec, { confirmed: true, confirmToken: p.confirmToken });
  };

  const handleReject = () => {
    if (!pendingApproval) return;
    pushLine('guard', `✗ User rejected command: ${pendingApproval.command}`);
    setPendingApproval(null);
  };

  const handleStop = () => { abortRef.current?.abort(); setIsRunning(false); };
  const handleClear = () => setLines([{ type: 'system', content: '⚡ Terminal cleared', timestamp: Date.now() }]);

  if (!isOpen) return null;

  return (
    <div className="terminal-panel" style={{ height: `${height}px` }}>
      <div className="terminal-resize" onMouseDown={handleResizeStart} />

      <div className="terminal-header">
        <div className="terminal-header__title">
          <TerminalIcon size={13} />
          Terminal
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ShieldCheck size={11} /> guarded
          </span>
          {isRunning && <span className="terminal-header__running">Running</span>}
        </div>
        <div className="terminal-header__actions">
          {isRunning && (
            <button className="icon-btn" onClick={handleStop} title="Stop"><Square size={12} /></button>
          )}
          <button className="icon-btn" onClick={handleClear} title="Clear"><Trash2 size={12} /></button>
          <button className="icon-btn" onClick={onToggle} title="Close"><X size={14} /></button>
        </div>
      </div>

      <div className="terminal-output" ref={outputRef}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={`terminal-line terminal-line--${line.type}`}
            style={line.type === 'guard' ? { color: '#FFCB38', fontStyle: 'italic' } : undefined}
          >
            {line.content}
          </div>
        ))}
      </div>

      {pendingApproval && (
        <div style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '10px 12px',
          background: 'rgba(232, 92, 14, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <ShieldAlert size={18} style={{ color: '#E85C0E', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#E85C0E' }}>
              Destructive command — approval required
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pendingApproval.command}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginTop: 2 }}>
              {pendingApproval.classification.reason}
            </div>
          </div>
          <button className="btn" onClick={handleReject} title="Reject">
            <Ban size={12} style={{ marginRight: 4 }} /> Reject
          </button>
          <button className="btn btn--primary" onClick={handleApprove} title="Approve once">
            Approve once
          </button>
        </div>
      )}

      <form className="terminal-input" onSubmit={handleSubmit}>
        <span className="terminal-input__prompt">$</span>
        <input
          ref={inputRef}
          className="terminal-input__field"
          type="text"
          placeholder={isRunning ? 'Waiting for process...' : pendingApproval ? 'Command awaiting approval…' : 'Enter command...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isRunning || !!pendingApproval}
          autoFocus
        />
        <button
          type="submit"
          className="terminal-input__run"
          disabled={isRunning || !!pendingApproval || !input.trim()}
          title="Run command"
        >
          <Play size={12} />
        </button>
      </form>
    </div>
  );
}
