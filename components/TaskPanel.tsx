'use client';

import React, { useRef, useEffect, useState } from 'react';
import {
  CheckCircle, Circle, AlertTriangle, Loader2, FileText, Terminal,
  Search, Trash2, Edit, Eye, FolderOpen, Zap, Shield, XCircle, ChevronDown, Monitor,
  Target, Compass, ClipboardList, Code2, Hammer, SearchCheck, Wrench, Package, GitMerge, CloudUpload,
  Stethoscope, Globe
} from 'lucide-react';
import { AgentTask, AgentStep, AgentTaskStatus, OrchestratorStageResult, OrchestratorStageName } from '@/lib/types';

interface TaskPanelProps {
  task: AgentTask | null;
  isRunning: boolean;
  onResume?: (taskId: string, action: string) => void;
}

// ════════════════════════════════════════════
//  Stage Pipeline Visualization
// ════════════════════════════════════════════

const STAGE_META: Record<OrchestratorStageName, { icon: React.ReactNode; label: string; color: string }> = {
  intent:       { icon: <Target size={11} />,        label: 'Intent',     color: '#4EC3E0' },
  scout:        { icon: <Compass size={11} />,       label: 'Scout',      color: '#00A997' },
  toolStrategy: { icon: <Wrench size={11} />,        label: 'Strategy',   color: '#0092D1' },
  plan:         { icon: <ClipboardList size={11} />, label: 'Plan',       color: '#7C3AED' },
  diagnose:     { icon: <Stethoscope size={11} />,   label: 'Diagnosis',  color: '#F97316' },
  audit:        { icon: <SearchCheck size={11} />,   label: 'Audit',      color: '#14B8A6' },
  implement:    { icon: <Code2 size={11} />,         label: 'Build',      color: '#E85C0E' },
  build:        { icon: <Hammer size={11} />,        label: 'Test',       color: '#FFCB38' },
  browserQa:    { icon: <SearchCheck size={11} />,   label: 'Browser',    color: '#3B82F6' },
  critic:       { icon: <SearchCheck size={11} />,   label: 'Review',     color: '#EC4899' },
  repair:       { icon: <Wrench size={11} />,        label: 'Repair',     color: '#EF4444' },
  release:      { icon: <Package size={11} />,       label: 'Release',    color: '#10B981' },
  gitSync:      { icon: <GitMerge size={11} />,      label: 'Git Sync',   color: '#F472B6' },
  gcpDeploy:    { icon: <CloudUpload size={11} />,   label: 'Deploy',     color: '#3B82F6' },
};

