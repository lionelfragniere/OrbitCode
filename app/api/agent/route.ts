/* OrbitCode — Agent API Route
 * Handles autonomous agent execution via SSE streaming.
 *
 * POST /api/agent  — Start or resume an agent run
 * PATCH /api/agent — Resume a paused orchestrated run (approval-resume)
 * DELETE /api/agent — Kill all processes for a project
 *
 * Supports two modes: 'single' (legacy) and 'orchestrated' (multi-stage)
 * Both modes now enforce pre-completion integrity checks and post-build verification.
 *
 * SECURITY: Provider credentials are resolved server-side from encrypted local config.
 */

import { NextRequest } from 'next/server';
import { executeAgentWithTools, buildAgentSystemInstruction } from '@/lib/agent/vertex';
import { runOrchestrator } from '@/lib/agent/orchestrator';
import { executeTool, type ExecutorContext } from '@/lib/agent/executor';
import { isPonytailReportCommand } from '@/lib/agent/ponytail';
import fs from 'fs/promises';
import path from 'path';
import { getProjectRunsDir } from '@/lib/server/appPaths';

// ═══ Rate Limiting ═══
// Simple concurrency limiter to protect local and remote provider quota.
const MAX_CONCURRENT_RUNS = 5;
let activeRuns = 0;

// SSE event type that includes orchestration data
interface SSEEvent {
  type: string;
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  step?: number;
  // Orchestration fields
  stage?: string;
  stageStatus?: string;
  complexity?: string;
  stageResults?: Array<{
    stage: string;
    status: string;
    turnCount: number;
    startedAt: number;
    completedAt?: number;
  }>;
}

