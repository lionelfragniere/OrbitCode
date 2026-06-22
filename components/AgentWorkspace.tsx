'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, Check, X, Code2, AlertTriangle,
  Compass, Hammer, ClipboardList, Target, Stethoscope, SearchCheck,
  Zap, Wrench, Package, Globe, GitMerge, CloudUpload,
  ChevronDown, FileText, Edit, FolderOpen, Trash2, Loader2, FileCode, TerminalSquare
} from 'lucide-react';
import { ChatMessage, OpenFile, AgentTask, OrchestratorStageName } from '@/lib/types';

// ════════════════════════════════════════════
//  Types & Props
// ════════════════════════════════════════════

interface AgentWorkspaceProps {
  isOpen: boolean;
  className?: string;
  messages: ChatMessage[];
  task: AgentTask | null;
  isAgentRunning: boolean;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  onApplyCode: (code: string) => void;
  onSaveAsFile: (path: string, content: string) => void;
  onAutoCreateFiles: (files: Array<{ path: string; content: string }>) => void;
  onRunCommand?: (command: string) => void;
  activeFile: OpenFile | null;
  onResumeTask: (taskId: string, action: string) => void;
}

// ════════════════════════════════════════════
//  Stage UI Definitions
// ════════════════════════════════════════════
const STAGE_META: Record<OrchestratorStageName | string, { icon: React.ReactNode; label: string; color: string }> = {
  intent: { icon: <Target size={14} />, label: 'Intent', color: '#4EC3E0' },
  scout: { icon: <Compass size={14} />, label: 'Scout', color: '#00A997' },
  toolStrategy: { icon: <Wrench size={14} />, label: 'Strategy', color: '#0092D1' },
  plan: { icon: <ClipboardList size={14} />, label: 'Plan', color: '#7C3AED' },
  diagnose: { icon: <Stethoscope size={14} />, label: 'Diagnosis', color: '#F97316' },
  audit: { icon: <SearchCheck size={14} />, label: 'Audit', color: '#14B8A6' },
  implement: { icon: <Code2 size={14} />, label: 'Build', color: '#E85C0E' },
  build: { icon: <Hammer size={14} />, label: 'Test', color: '#FFCB38' },
  browserQa: { icon: <SearchCheck size={14} />, label: 'Browser', color: '#3B82F6' },
  critic: { icon: <SearchCheck size={14} />, label: 'Review', color: '#EC4899' },
  repair: { icon: <Wrench size={14} />, label: 'Repair', color: '#EF4444' },
  release: { icon: <Package size={14} />, label: 'Release', color: '#10B981' },
  gitSync: { icon: <GitMerge size={14} />, label: 'Git Sync', color: '#F472B6' },
  gcpDeploy: { icon: <CloudUpload size={14} />, label: 'Deploy', color: '#3B82F6' },
};

const STARTER_PROMPTS = [
  'Audit this project for bugs, broken flows, and over-engineering. Give me the shortest fix list.',
  'Make the smallest useful improvement, run the checks, and show me what changed.',
  'Create or update the app, then verify every route in the browser with screenshots.',
];

// ════════════════════════════════════════════
//  Utility: detect internal/raw noise in text
// ════════════════════════════════════════════

function isInternalNoise(text: string): boolean {
  if (!text || text.length < 5) return true;
  const t = text.trim();
  // Raw JSON payloads
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { JSON.parse(t); return true; } catch { /* not json */ }
  }
  // Internal SSE / API markers
  if (/^(data:|event:)/m.test(t)) return true;
  if (/\/api\/preview\?/.test(t)) return true;
  if (/"type":\s*"(tool_call|tool_result|browser_step|browser_screenshot)"/.test(t)) return true;
  // Internal orchestrator status lines
  if (/PAUSE_FOR_APPROVAL/i.test(t)) return true;
  if (/Orchestrator finished/i.test(t)) return true;
  if (/Task Complete Complexity/i.test(t)) return true;
  if (/^## Task Complete/i.test(t)) return true;
  if (/Stages run:\s*\d+/i.test(t)) return true;
  if (/^\[System\]:/i.test(t)) return true;
  if (/recovery_triggered|stage_start|stage_complete/i.test(t)) return true;
  // Embedded JSON verdict objects
  if (/"verdict"\s*:\s*"/.test(t) && /"summary"\s*:\s*"/.test(t)) return true;
  // Raw tool result echoes
  if (/"files_created"\s*:/.test(t) || /"files_modified"\s*:/.test(t) || /"commands_run"\s*:/.test(t)) return true;
  return false;
}