function StagePipeline({ stageResults, activeStage, complexity }: {
  stageResults: OrchestratorStageResult[];
  activeStage?: string;
  complexity?: string;
}) {
  if (!stageResults || stageResults.length === 0) return null;

  // Collect all stages that were selected (from results)
  const stageNames = stageResults.map(s => s.stage);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '8px 10px',
      background: 'var(--bg-tertiary)',
      borderRadius: 'var(--radius-sm)',
      marginBottom: '4px',
    }}>
      {/* Complexity badge */}
      {complexity && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '2px',
        }}>
          <span style={{
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-disabled)',
          }}>Pipeline</span>
          <span style={{
            fontSize: '9px',
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: '8px',
            background: complexity === 'complex' ? 'rgba(232, 92, 14, 0.15)' :
                        complexity === 'moderate' ? 'rgba(0, 146, 209, 0.15)' :
                        'rgba(103, 173, 86, 0.15)',
            color: complexity === 'complex' ? '#E85C0E' :
                   complexity === 'moderate' ? '#0092D1' :
                   '#67AD56',
          }}>
            {complexity}
          </span>
        </div>
      )}

      {/* Stage pills */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        flexWrap: 'wrap',
      }}>
        {stageNames.map((name, idx) => {
          const meta = STAGE_META[name];
          const result = stageResults.find(s => s.stage === name);
          if (!meta || !result) return null;

          const isActive = result.status === 'active' || name === activeStage;
          const isComplete = result.status === 'complete';
          const isFailed = result.status === 'failed';
          const isPaused = result.status === 'paused';

          const pillColor = isActive ? meta.color :
                           isComplete ? 'var(--color-success)' :
                           isFailed ? 'var(--color-error)' :
                           isPaused ? 'var(--color-warning)' :
                           'var(--text-disabled)';

          return (
            <React.Fragment key={name}>
              {idx > 0 && (
                <span style={{
                  color: isComplete ? 'var(--color-success)' : 'var(--border-default)',
                  fontSize: '8px',
                  lineHeight: 1,
                }}>›</span>
              )}
              <span
                title={`${meta.label}: ${result.status}${result.turnCount > 0 ? ` (${result.turnCount} turns)` : ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '9px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '10px',
                  color: pillColor,
                  background: `color-mix(in srgb, ${pillColor} 12%, transparent)`,
                  border: isActive ? `1px solid color-mix(in srgb, ${pillColor} 40%, transparent)` : '1px solid transparent',
                  transition: 'all 0.2s ease',
                }}
              >
                {isActive && <Loader2 size={8} className="spin" />}
                {isComplete && <CheckCircle size={8} />}
                {isFailed && <XCircle size={8} />}
                {!isActive && !isComplete && !isFailed && meta.icon}
                {meta.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
//  Tool Icons
// ════════════════════════════════════════════

function getToolIcon(toolName?: string) {
  switch (toolName) {
    case 'create_file': return <FileText size={12} style={{ color: 'var(--color-success)' }} />;
    case 'edit_file': return <Edit size={12} style={{ color: 'var(--color-warning)' }} />;
    case 'read_file': return <Eye size={12} style={{ color: 'var(--color-info)' }} />;
    case 'delete_file': return <Trash2 size={12} style={{ color: 'var(--color-error)' }} />;
    case 'run_command': return <Terminal size={12} style={{ color: 'var(--accent-secondary)' }} />;
    case 'list_files': return <FolderOpen size={12} style={{ color: '#fbbf24' }} />;
    case 'search_files': return <Search size={12} style={{ color: 'var(--color-info)' }} />;
    default: return <Circle size={12} style={{ color: 'var(--text-tertiary)' }} />;
  }
}

// Status badge
function StatusBadge({ status }: { status: AgentTaskStatus }) {
  const config: Record<AgentTaskStatus, { color: string; icon: React.ReactNode; label: string }> = {
    idle: { color: 'var(--text-disabled)', icon: <Circle size={10} />, label: 'Idle' },
    planning: { color: 'var(--color-info)', icon: <Loader2 size={10} className="spin" />, label: 'Planning' },
    executing: { color: 'var(--accent-secondary)', icon: <Loader2 size={10} className="spin" />, label: 'Executing' },
    verifying: { color: 'var(--color-warning)', icon: <Loader2 size={10} className="spin" />, label: 'Verifying' },
    complete: { color: 'var(--color-success)', icon: <CheckCircle size={10} />, label: 'Complete' },
    paused: { color: 'var(--color-warning)', icon: <AlertTriangle size={10} />, label: 'Paused' },
    error: { color: 'var(--color-error)', icon: <XCircle size={10} />, label: 'Error' },
    approval_required: { color: 'var(--color-warning)', icon: <Shield size={10} />, label: 'Approval Required' },
  };

  const c = config[status] || config.idle;

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '10px',
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: '12px',
      color: c.color,
      background: `color-mix(in srgb, ${c.color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${c.color} 25%, transparent)`,
    }}>
      {c.icon}
      {c.label}
    </span>
  );
}

// Step row
function StepRow({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  const [expanded, setExpanded] = React.useState(false);

  // Determine styling based on step type
  const getStepStyle = () => {
    switch (step.type) {
      case 'thinking':
        return { color: 'var(--text-tertiary)', fontStyle: 'italic' as const };
      case 'text':
        return { color: 'var(--text-primary)' };
      case 'tool_call':
        return { color: 'var(--accent-secondary)', fontWeight: 600 };
      case 'tool_result':
        return { color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '11px' };
      case 'error':
        return { color: 'var(--color-error)' };
      case 'complete':
        return { color: 'var(--color-success)', fontWeight: 600 };
      case 'approval_required':
        return { color: 'var(--color-warning)' };
      default:
        return {};
    }
  };

  const hasDetail = step.toolArgs || (step.content && step.content.length > 80);
  const shortContent = step.content.length > 80 ? step.content.substring(0, 80) + '...' : step.content;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      padding: '4px 0',
      borderLeft: isLast ? 'none' : '1px solid var(--border-subtle)',
      marginLeft: '6px',
      paddingLeft: '12px',
      position: 'relative',
    }}>
      {/* Timeline dot */}
      <div style={{
        position: 'absolute',
        left: '-4px',
        top: '7px',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: step.type === 'complete' ? 'var(--color-success)' :
                    step.type === 'error' ? 'var(--color-error)' :
                    step.type === 'tool_call' ? 'var(--accent-secondary)' :
                    'var(--text-disabled)',
        border: '1px solid var(--bg-primary)',
      }} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: hasDetail ? 'pointer' : 'default',
          ...getStepStyle(),
        }}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {step.toolName === 'browser_screenshot' ? <Monitor size={12} color="var(--accent-secondary)" /> : 
         step.toolName === 'browser_step' ? <Globe size={12} color="#4EC3E0" /> :
         step.toolName === 'browser_session' ? <Globe size={12} color="#4EC3E0" /> :
         step.toolName ? getToolIcon(step.toolName) : null}
        <span style={{ fontSize: '11px', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {step.toolName === 'browser_screenshot' ? '[Browser Screenshot Captured]' : 
           step.toolName === 'browser_step' ? (() => {
             try {
               const data = JSON.parse(step.content);
               return `🌐 ${data.step?.action || 'action'}: ${data.step?.description || ''}`;
             } catch { return step.content.length > 80 ? step.content.substring(0, 80) + '...' : step.content; }
           })() :
           step.toolName === 'browser_session' ? (() => {
             try {
               const data = JSON.parse(step.content);
               return `Browser ${data.status} ${data.stepCount ? `(${data.stepCount} steps)` : ''}`;
             } catch { return shortContent; }
           })() :
           shortContent}
        </span>
        {hasDetail && (
          <ChevronDown
            size={10}
            style={{
              marginLeft: 'auto',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
              opacity: 0.4,
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-tertiary)',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 8px',
          maxHeight: '200px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          marginTop: '2px',
        }}>
          {step.toolArgs && (
            <div style={{ marginBottom: '4px', color: 'var(--text-secondary)' }}>
              Args: {JSON.stringify(step.toolArgs, null, 2).substring(0, 500)}
            </div>
          )}
          {step.toolName === 'browser_screenshot' ? (
             <img src={step.content} style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--border-subtle)' }} alt="Browser Step" />
          ) : step.toolName === 'browser_step' ? (() => {
             try {
               const data = JSON.parse(step.content);
               return (
                 <div>
                   <div style={{ marginBottom: '4px' }}>
                     <strong>Action:</strong> {data.step?.action} — {data.step?.description}
                   </div>
                   <div style={{ marginBottom: '4px' }}>
                     <strong>URL:</strong> {data.currentUrl}
                   </div>
                   {data.step?.screenshot && (
                     <img src={data.step.screenshot} style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--border-subtle)', marginTop: '4px' }} alt="Browser step" />
                   )}
                 </div>
               );
             } catch {
               return step.content.length > 80 && step.content;
             }
          })() : (
            step.content.length > 80 && step.content
          )}
          {step.toolResult && (
            <div style={{ marginTop: '4px', borderTop: '1px solid var(--border-subtle)', paddingTop: '4px' }}>
              Result: {step.toolResult.substring(0, 500)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export default function TaskPanel({ task, isRunning, onResume }: TaskPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const taskId = task?.id;
  const taskCompletedAt = task?.completedAt;

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task?.steps?.length]);

  useEffect(() => {
    if (!taskId || taskCompletedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [taskId, taskCompletedAt]);

  if (!task) {
    return (
      <div className="task-panel">
        <div className="task-panel__header">
          <div className="task-panel__title">
            <Zap size={13} style={{ color: 'var(--accent-primary)' }} />
            Agent
          </div>
        </div>
        <div className="empty-state" style={{ padding: '24px', flex: 1 }}>
          <Zap size={22} className="empty-state__icon" />
          <span className="empty-state__text" style={{ fontSize: '11px' }}>
            Switch to Agent mode to see<br />autonomous task execution here
          </span>
        </div>
      </div>
    );
  }

  const elapsed = task.completedAt
    ? ((task.completedAt - task.startedAt) / 1000).toFixed(1)
    : (Math.max(0, now - task.startedAt) / 1000).toFixed(0);

  return (
    <div className="task-panel">
      {/* Header */}
      <div className="task-panel__header">
        <div className="task-panel__title">
          <Zap size={13} style={{ color: 'var(--accent-primary)' }} />
          {task.orchestrated ? 'Orchestrator' : 'Agent Task'}
        </div>
        <StatusBadge status={task.status} />
      </div>

      {/* Orchestration Stage Pipeline */}
      {task.orchestrated && task.stageResults && (
        <StagePipeline
          stageResults={task.stageResults}
          activeStage={task.activeStage}
          complexity={task.complexity}
        />
      )}

      {/* Intent */}
      <div className="task-panel__intent">
        <span style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 500 }}>
          {task.intent.length > 120 ? task.intent.substring(0, 120) + '...' : task.intent}
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
          {elapsed}s • {task.steps.length} steps
          {task.orchestrated && task.stageResults ? ` • ${task.stageResults.filter(s => s.status === 'complete').length}/${task.stageResults.length} stages` : ''}
        </span>
      </div>

      {/* Steps timeline */}
      <div className="task-panel__steps" ref={scrollRef}>
        {task.steps.map((step, idx) => (
          <StepRow key={step.id} step={step} isLast={idx === task.steps.length - 1} />
        ))}
        {isRunning && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 0 6px 18px',
            fontSize: '11px',
            color: 'var(--accent-secondary)',
          }}>
            <Loader2 size={11} className="spin" />
            {task.activeStage ? `${STAGE_META[task.activeStage as OrchestratorStageName]?.label || task.activeStage} working...` : 'Agent working...'}
          </div>
        )}
      </div>

      {/* Summary footer */}
      {task.status === 'complete' && task.summary && (
        <div className="task-panel__summary">
          <CheckCircle size={11} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
          <span style={{ fontSize: '11px' }}>{task.summary.substring(0, 200)}</span>
        </div>
      )}

      {/* Stats */}
      {(task.filesCreated.length > 0 || task.filesModified.length > 0 || task.commandsRun.length > 0) && (
        <div className="task-panel__stats">
          {task.filesCreated.length > 0 && (
            <span style={{ color: 'var(--color-success)', fontSize: '10px' }}>
              +{task.filesCreated.length} created
            </span>
          )}
          {task.filesModified.length > 0 && (
            <span style={{ color: 'var(--color-warning)', fontSize: '10px' }}>
              ~{task.filesModified.length} modified
            </span>
          )}
          {task.commandsRun.length > 0 && (
            <span style={{ color: 'var(--accent-secondary)', fontSize: '10px' }}>
              ⚡{task.commandsRun.length} commands
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {task.error && task.status !== 'paused' && (
        <div className="task-panel__error">
          <AlertTriangle size={11} />
          <span>{task.error.substring(0, 200)}</span>
        </div>
      )}

      {/* Checkpoint / Pause Card */}
      {task.status === 'paused' && task.checkpointState && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-warning)', fontWeight: 600, fontSize: '12px' }}>
            <AlertTriangle size={14} />
            Execution Paused: {
              task.checkpointState.reason === 'stagnation' ? 'Stagnation Detected' :
              task.checkpointState.reason === 'approval_required' ? 'Plan Approval Required' :
              'Stage Budget Exhausted'
            }
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
            {task.checkpointState.reason === 'approval_required'
              ? <>Review the implementation plan above and click <strong>Approve &amp; Continue</strong> to proceed.</>
              : <>OrbitCode has halted execution to prevent unnecessary loops or cost runaway.
                <br/><strong>Detail:</strong> {task.checkpointState.reason === 'stagnation' ? 'Repeated identical failures.' : 'Task taking longer than expected.'}</>
            }
          </p>

          {(task.checkpointState.completedActions?.length > 0 || task.filesCreated.length > 0) && (
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              <div style={{ fontWeight: 600, marginBottom: '2px', color: 'var(--text-primary)' }}>What was completed:</div>
              <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-secondary)', listStyleType: 'circle' }}>
                {task.filesCreated.slice(0, 3).map(f => <li key={f}>Created {f}</li>)}
                {task.filesModified.slice(0, 3).map(f => <li key={f}>Modified {f}</li>)}
                {task.checkpointState.completedActions?.slice(0, 3).map((a, i) => <li key={i}>{a}</li>)}
                {(task.filesCreated.length > 3 || task.filesModified.length > 3) && <li>And more...</li>}
              </ul>
            </div>
          )}

          <div style={{
            display: 'flex',
            gap: '8px',
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)'
          }}>
            <button
              onClick={() => onResume && onResume(task.id, task.checkpointState!.recommendedAction)}
              style={{
                flex: 1,
                background: 'var(--color-warning)',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {task.checkpointState.recommendedAction === 'repair' ? 'Route to Repair / Critic' : 'Resume Execution'}
            </button>
            <button
              onClick={() => onResume && onResume(task.id, 'abort')}
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