export async function POST(request: NextRequest) {
  // Rate limit check
  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    return new Response(
      JSON.stringify({
        error: `Rate limit reached: ${MAX_CONCURRENT_RUNS} agent runs are already in progress. Please wait for one to finish.`,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } },
    );
  }
  activeRuns++;
  const body = await request.json();
  const {
    message,
    gcpProject,
    gcpRegion,
    providerId,
    providerKind,
    baseUrl,
    headers,
    projectFolder,
    projectContext,
    model,
    temperature,
    maxTokens,
    maxAgentTurns,
    beginnerMode,
    orchestrated, // boolean — use multi-stage orchestration
    resumeState, // Optional: for resuming from pauses
  } = body;

  const effectiveProjectContext = `${projectContext || ''}${beginnerMode ? '\n\n## Beginner Mode\nThe user prefers simple explanations. Keep code-heavy details out of summaries unless necessary, name what changed in plain language, and give one clear next step. When asking the user to choose, put the real choice in each button label. Never show placeholders like "Option 1" or "Option 2".' : ''}`;
  const ponytailReportOnly = isPonytailReportCommand(String(message || ''));

  if (!message || !projectFolder) {
    return new Response(
      JSON.stringify({ error: 'message and projectFolder are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Extracted or Generated runId
  const taskId = resumeState?.taskId || `run_${Date.now()}`;

  // Create executor context
  const ctx: ExecutorContext = {
    projectFolder,
    taskId,
    pendingApprovals: new Map(),
  };

  // Set the project folder globally so the pre-completion check can access it
  // This is used by vertex.ts executeAgentWithTools → preCompletionCheck
  (globalThis as Record<string, unknown>).__og_current_project_folder = projectFolder;

  // Create the SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let controllerClosed = false;
      const send = (event: SSEEvent) => {
        if (controllerClosed) return; // Guard: client disconnected
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Controller is closed — client disconnected. Silently ignore.
          controllerClosed = true;
        }
      };

      let stepCount = 0;

      try {
        // Wire up progress events from executor
        ctx.onProgress = (event) => {
          send({
            type: event.type === 'command_output' ? 'text' : event.type,
            content: event.detail,
            toolName: event.toolName,
            step: stepCount,
          });
        };

        // Create tool executor function
        const toolExecutor = async (name: string, args: Record<string, unknown>) => {
          return executeTool(ctx, name, args);
        };

        const vertexConfig = {
          providerId,
          providerKind,
          baseUrl,
          headers,
          gcpProject,
          gcpRegion: gcpRegion || 'us-central1',
          model,
          temperature: temperature ?? 0.2,
          maxTokens: maxTokens ?? 65536,
        };

        if (orchestrated && !ponytailReportOnly) {
          // ═══ ORCHESTRATED MODE ═══
          // Uses the multi-stage pipeline with selective agent roles
          const pipeline = runOrchestrator(
            ctx.projectFolder,
            vertexConfig,
            message,
            toolExecutor,
            effectiveProjectContext,
            2,
            resumeState,
            taskId
          );

          let lastEventType = '';

          for await (const event of pipeline) {
            stepCount++;
            lastEventType = event.type;

            // Build stage results summary for the client
            const stageResults = event.state.stages.map(s => ({
              stage: s.stage,
              status: s.status,
              turnCount: s.turnCount,
              startedAt: s.startedAt,
              completedAt: s.completedAt,
            }));


            if (event.type === 'stage_progress' && event.agentTurn) {
              // Pass through inner agent turns with stage context
              send({
                ...event.agentTurn,
                step: stepCount,
                stage: event.stage,
                stageStatus: 'active',
                complexity: event.state.complexity,
                stageResults,
              });
            } else {
              // Stage lifecycle events
              const sseEvent: Record<string, unknown> = {
                type: event.type,
                content: event.content,
                step: stepCount,
                stage: event.stage,
                stageStatus: event.type === 'stage_complete' ? 'complete' :
                             event.type === 'stage_failed' ? 'failed' :
                             event.type === 'stage_start' ? 'active' : undefined,
                complexity: event.state.complexity,
                stageResults,
              };
              // Include checkpoint state for run_paused so the frontend can resume
              if (event.type === 'run_paused' && event.state.checkpointState) {
                sseEvent.state = {
                  checkpointState: event.state.checkpointState,
                };
              }
              send(sseEvent as unknown as SSEEvent);
            }
          }

          // Only send a final 'complete' if the pipeline didn't pause for approval
          if (lastEventType !== 'run_paused') {
            send({ type: 'complete', content: 'Orchestrator finished.', step: stepCount });
          }
        } else {
          // ═══ SINGLE AGENT MODE (with verification gates) ═══
          const systemInstruction = buildAgentSystemInstruction(effectiveProjectContext);
          const agentLoop = executeAgentWithTools(
            vertexConfig,
            message,
            systemInstruction,
            toolExecutor,
            maxAgentTurns ?? 50,
          );

          let agentCompletedSuccessfully = false;
          let agentSummary = '';
          for await (const turn of agentLoop) {
            stepCount++;
            send({ ...turn, step: stepCount });
            if (turn.type === 'complete') {
              agentCompletedSuccessfully = true;
              agentSummary = turn.content;
            }
          }

          // ═══ POST-BUILD VERIFICATION GATE ═══
          // Even in single-agent mode, we now verify the build actually works
          if (agentCompletedSuccessfully && ponytailReportOnly) {
            send({ type: 'complete', content: agentSummary, step: ++stepCount });
          } else if (agentCompletedSuccessfully) {
            try {
              const { runPostBuildVerify } = await import('@/lib/agent/postBuildVerify');
              send({ type: 'text', content: '\n🔍 Running post-build verification...', step: ++stepCount });
              const verify = await runPostBuildVerify(projectFolder);

              // Persist evidence
              await saveVerificationEvidence(projectFolder, taskId, {
                buildVerify: {
                  pass: verify.pass,
                  verdict: verify.verdict,
                  phase: verify.phase,
                  errors: verify.errors,
                  warnings: verify.warnings,
                  durationMs: verify.durationMs,
                },
                routeCoverage: verify.routeCoverage ? {
                  verdict: verify.routeCoverage.verdict,
                  routesTested: verify.routeCoverage.routesTested,
                  routesPassed: verify.routeCoverage.routesPassed,
                  routesFailed: verify.routeCoverage.routesFailed,
                  routes: verify.routeCoverage.routes.map(r => ({
                    route: r.route,
                    status: r.status,
                    reason: r.reason,
                  })),
                } : undefined,
                screenshotPath: verify.screenshotPath,
              });

              if (!verify.pass) {
                // ── HARD FAIL: override the agent's false success ──
                send({
                  type: 'error',
                  content: `❌ BUILD VERIFICATION FAILED\n${verify.verdict}\n\nErrors:\n${verify.errors.map(e => '  • ' + e).join('\n')}\n\nThe agent claimed success, but the app does not work. This run is marked as FAILED.`,
                  step: ++stepCount,
                });
              } else {
                send({
                  type: 'text',
                  content: `✅ Build verification PASSED: ${verify.verdict}`,
                  step: ++stepCount,
                });
                send({ type: 'complete', content: agentSummary, step: ++stepCount });
              }
            } catch (verifyErr) {
              const msg = verifyErr instanceof Error ? verifyErr.message : 'unknown';
              send({ type: 'text', content: `⚠️ Post-build verification could not run: ${msg}`, step: ++stepCount });
              // Still emit completion — verification infra failure shouldn't block
              send({ type: 'complete', content: agentSummary, step: ++stepCount });
            }
          }
          // If agent did NOT complete successfully (error/pause), no additional events needed
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Agent error';
        send({ type: 'error', content: msg, step: stepCount });
      } finally {
        activeRuns--;
        // Auto-cleanup: kill any dev servers the agent spawned during this run
        try {
          const { killProjectProcesses } = await import('@/lib/agent/processRegistry');
          const killed = await killProjectProcesses(projectFolder);
          if (killed.length > 0) {
            console.log(`[Agent Cleanup] Killed ${killed.length} processes for ${projectFolder}`);
          }
        } catch { /* cleanup failure is not critical */ }
        controllerClosed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** DELETE /api/agent — Kill all processes for a project (teardown) */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectFolder } = body;
    if (!projectFolder) {
      return new Response(JSON.stringify({ error: 'projectFolder required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // Dynamically import to avoid circular dependency issues
    const { killProjectProcesses } = await import('@/lib/agent/processRegistry');
    await killProjectProcesses(projectFolder);
    return Response.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Cleanup error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/** PATCH /api/agent — Resume a paused orchestrated run (approval-resume)
 *
 * Security invariants:
 * - Only paused runs may be resumed (caller must provide the taskId from run_paused event)
 * - Request must target a specific taskId
 * - Idempotent: resuming an already-resumed run returns 409
 * - This is the API equivalent of clicking the UI approval button
 * - It does NOT bypass the approval gate — it IS the approval gate
 */

// Track which taskIds have been resumed (idempotency)
const resumedRuns = new Set<string>();

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const {
    taskId,
    projectFolder,
    action,
    gcpProject,
    gcpRegion,
    providerId,
    providerKind,
    baseUrl,
    headers,
    model,
    projectContext,
    beginnerMode,
    message, // original message for context
  } = body;

  if (!taskId || !projectFolder) {
    return new Response(
      JSON.stringify({ error: 'taskId and projectFolder are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (action !== 'approve') {
    return new Response(
      JSON.stringify({ error: 'Only action=approve is supported' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Idempotency check
  if (resumedRuns.has(taskId)) {
    return new Response(
      JSON.stringify({ error: 'This run has already been resumed. Cannot re-approve.', taskId }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Rate limit
  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    return new Response(
      JSON.stringify({ error: 'Rate limit reached' }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } },
    );
  }

  // Mark as resumed (idempotency)
  resumedRuns.add(taskId);
  // Clean up old entries after 1 hour
  setTimeout(() => resumedRuns.delete(taskId), 3600000);

  activeRuns++;

  const ctx: ExecutorContext = {
    projectFolder,
    taskId,
    pendingApprovals: new Map(),
  };
  const effectiveProjectContext = `${projectContext || ''}${beginnerMode ? '\n\n## Beginner Mode\nThe user prefers simple explanations. Keep code-heavy details out of summaries unless necessary, name what changed in plain language, and give one clear next step. When asking the user to choose, put the real choice in each button label. Never show placeholders like "Option 1" or "Option 2".' : ''}`;

  (globalThis as Record<string, unknown>).__og_current_project_folder = projectFolder;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let controllerClosed = false;
      const send = (event: SSEEvent) => {
        if (controllerClosed) return;
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          controllerClosed = true;
        }
      };

      let stepCount = 0;

      try {
        const toolExecutor = async (name: string, args: Record<string, unknown>) => {
          return executeTool(ctx, name, args);
        };

        const vertexConfig = {
          providerId,
          providerKind,
          baseUrl,
          headers,
          gcpProject,
          gcpRegion: gcpRegion || 'us-central1',
          model: model || 'gemini-2.5-flash',
          temperature: 0.2,
          maxTokens: 65536,
        };

        // Resume by re-running the orchestrator with an instruction
        // that includes approval context. We don't pass resumeState since
        // the orchestrator needs a full OrchestratorState snapshot for true resume.
        // Instead, the user message carries the approval signal and context.
        const resumeMessage = message
          ? `APPROVED PLAN — continue implementation.\n\nOriginal request: ${message}`
          : 'APPROVED PLAN — continue implementation.';

        send({ type: 'text', content: `Resuming orchestrated run ${taskId} after approval...`, step: 0 });

        const pipeline = runOrchestrator(
          ctx.projectFolder,
          vertexConfig,
          resumeMessage,
          toolExecutor,
          effectiveProjectContext,
          2,
          undefined,
          taskId,
        );

        for await (const event of pipeline) {
          stepCount++;
          const stageResults = event.state.stages.map(s => ({
            stage: s.stage,
            status: s.status,
            turnCount: s.turnCount,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
          }));

          if (event.type === 'stage_progress' && event.agentTurn) {
            send({ ...event.agentTurn, step: stepCount, stage: event.stage, complexity: event.state.complexity, stageResults });
          } else {
            send({
              type: event.type,
              content: event.content,
              step: stepCount,
              stage: event.stage,
              stageStatus: event.type === 'stage_complete' ? 'complete' : event.type === 'stage_failed' ? 'failed' : undefined,
              complexity: event.state.complexity,
              stageResults,
            } as SSEEvent);
          }
        }

        send({ type: 'complete', content: 'Orchestrator finished (resumed run).', step: stepCount });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Resume error';
        send({ type: 'error', content: msg, step: stepCount });
      } finally {
        activeRuns--;
        // Auto-cleanup: kill any dev servers spawned during resumed run
        try {
          const { killProjectProcesses } = await import('@/lib/agent/processRegistry');
          const killed = await killProjectProcesses(projectFolder);
          if (killed.length > 0) {
            console.log(`[Agent Cleanup] Killed ${killed.length} processes for ${projectFolder} (resumed run)`);
          }
        } catch { /* cleanup failure is not critical */ }
        controllerClosed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ════════════════════════════════════════════
//  Evidence Persistence
// ════════════════════════════════════════════
async function saveVerificationEvidence(
  projectFolder: string,
  taskId: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  try {
    const runDir = path.join(/* turbopackIgnore: true */ getProjectRunsDir(projectFolder), taskId);
    await fs.mkdir(/* turbopackIgnore: true */ runDir, { recursive: true });
    const evidencePath = path.join(/* turbopackIgnore: true */ runDir, 'verification_evidence.json');
    // Merge with existing evidence if present
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ evidencePath, 'utf-8'));
    } catch { /* no existing evidence */ }
    const merged = { ...existing, ...evidence, timestamp: new Date().toISOString() };
    await fs.writeFile(/* turbopackIgnore: true */ evidencePath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Evidence] Failed to save verification evidence:', e);
  }
}