/** Strip raw noise from displayed message content */
function cleanMessageContent(content: string): string {
  if (!content) return '';
  let cleaned = content;
  // Remove inline JSON blobs (verdict objects, tool results)
  cleaned = cleaned.replace(/```json\s*\{[\s\S]*?"type"\s*:\s*"(tool_call|tool_result|browser_step)"[\s\S]*?```/g, '');
  // Remove freestanding JSON verdict blocks
  cleaned = cleaned.replace(/\{[\s\S]*?"verdict"\s*:\s*"[\s\S]*?"summary"\s*:[\s\S]*?\}/g, '');
  // Remove raw tool result JSON blocks
  cleaned = cleaned.replace(/\{[\s\S]*?"files_created"\s*:[\s\S]*?\}/g, '');
  cleaned = cleaned.replace(/\{[\s\S]*?"files_modified"\s*:[\s\S]*?\}/g, '');
  cleaned = cleaned.replace(/\{[\s\S]*?"commands_run"\s*:[\s\S]*?\}/g, '');
  // Remove /api/preview URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]*\/api\/preview\?[^\s]*/g, '[preview]');
  // Remove internal orchestrator status lines
  cleaned = cleaned.replace(/^.*PAUSE_FOR_APPROVAL.*$/gm, '');
  cleaned = cleaned.replace(/^.*Orchestrator finished.*$/gm, '');
  cleaned = cleaned.replace(/^.*Task Complete Complexity.*$/gm, '');
  cleaned = cleaned.replace(/^.*## Task Complete.*$/gm, '');
  cleaned = cleaned.replace(/^.*Stages run:\s*\d+.*$/gm, '');
  cleaned = cleaned.replace(/^.*\[System\]:.*$/gm, '');
  // Remove duplicated lines (same content repeated)
  const lines = cleaned.split('\n');
  const seen = new Set<string>();
  const deduped = lines.filter(line => {
    const key = line.replace(/\s+/g, ' ').trim();
    if (!key) return true; // keep blank lines
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Collapse multiple blank lines
  return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Strip noise from plan summary — remove "awaiting approval" boilerplate */
function cleanPlanSummary(text: string): string {
  if (!text) return '';
  let cleaned = text;
  // Remove "awaiting approval" lines  
  cleaned = cleaned.replace(/The plan has been proposed and is awaiting.*?\.?\s*/gi, '');
  cleaned = cleaned.replace(/I will wait for the user.*?\.?\s*/gi, '');
  cleaned = cleaned.replace(/I am ready to proceed once the plan is provided.*?\.?\s*/gi, '');
  cleaned = cleaned.replace(/Please review the.*?acceptance criteria.*?\.?\s*/gi, '');
  cleaned = cleaned.replace(/awaiting your approval.*?\.?\s*/gi, '');
  cleaned = cleaned.replace(/Waiting for user.*?\.?\s*/gi, '');
  cleaned = cleaned.replace(/Task complete\.?\s*/gi, '');
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/** Extract URLs from text */
function extractUrls(text: string): Array<{ url: string; label: string }> {
  const urls: Array<{ url: string; label: string }> = [];
  const urlRegex = /https?:\/\/[^\s"'<>\])+]+/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    // Skip internal/preview URLs
    if (url.includes('/api/') || url.includes('localhost')) continue;
    // Determine a label
    let label = 'Open Link';
    if (url.includes('.run.app')) label = '🚀 Open Deployed App';
    else if (url.includes('github.com')) label = 'View on GitHub';
    else if (url.includes('console.cloud.google.com')) label = 'GCP Console';
    urls.push({ url, label });
  }
  return urls;
}

// ════════════════════════════════════════════
//  Tool call display helper
// ════════════════════════════════════════════

const TOOL_DISPLAY: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  create_file: { icon: <FileCode size={12} />, label: 'Creating file', color: '#10B981' },
  edit_file: { icon: <Edit size={12} />, label: 'Editing file', color: '#FFCB38' },
  read_file: { icon: <FileText size={12} />, label: 'Reading file', color: '#4EC3E0' },
  delete_file: { icon: <Trash2 size={12} />, label: 'Deleting file', color: '#EF4444' },
  run_command: { icon: <TerminalSquare size={12} />, label: 'Running command', color: '#8B5CF6' },
  list_files: { icon: <FolderOpen size={12} />, label: 'Listing files', color: '#6B7280' },
  search_files: { icon: <SearchCheck size={12} />, label: 'Searching files', color: '#3B82F6' },
  task_complete: { icon: <Check size={12} />, label: 'Stage complete', color: '#10B981' },
  run_browser_test: { icon: <Globe size={12} />, label: 'Browser test', color: '#3B82F6' },
  git_action: { icon: <GitMerge size={12} />, label: 'Git operation', color: '#F472B6' },
  gcp_action: { icon: <CloudUpload size={12} />, label: 'Deploying', color: '#0092D1' },
};

// ════════════════════════════════════════════
//  Cards — Memoized
// ════════════════════════════════════════════

const PlanCard = memo(function PlanCard({ payload, onApprove, onEdit, taskStatus }: { payload: any, onApprove: () => void, onEdit: () => void, taskStatus: 'paused' | 'executing' | 'complete' | 'error' }) {
  if (!payload) return null;

  // The orchestrator sends { summary: string, stages: string[] }
  // Legacy format also supported: { task_breakdown: string[], goal: string }
  const rawSummary = payload.summary || payload.goal || '';
  const cleaned = cleanPlanSummary(rawSummary);
  // If cleaning removed everything, fall back to the raw text
  const summary = cleaned || rawSummary;
  const stages = payload.stages || [];
  const taskBreakdown = payload.task_breakdown || [];

  // Always render when we have a payload — the user needs to see the approve buttons

  return (
    <div className="agent-card" style={{ maxWidth: '100%' }}>
      <div className="agent-card-header" style={{ color: '#7C3AED' }}>
        <ClipboardList size={16} /> <strong>Implementation Plan</strong>
        {taskStatus === 'executing' && (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Loader2 size={10} className="spin" /> Executing...
          </span>
        )}
        {(taskStatus === 'complete' || taskStatus === 'error') && (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#4C9F38', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Check size={10} /> Plan approved
          </span>
        )}
      </div>
      <div className="agent-card-body" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        {/* Render structured task_breakdown if present (legacy) */}
        {taskBreakdown.length > 0 && (
          <>
            <p style={{ fontWeight: 500, fontSize: '13px', marginBottom: '12px' }}>{payload.goal}</p>
            <div style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-disabled)', marginBottom: '8px', fontWeight: 600 }}>Steps</div>
              <ol style={{ paddingLeft: '16px', margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                {taskBreakdown.map((step: string, i: number) => (
                  <li key={i} style={{ marginBottom: '4px' }}>{step}</li>
                ))}
              </ol>
            </div>
          </>
        )}
        {/* Render summary markdown from orchestrator */}
        {summary && taskBreakdown.length === 0 && (
          <div className="plan-summary-content" style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-primary)' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        )}
        {/* Stage pipeline preview */}
        {stages.length > 0 && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-disabled)', fontWeight: 600 }}>Pipeline:</span>
            {stages.map((s: string, i: number) => (
              <span key={i} style={{
                fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontWeight: 500,
              }}>{s}</span>
            ))}
          </div>
        )}
      </div>
      {/* Only show action buttons when paused (awaiting approval) */}
      {taskStatus === 'paused' && (
        <div className="agent-card-actions">
          <button className="agent-btn secondary" onClick={onEdit}>Revise Plan</button>
          <button className="agent-btn primary" onClick={onApprove}><Check size={14} /> Approve & Continue</button>
        </div>
      )}
    </div>
  );
});

interface DecisionOption {
  label: string;
  value: string;
  description?: string;
}

function toDecisionOption(option: unknown, index: number): DecisionOption {
  if (typeof option === 'string') {
    return { label: option, value: option };
  }
  if (option && typeof option === 'object') {
    const record = option as Record<string, unknown>;
    const label = String(record.label || record.title || record.value || record.description || `Choice ${index + 1}`).trim();
    return {
      label,
      value: String(record.value || label).trim(),
      description: record.description && String(record.description) !== label ? String(record.description) : undefined,
    };
  }
  const fallback = `Choice ${index + 1}`;
  return { label: fallback, value: fallback };
}

function isPlaceholderDecisionOption(option: DecisionOption): boolean {
  return /^(option \d+|option [a-z]|choice \d+)$/i.test(option.label.trim());
}

const DecisionCard = memo(function DecisionCard({ payload, onSelect }: { payload: any, onSelect: (option: string) => void }) {
  if (!payload) return null;
  const title = String(payload.title || 'OrbitCode needs your choice');
  const description = String(payload.description || 'Choose how you want OrbitCode to continue.');
  const options = Array.isArray(payload.options) ? payload.options.map(toDecisionOption) : [];
  const hasPlaceholderOptions = options.length === 0 || options.some(isPlaceholderDecisionOption);
  const visibleOptions: DecisionOption[] = hasPlaceholderOptions ? [] : options;

  return (
    <div className="agent-card">
      <div className="agent-card-header" style={{ color: '#E85C0E' }}>
        <AlertTriangle size={16} /> <strong>Decision Required</strong>
      </div>
      <div className="agent-card-body">
        <p style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{title}</p>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>{description}</p>
        {hasPlaceholderOptions && (
          <div style={{ fontSize: '12px', color: 'var(--color-warning)', marginBottom: '12px', lineHeight: 1.5 }}>
            OrbitCode asked this unclearly. It should show real choices here, so the agent will be asked to rephrase before continuing.
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {visibleOptions.map((opt, i: number) => (
            <button
              key={i}
              className="agent-btn secondary"
              onClick={() => onSelect(opt.value)}
              style={{ whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.35, maxWidth: '100%' }}
            >
              <span>{opt.label}</span>
              {opt.description && (
                <span style={{ display: 'block', marginTop: 3, fontSize: '11px', color: 'var(--text-disabled)' }}>
                  {opt.description}
                </span>
              )}
            </button>
          ))}
          {hasPlaceholderOptions && (
            <button className="agent-btn secondary" onClick={() => onSelect('Please rephrase the choices with clear labels.')}>
              Ask OrbitCode to show clear choices
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

const ResultCard = memo(function ResultCard({ payload, task }: { payload: any, task?: AgentTask | null }) {
  if (!payload) return null;
  const isFail = payload.verdict?.toLowerCase().includes('fail') || payload.verdict?.toLowerCase().includes('error');
  
  // Extract URLs from the summary, the task steps, and the payload
  const allText = [
    payload.summary || '',
    payload.url || '',
    ...(payload.links || []).map((l: any) => l.url || ''),
    // Also look through task steps for deployment URLs
    ...(task?.steps || [])
      .filter(s => s.toolName === 'gcp_action' || s.toolName === 'run_command')
      .map(s => s.toolResult || s.content || ''),
  ].join(' ');
  
  const extractedUrls = extractUrls(allText);
  const explicitLinks = payload.links || [];
  // Combine explicit links with extracted, dedupe by URL
  const allLinks = [...explicitLinks];
  for (const eu of extractedUrls) {
    if (!allLinks.find((l: any) => l.url === eu.url)) {
      allLinks.push(eu);
    }
  }
  
  return (
    <div className="agent-card" style={{ borderLeft: isFail ? '3px solid var(--color-error)' : '3px solid #10B981' }}>
      <div className="agent-card-header" style={{ color: isFail ? 'var(--color-error)' : '#10B981' }}>
        {isFail ? <X size={16} /> : <Check size={16} />} <strong>{payload.verdict || 'Task Completed'}</strong>
      </div>
      <div className="agent-card-body">
        {payload.summary && (
          <div style={{ fontSize: '13px', marginBottom: '12px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{payload.summary}</ReactMarkdown>
          </div>
        )}

        {task && (task.filesCreated.length > 0 || task.filesModified.length > 0) && (
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            <strong>Files affected:</strong> {[...new Set([...task.filesCreated, ...task.filesModified])].length} files
          </div>
        )}

        {allLinks.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            {allLinks.map((link: any, i: number) => (
              <a key={i} href={link.url} target="_blank" rel="noreferrer" className="agent-btn primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Globe size={12} /> {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/** Collapsible technical details block */
function TechnicalDetails({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  if (!content || content.length < 20) return null;
  return (
    <div style={{ marginTop: '8px' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-disabled)',
          fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
          padding: '4px 0',
        }}
      >
        <ChevronDown size={10} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
        Technical details
      </button>
      {open && (
        <pre style={{
          fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)',
          background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '8px',
          maxHeight: '200px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {content}
        </pre>
      )}
    </div>
  );
}

/** Live Activity Feed — shows recent tool operations in real-time */
const LiveActivityFeed = memo(function LiveActivityFeed({ task }: { task: AgentTask }) {
  if (!task?.steps || task.steps.length === 0) return null;
  
  // Get recent meaningful tool calls (last 8)
  const recentOps = task.steps
    .filter(s => s.type === 'tool_call' && s.toolName && s.toolName !== 'task_complete')
    .slice(-8);
  
  if (recentOps.length === 0) return null;
  
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
      borderRadius: '8px', padding: '12px 16px', fontSize: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--text-disabled)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>
        <Zap size={10} /> Live Activity
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {recentOps.map((op, i) => {
          const toolMeta = TOOL_DISPLAY[op.toolName || ''] || { icon: <Code2 size={12} />, label: op.toolName || 'Operation', color: 'var(--text-secondary)' };
          const filePath = op.toolArgs?.path ? String(op.toolArgs.path).split(/[\\/]/).pop() : '';
          const command = op.toolArgs?.command ? String(op.toolArgs.command).substring(0, 60) : '';
          const isLast = i === recentOps.length - 1;
          
          return (
            <div key={op.id} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              color: isLast ? toolMeta.color : 'var(--text-disabled)',
              opacity: isLast ? 1 : 0.6,
              fontSize: '11px',
            }}>
              {isLast ? <Loader2 size={10} className="spin" /> : <Check size={10} />}
              <span style={{ color: toolMeta.color }}>{toolMeta.icon}</span>
              <span>{toolMeta.label}</span>
              {filePath && <code style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>{filePath}</code>}
              {command && <code style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{command}</code>}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** Activity summary card shown during/after agent runs */
const ActivitySummary = memo(function ActivitySummary({ task }: { task: AgentTask }) {
  // Deduplicate and filter empty/falsy entries
  const created = [...new Set(task.filesCreated)].filter(f => f && f.trim());
  const modified = [...new Set(task.filesModified)].filter(f => f && f.trim());
  const commands = task.commandsRun.filter(c => c && c.trim());
  if (!task || (created.length === 0 && modified.length === 0 && commands.length === 0)) return null;
  return (
    <div className="agent-card" style={{ borderLeft: '3px solid var(--accent-primary)' }}>
      <div className="agent-card-header" style={{ color: 'var(--accent-primary)' }}>
        <Zap size={14} /> <strong>Activity</strong>
      </div>
      <div className="agent-card-body" style={{ fontSize: '12px' }}>
        {created.length > 0 && (
          <div style={{ marginBottom: '6px' }}>
            <strong style={{ color: 'var(--color-success)' }}>Created:</strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0, listStyle: 'disc' }}>
              {created.map((f, i) => (
                <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {f.split(/[\\/]/).pop()}
                </li>
              ))}
            </ul>
          </div>
        )}
        {modified.length > 0 && (
          <div style={{ marginBottom: '6px' }}>
            <strong style={{ color: 'var(--color-warning)' }}>Modified:</strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0, listStyle: 'disc' }}>
              {modified.map((f, i) => (
                <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {f.split(/[\\/]/).pop()}
                </li>
              ))}
            </ul>
          </div>
        )}
        {commands.length > 0 && (
          <div>
            <strong style={{ color: 'var(--accent-secondary)' }}>Commands:</strong>{' '}
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{commands.length} executed</span>
          </div>
        )}
      </div>
    </div>
  );
});

// ════════════════════════════════════════════
//  Isolated Input Component (prevents re-render of message list)
// ════════════════════════════════════════════

// Persistent draft store — survives tab switches
const inputDraftStore: Record<string, string> = {};
const DRAFT_KEY = '__agent_input_draft__';

const AgentInput = memo(function AgentInput({
  isAgentRunning,
  onSend,
}: {
  isAgentRunning: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState(() => inputDraftStore[DRAFT_KEY] || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Persist draft on every change
  useEffect(() => { inputDraftStore[DRAFT_KEY] = text; }, [text]);

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !isAgentRunning) {
        onSend(text);
        setText('');
        inputDraftStore[DRAFT_KEY] = '';
      }
    }
  }, [text, isAgentRunning, onSend]);

  const handleSend = useCallback(() => {
    if (!isAgentRunning && text.trim()) {
      onSend(text);
      setText('');
      inputDraftStore[DRAFT_KEY] = '';
    }
  }, [text, isAgentRunning, onSend]);

  return (
    <div className="aw-input-area">
      <div className="aw-input-box" style={{ opacity: isAgentRunning ? 0.6 : 1 }}>
        <textarea
          ref={textareaRef}
          placeholder={isAgentRunning ? "Wait for agent to finish or pause..." : "Tell the agent what to build or fix..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isAgentRunning}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={isAgentRunning || !text.trim()}
          style={{
            background: text.trim() && !isAgentRunning ? '#0092D1' : 'transparent',
            color: text.trim() && !isAgentRunning ? 'white' : 'var(--text-disabled)',
            border: 'none', borderRadius: '50%', width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Send size={16} style={{ marginLeft: 2 }} />
        </button>
      </div>
    </div>
  );
});

// ════════════════════════════════════════════
//  Memoized Message Bubble
// ════════════════════════════════════════════

const MessageBubble = memo(function MessageBubble({ msg }: { msg: ChatMessage }) {
  // Skip rendering internal noise messages
  if (msg.role === 'assistant' && isInternalNoise(msg.content)) return null;

  const displayContent = msg.role === 'assistant' ? cleanMessageContent(msg.content) : msg.content;
  if (!displayContent.trim()) return null;

  return (
    <div className={`aw-message ${msg.role}`}>
      {msg.role === 'assistant' && (
        <div style={{ width: 28, height: 28, borderRadius: 14, background: '#0092D1', padding: 4, flexShrink: 0, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Compass size={18} />
        </div>
      )}
      <div className="aw-bubble">
        {msg.role === 'assistant' ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        ) : (
          displayContent
        )}
      </div>
    </div>
  );
});

// ════════════════════════════════════════════
//  Main Component
// ════════════════════════════════════════════

export function AgentWorkspace({
  isOpen, messages, task, isAgentRunning, isStreaming, onSend, onClear, onRunCommand, onResumeTask
}: AgentWorkspaceProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll only when new messages or steps arrive — not on every render
  const prevLenRef = useRef(0);
  useEffect(() => {
    const currentLen = messages.length + (task?.steps?.length || 0);
    if (currentLen > prevLenRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLenRef.current = currentLen;
  }, [messages.length, task?.steps?.length]);

  // Memoized timeline cards from task steps
  const timelineCards = useMemo(() => {
    if (!task?.steps) return [];
    const cards: any[] = [];
    let lastPlanCardIdx = -1;
    task.steps.forEach(step => {
      if (step.type === 'approval_required') {
        try {
          const detail = JSON.parse(step.content);
          if (detail.type === 'plan') {
            // Only keep the last plan card (avoid duplicates from stage_complete + run_paused)
            if (lastPlanCardIdx >= 0) {
              cards.splice(lastPlanCardIdx, 1);
              lastPlanCardIdx = cards.length;
            } else {
              lastPlanCardIdx = cards.length;
            }
            cards.push({ kind: 'plan_card', payload: detail.payload, ts: step.timestamp });
          } else if (detail.type === 'decision') {
            cards.push({ kind: 'decision_card', payload: detail.payload, ts: step.timestamp });
          }
        } catch { /* ignore */ }
      } else if (step.type === 'tool_call' && step.toolName === 'task_complete' && step.toolArgs) {
        cards.push({ kind: 'result_card', payload: step.toolArgs, ts: step.timestamp });
      }
    });
    return cards;
  }, [task?.steps]);

  // Stable callback for send
  const handleSend = useCallback((text: string) => {
    onSend(text);
  }, [onSend]);

  // Determine current stage label for the thinking indicator
  const activeStageLabel = task?.activeStage ? STAGE_META[task.activeStage]?.label || task.activeStage : null;
  const activeStageColor = task?.activeStage ? STAGE_META[task.activeStage]?.color || '#0092D1' : '#0092D1';
  const activeStageIcon = task?.activeStage ? STAGE_META[task.activeStage]?.icon : null;

  // Derive plan card status from task state
  const planCardStatus: 'paused' | 'executing' | 'complete' | 'error' = 
    (task?.status === 'executing' || isAgentRunning) ? 'executing' :
    task?.status === 'error' ? 'error' :
    task?.status === 'complete' ? 'complete' :
    'paused';

  if (!isOpen) return null;

  return (
    <div className="agent-workspace">
      {/* Header with Pipeline */}
      <div className="aw-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Compass size={16} color="#0092D1" />
          <span style={{ fontWeight: 600, fontSize: '13px' }}>OrbitCode Agent</span>
          {isAgentRunning && activeStageLabel && (
            <span style={{
              fontSize: '10px', padding: '2px 10px', borderRadius: '10px',
              background: activeStageColor + '22', color: activeStageColor,
              border: `1px solid ${activeStageColor}44`, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <Loader2 size={10} className="spin" /> {activeStageLabel}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {task && task.stageResults && (
            <div className="aw-pipeline">
              {task.stageResults.map((st, i) => {
                const m = STAGE_META[st.stage] || { icon: <Check size={14} />, label: st.stage, color: '#aaa' };
                const isActive = task.activeStage === st.stage;
                const isComplete = st.status === 'complete';
                const isFailed = st.status === 'failed';
                return (
                  <div key={i} className="aw-stage-pill" style={{
                    background: isActive ? m.color + '22' : isComplete ? m.color + '11' : 'transparent',
                    color: isActive ? m.color : isComplete ? m.color : isFailed ? 'var(--color-error)' : 'var(--text-disabled)',
                    border: isActive ? `1px solid ${m.color}66` : 'none',
                  }}>
                    {isActive ? <Loader2 size={12} className="spin" /> : isComplete ? <Check size={12} /> : isFailed ? <X size={12} /> : m.icon} {m.label}
                  </div>
                );
              })}
            </div>
          )}
          <button
            onClick={onClear}
            title="Clear conversation"
            style={{
              background: 'none', border: 'none', color: 'var(--text-disabled)',
              cursor: 'pointer', padding: '4px', borderRadius: '4px',
              display: 'flex', alignItems: 'center',
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="aw-body" ref={bodyRef}>
        {/* Messages — each independently memoized */}
        {messages.map((msg, idx) => (
          <MessageBubble key={msg.id || idx} msg={msg} />
        ))}

        {/* Empty-state guidance for fresh projects */}
        {messages.length === 0 && !task && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            flex: 1, minHeight: '200px', color: 'var(--text-disabled)', textAlign: 'center', padding: '24px'
          }}>
            <Compass size={32} color="var(--accent-primary)" style={{ opacity: 0.4, marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Ready to work on this project
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: '8px',
              width: 'min(680px, 100%)',
              marginBottom: '16px',
            }}>
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="agent-btn secondary"
                  onClick={() => handleSend(prompt)}
                  style={{
                    justifyContent: 'flex-start',
                    whiteSpace: 'normal',
                    textAlign: 'left',
                    lineHeight: 1.35,
                    padding: '10px 12px',
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '12px', maxWidth: '380px', lineHeight: '1.6' }}>
              Tell the agent what to build, fix, or explore. Examples:<br />
              <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                &quot;Create a Python Flask API with a /health endpoint&quot;<br />
                &quot;Fix the bug in index.html — the form doesn&apos;t submit&quot;<br />
                &quot;Set up this project for deployment to Cloud Run&quot;
              </span>
            </div>
          </div>
        )}

        {/* Interactive Cards from task stream */}
        {timelineCards.map((item, idx) => (
          <React.Fragment key={`card-${idx}`}>
            {item.kind === 'plan_card' && (
              <PlanCard
                payload={item.payload}
                taskStatus={planCardStatus}
                onApprove={() => {
                  if (task) onResumeTask(task.id, 'resume');
                }}
                onEdit={() => {
                  // Focus the input and prompt the user to describe revisions
                  const textarea = document.querySelector('.aw-input-box textarea') as HTMLTextAreaElement;
                  if (textarea) {
                    textarea.value = 'Please revise the plan: ';
                    textarea.focus();
                    // Trigger React state update
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                }}
              />
            )}
            {item.kind === 'decision_card' && (
              <DecisionCard
                payload={item.payload}
                onSelect={(opt) => {
                  if (task?.checkpointState) {
                    onResumeTask(task.id, `decision:${opt}`);
                  } else {
                    handleSend(`For the decision "${item.payload?.title || 'Decision'}", I choose: ${opt}`);
                  }
                }}
              />
            )}
            {item.kind === 'result_card' && (
              <ResultCard payload={item.payload} task={task} />
            )}
          </React.Fragment>
        ))}

        {/* Live activity feed — shows in real-time what the agent is doing */}
        {isAgentRunning && task && (
          <LiveActivityFeed task={task} />
        )}

        {/* Activity summary for completed tasks */}
        {task && task.status === 'complete' && (
          <ActivitySummary task={task} />
        )}

        {/* Blocker card for paused state */}
        {task?.status === 'paused' && !task.steps.find(s => s.type === 'approval_required') && (
          <div className="agent-card">
            <div className="agent-card-header" style={{ color: 'var(--color-warning)' }}><AlertTriangle size={14} /> <strong>Paused</strong></div>
            <div className="agent-card-body"><p style={{ fontSize: '13px' }}>Execution paused. The agent requires your input to proceed.</p></div>
            <div className="agent-card-actions">
              <button className="agent-btn primary" onClick={() => onResumeTask(task.id, 'resume')}>Force Resume</button>
              <button className="agent-btn secondary" onClick={() => onResumeTask(task.id, 'abort')}>Abort</button>
            </div>
          </div>
        )}

        {/* Enhanced thinking indicator with stage info */}
        {isAgentRunning && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '12px 16px', fontSize: '12px',
            background: 'var(--bg-secondary)', borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: activeStageColor }}>
              <Loader2 size={14} className="spin" />
              {activeStageIcon}
            </div>
            <span style={{ color: 'var(--text-secondary)' }}>
              {activeStageLabel 
                ? <>Agent is <strong style={{ color: activeStageColor }}>{activeStageLabel.toLowerCase()}ing</strong> — {getStageDescription(task?.activeStage || '')}</>
                : 'Agent is working...'
              }
            </span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Paused attention bar — only when truly paused and not running */}
      {task?.status === 'paused' && !isAgentRunning && (
        <div style={{ padding: '10px 16px', background: 'linear-gradient(90deg, #ffcc00, #ffa500)', color: '#000', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <AlertTriangle size={14} /> Your approval is needed — review the plan above and click &quot;Approve &amp; Continue&quot;
        </div>
      )}

      {/* Isolated input — never re-renders message list */}
      <AgentInput isAgentRunning={isAgentRunning} onSend={handleSend} />
    </div>
  );
}

/** Human-friendly description of what a stage does */
function getStageDescription(stage: string): string {
  const descriptions: Record<string, string> = {
    intent: 'understanding your request',
    scout: 'exploring project files and structure',
    toolStrategy: 'planning which tools to use',
    plan: 'creating the implementation plan',
    diagnose: 'investigating the issue',
    audit: 'auditing the codebase',
    implement: 'writing and modifying code',
    build: 'testing the implementation',
    browserQa: 'testing in the browser',
    critic: 'reviewing code quality',
    repair: 'fixing identified issues',
    release: 'finalizing the deliverables',
    gitSync: 'committing and pushing to Git',
    gcpDeploy: 'deploying to Google Cloud',
  };
  return descriptions[stage] || 'processing...';
}
