import * as fs from 'fs/promises';
import * as path from 'path';
/* OrbitCode — Multi-Stage Agent Orchestrator
 *
 * Manages a pipeline of specialist agents that are selectively invoked
 * based on task complexity. Each stage has its own system prompt, turn budget,
 * and produces structured output for the next stage.
 *
 * NOT every task uses all stages — simple tasks skip scouts and critics.
 */

import { executeAgentWithTools, buildAgentSystemInstruction, type AgentTurn, type ToolExecutor } from './vertex';
import { STAGE_PROMPTS, type StageConfig } from './stages';
import { checkIntentCompliance } from './compliance';
import { killProjectProcesses } from './processRegistry';
import type { OrchestratorStageName, OrchestratorStageStatus, CheckpointState } from '../types';

// ════════════════════════════════════════════
//  Build Output Validation
// ════════════════════════════════════════════

/** Patterns that indicate a build or runtime failure in stage output */
const BUILD_FAILURE_PATTERNS = [
  /Exit code:\s*[1-9]/i,
  /\bERROR\b.*\b(ENOENT|EACCES|MODULE_NOT_FOUND|Cannot find module)\b/i,
  /\bSyntaxError\b/i,
  /\bTypeError\b/i,
  /\bReferenceError\b/i,
  /\[postcss\].*tailwindcss.*PostCSS plugin/i,
  /\bVite\b.*\bInternal server error\b/i,
  /\bERR!\b.*\bnpm\b/i,
  /\bnpm ERR!\b/i,
  /\bModuleNotFoundError\b/i,
  /\bTraceback \(most recent call last\)/i,
  /\bFATAL ERROR\b/i,
  /\bUnhandledPromiseRejection\b/i,
  /\bEADDRINUSE\b/i,
  /\bCompilation failed\b/i,
  /\bcould not resolve\b/i,
  // Python-specific
  /\bImportError\b/i,
  /\bFlask.*error\b/i,
  /\bNo module named\b/i,
  /\bIndentationError\b/i,
  /\bNameError\b/i,
  /\bAttributeError\b/i,
  /\bKeyError\b/i,
  /\bValueError\b/i,
  // Vite / PostCSS specific
  /\[plugin:.*\]\s*error/i,
  /postcss.*plugin.*error/i,
  /\bUnknown word\b/i,
  /\bCssSyntaxError\b/i,
  // Node / npm
  /\bENOSPC\b/i,
  /\bcannot find package\b/i,
  /\bMissing script\b/i,
  // Generic crash patterns
  /\bsegmentation fault\b/i,
  /\bprocess exited with code [1-9]/i,
];

const BROWSER_FAILURE_PATTERNS = [
  /\bVite\b.*\boverlay\b/i,
  /\b(500|502|503|504)\b.*\bInternal Server Error\b/i,
  /Unexpected token.*<!doctype/i,
  /Unexpected token.*<\s/i,
  /\bFailed to fetch\b/i,
  /\bnet::ERR_CONNECTION_REFUSED\b/i,
  /\bnet::ERR_FAILED\b/i,
  /\bCORS\b.*\bblocked\b/i,
  /\b404\b.*\bNot Found\b/i,
  /\bblank.*page\b|\bwhite.*page\b/i,
  /\[PageError\]/i,
  /\[NetworkFail\]/i,
  /\bconsole\.error\b/i,
  // JSON-as-HTML detection
  /content-type.*text\/html.*expected.*json/i,
  /\bSyntaxError.*JSON\.parse\b/i,
  // Missing CSS / unstyled
  /\bunstyled\b.*\bpage\b/i,
  /\bno.*css\b.*\bloaded\b/i,
  // Visual QA tool verdicts — catch QA_FAIL from run_visual_qa
  /Verdict:\s*\*?\*?QA_FAIL\*?\*?/i,
  /❌\s*\*?\*?(Page Load|Not Blank|No Error Overlay|CSS Loaded|Layout Elements|Images|Header Styling|Layout Not Collapsed|Console Errors)\*?\*?/i,
  /Visual QA.*failed/i,
];

/** Check if stage output contains build failure patterns */
function detectBuildFailures(output: string): string[] {
  const issues: string[] = [];
  for (const pattern of BUILD_FAILURE_PATTERNS) {
    if (pattern.test(output)) {
      const match = output.match(pattern);
      issues.push(`Build failure detected: ${match?.[0] || pattern.source}`);
    }
  }
  return issues;
}

/** Check if stage output contains browser/QA failure patterns */
function detectBrowserFailures(output: string): string[] {
  const issues: string[] = [];
  for (const pattern of BROWSER_FAILURE_PATTERNS) {
    if (pattern.test(output)) {
      const match = output.match(pattern);
      issues.push(`Browser QA failure: ${match?.[0] || pattern.source}`);
    }
  }
  return issues;
}

// ════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════

export type StageName = OrchestratorStageName;
export type StageStatus = OrchestratorStageStatus;

export interface StageResult {
  stage: StageName;
  status: StageStatus;
  output: string;
  artifacts: Record<string, string>; // key-value pairs of structured data
  startedAt: number;
  completedAt?: number;
  turnCount: number;
  error?: string;
}

export interface OrchestratorState {
  taskId: string;
  userIntent: string;
  complexity: 'simple' | 'moderate' | 'complex';
  stages: StageResult[];
  activeStage: StageName | null;
  recoveryCount: number;
  maxRecoveries: number;
  isComplete: boolean;
  finalSummary?: string;
  checkpointState?: CheckpointState;
}

export interface OrchestratorEvent {
  type: 'stage_start' | 'stage_progress' | 'stage_complete' | 'stage_failed'
    | 'recovery_triggered' | 'orchestrator_complete' | 'orchestrator_error' | 'run_paused';
  stage?: StageName;
  content: string;
  state: OrchestratorState;
  // Pass-through from inner agent
  agentTurn?: AgentTurn;
}

// ════════════════════════════════════════════
//  Task Complexity Classification
// ════════════════════════════════════════════

function classifyComplexity(intent: string): 'simple' | 'moderate' | 'complex' {
  const lower = intent.toLowerCase();
  const wordCount = intent.split(/\s+/).length;

  // Simple: single-action tasks
  const simplePatterns = [
    /^(add|fix|remove|delete|rename|update|change)\s+(a\s+)?comment/i,
    /^(fix|correct)\s+(the\s+)?(typo|error|bug|issue)\s+(in|on)/i,
    /^(add|create)\s+(a\s+)?\.?gitignore/i,
    /^(format|lint|clean)/i,
  ];
  if (wordCount < 15 && simplePatterns.some(p => p.test(lower))) {
    return 'simple';
  }

  // Complex: multi-feature, full app, deployment
  const complexIndicators = ['deploy', 'build.*app', 'create.*application',
    'full.?stack', 'database', 'authentication', 'test.*and.*verify',
    'multiple.*features', 'design.*system'];
  const complexCount = complexIndicators.filter(p => new RegExp(p, 'i').test(lower)).length;
  if (complexCount >= 2 || wordCount > 50) {
    return 'complex';
  }

  // App creation / new project requests → always complex so we get build + QA
  const appCreationPatterns = [
    /\b(build|create|make|scaffold|generate|set up|setup)\b.*\b(app|application|website|dashboard|page|interface|frontend|ui)\b/i,
    /\b(todo|task|kanban|crud|portfolio|landing|blog)\b.*\b(app|application|page)\b/i,
    /\bfrom scratch\b/i,
    /\bnew.*(react|vue|next|vite|angular)\b/i,
  ];
  if (appCreationPatterns.some(p => p.test(lower))) {
    return 'complex';
  }

  return 'moderate';
}

/** Detect if the user intent is a bug/fix/diagnosis request */
function isBugFixIntent(intent: string): boolean {
  const lower = intent.toLowerCase();
  const patterns = [
    /something.*(wrong|broken|not working|failing|crashed)/,
    /fix\s+(this|the|it|bug|error|issue|problem)/,
    /doesn.?t\s+(work|run|load|compile|build|start|render)/,
    /broken|crashing|failing|error|bug|issue/,
    /why.*fail|why.*broken|why.*error|why.*crash/,
    /what.*(wrong|broken|failing)/,
    /debug|diagnose|troubleshoot|investigate/,
    /not\s+(working|loading|rendering|showing|displaying)/,
    /stopped\s+(working|running|loading)/,
  ];
  return patterns.some(p => p.test(lower));
}

function isAuditIntent(intent: string): boolean {
  return /\b(audit|review|inspect|analy[sz]e)\b.*\b(codebase|repo|repository|project|folder|source)\b/i.test(intent)
    || /\b(codebase|repo|repository|project|folder|source)\b.*\b(audit|review|inspection)\b/i.test(intent);
}

/** Select which stages to run based on complexity and intent keywords */
function selectStages(complexity: 'simple' | 'moderate' | 'complex', intent: string): StageName[] {
  if (isAuditIntent(intent)) {
    return ['intent', 'scout', 'audit'];
  }

  const isBugFix = isBugFixIntent(intent);
  let stages: StageName[] = [];
  
  if (isBugFix) {
    // Bug/fix workflow: diagnose first, then implement the fix
    switch (complexity) {
      case 'simple':
        stages = ['intent', 'diagnose', 'implement', 'release'];
        break;
      case 'moderate':
        stages = ['intent', 'scout', 'diagnose', 'implement', 'build', 'critic', 'release'];
        break;
      case 'complex':
        stages = ['intent', 'scout', 'diagnose', 'plan', 'implement', 'build', 'browserQa', 'critic', 'release'];
        break;
    }
  } else {
    // Normal creation/modification workflow
    switch (complexity) {
      case 'simple':
        stages = ['intent', 'implement', 'release'];
        break;
      case 'moderate':
        stages = ['intent', 'plan', 'implement', 'build', 'critic', 'release'];
        break;
      case 'complex':
        stages = ['intent', 'scout', 'toolStrategy', 'plan', 'implement', 'build', 'browserQa', 'critic', 'release'];
        break;
    }
  }

  const lower = intent.toLowerCase();
  
  // Inject Git Sync stage downstream if requested
  if (/(push|commit|github|git|sync changes)/.test(lower)) {
    stages.push('gitSync');
  }

  // Inject GCP Deploy stage downstream if requested
  if (/(deploy|gcp|cloud run|google cloud|artifact registry)/.test(lower)) {
    stages.push('gcpDeploy');
  }

  return stages;
}

// ════════════════════════════════════════════
//  Stage Execution
// ════════════════════════════════════════════

/** Build a stage-specific system instruction by composing the base agent prompt
 *  with the stage's specialized focus prompt and prior stage context */
function buildStageInstruction(
  stageConfig: StageConfig,
  state: OrchestratorState,
  projectContext?: string,
): string {
  const basePrompt = buildAgentSystemInstruction(projectContext);

  // Collect prior stage outputs as context
  const priorContext = state.stages
    .filter(s => s.status === 'complete' || s.status === 'failed')
    .map(s => `### Stage: ${s.stage} — STATUS: ${s.status.toUpperCase()}${s.error ? ` — ERROR: ${s.error}` : ''}\n${s.output}`)
    .join('\n\n');

  // ── RELEASE STAGE: inject structured verdict summary so the agent has hard facts ──
  let verdictBlock = '';
  if (stageConfig.id === 'release') {
    const stageStatuses = state.stages.map(s =>
      `- ${s.stage}: ${s.status.toUpperCase()}${s.error ? ` (${s.error})` : ''}`
    ).join('\n');
    const failedStages = state.stages.filter(s => s.status === 'failed');
    const recoveries = state.recoveryCount || 0;
    verdictBlock = [
      '## MANDATORY VERDICT INPUT — Prior Stage Outcomes',
      'Below is the factual status of every stage that ran before you.',
      'Your verdict MUST be based on these facts, not on optimism.',
      '',
      stageStatuses,
      '',
      failedStages.length > 0
        ? `⚠️ ${failedStages.length} stage(s) FAILED: ${failedStages.map(s => s.stage).join(', ')}. Your verdict MUST be "Failed" or "Partial Success" — NOT "Success".`
        : 'All stages completed successfully.',
      recoveries > 0
        ? `Recovery cycles used: ${recoveries}. If recovery was needed, note it in your summary.`
        : '',
    ].filter(Boolean).join('\n');
  }

  return [
    basePrompt,
    '',
    '## Current Orchestration Stage',
    `You are currently in the **${stageConfig.name}** stage.`,
    stageConfig.prompt,
    '',
    stageConfig.constraints ? `## Stage Constraints\n${stageConfig.constraints}` : '',
    '',
    verdictBlock,
    '',
    priorContext ? `## Prior Stage Results\n${priorContext}` : '',
    '',
    `## Stage Budget`,
    `You have a maximum of ${stageConfig.maxTurns} turns for this stage.`,
    `Focus on your specific role and call task_complete when your part is done.`,
  ].filter(Boolean).join('\n');
}

/** Run a single stage as an agent loop with a stage-specific prompt */
async function* runStage(
  stageConfig: StageConfig,
  state: OrchestratorState,
  vertexConfig: { gcpProject: string; gcpRegion: string; model?: string; temperature?: number; maxTokens?: number },
  toolExecutor: ToolExecutor,
  projectContext?: string,
): AsyncGenerator<OrchestratorEvent> {
  const systemInstruction = buildStageInstruction(stageConfig, state, projectContext);

  // Build the user message: the original intent + stage-specific direction
  const stageMessage = [
    `USER REQUEST: ${state.userIntent}`,
    '',
    `YOUR ROLE: ${stageConfig.name}`,
    stageConfig.userMessageSuffix || '',
  ].filter(Boolean).join('\n');

  const stageResult: StageResult = {
    stage: stageConfig.id,
    status: 'active',
    output: '',
    artifacts: {},
    startedAt: Date.now(),
    turnCount: 0,
  };

  // Update state
  state.activeStage = stageConfig.id;
  state.stages.push(stageResult);

  yield {
    type: 'stage_start',
    stage: stageConfig.id,
    content: `Starting stage: ${stageConfig.name}`,
    state: { ...state },
  };

  try {
    const agentLoop = executeAgentWithTools(
      vertexConfig,
      stageMessage,
      systemInstruction,
      toolExecutor,
      stageConfig.maxTurns,
      stageConfig.id // Pass the stageName for completion gating
    );

    let lastOutput = '';

    for await (const turn of agentLoop) {
      stageResult.turnCount++;

      // Collect output
      if (turn.type === 'text' || turn.type === 'complete') {
        lastOutput += turn.content + '\n';
      }

      yield {
        type: 'stage_progress',
        stage: stageConfig.id,
        content: turn.content,
        state: { ...state },
        agentTurn: turn,
      };

      if (turn.type === 'complete') {
        stageResult.status = 'complete';
        stageResult.output = lastOutput.trim();
        stageResult.completedAt = Date.now();

        yield {
          type: 'stage_complete',
          stage: stageConfig.id,
          content: `Stage ${stageConfig.name} complete (${stageResult.turnCount} turns)`,
          state: { ...state },
        };
        return;
      }

      if (turn.type === 'error') {
        stageResult.status = 'failed';
        stageResult.error = turn.content;
        stageResult.completedAt = Date.now();

        yield {
          type: 'stage_failed',
          stage: stageConfig.id,
          content: `Stage ${stageConfig.name} failed: ${turn.content}`,
          state: { ...state },
        };
        return;
      }
      
      if (turn.type === 'paused') {
        stageResult.status = 'paused';
        stageResult.output = lastOutput.trim();
        stageResult.completedAt = Date.now();
        
        // Attach Checkpoint
        state.checkpointState = {
           stage: stageConfig.id,
           reason: (turn.checkpointData?.reason as string) || 'budget_exhausted',
           completedActions: (turn.checkpointData?.completedActions as string[]) || [],
           remainingTasks: ['Review execution state', 'Verify implementation'],
           recommendedAction: turn.checkpointData?.reason === 'stagnation' ? 'repair' : 'resume',
           internalStateSnapshot: { ...state } // Serializing state minus cyclic refs (which we avoid naturally here)
        };

        yield {
          type: 'run_paused',
          stage: stageConfig.id,
          content: turn.content,
          state: { ...state }
        };
        return;
      }
    }

    // If we exhaust turns without explicit complete — this is NOT success
    stageResult.status = 'failed';
    stageResult.output = lastOutput.trim() || 'Stage exhausted turn budget without completing.';
    stageResult.error = 'Turn budget exhausted without explicit completion';
    stageResult.completedAt = Date.now();

    yield {
      type: 'stage_failed',
      stage: stageConfig.id,
      content: `Stage ${stageConfig.name} failed (turns exhausted without completion)`,
      state: { ...state },
    };
  } catch (error) {
    stageResult.status = 'failed';
    stageResult.error = error instanceof Error ? error.message : 'Unknown error';
    stageResult.completedAt = Date.now();

    yield {
      type: 'stage_failed',
      stage: stageConfig.id,
      content: `Stage ${stageConfig.name} error: ${stageResult.error}`,
      state: { ...state },
    };
  }
}

// ════════════════════════════════════════════
//  Main Orchestrator
// ════════════════════════════════════════════

export async function* runOrchestrator(
  projectFolder: string,
  vertexConfig: { gcpProject: string; gcpRegion: string; model?: string; temperature?: number; maxTokens?: number },
  userMessage: string,
  toolExecutor: ToolExecutor,
  projectContext?: string,
  maxRecoveries: number = 2,
  resumeState?: OrchestratorState,
  taskId?: string
): AsyncGenerator<OrchestratorEvent> {

  // ── Intent-level compliance gate (real enforcement, not advisory) ──
  // If the user request looks clearly malicious (e.g. "build a ransomware")
  // or embeds a hard-coded secret, we refuse BEFORE any agent stage runs.
  const intentCompliance = checkIntentCompliance(userMessage);
  if (intentCompliance.status === 'blocked') {
    const refusalState: OrchestratorState = {
      taskId: taskId || `task_${Date.now()}`,
      userIntent: userMessage,
      complexity: 'simple',
      stages: [],
      activeStage: null,
      recoveryCount: 0,
      maxRecoveries,
      isComplete: true,
      finalSummary: `Refused by compliance policy: ${intentCompliance.reason}`,
    };
    yield {
      type: 'orchestrator_error',
      content: `Refused by compliance policy (${intentCompliance.category || 'n/a'}): ${intentCompliance.reason}`,
      state: refusalState,
    };
    return;
  }
  if (intentCompliance.status === 'warn') {
    const warnState: OrchestratorState = {
      taskId: taskId || `task_${Date.now()}`,
      userIntent: userMessage,
      complexity: 'simple',
      stages: [],
      activeStage: null,
      recoveryCount: 0,
      maxRecoveries,
      isComplete: false,
    };
    yield {
      type: 'stage_start',
      content: `⚠ Compliance warning: ${intentCompliance.reason}`,
      state: warnState,
    };
  }

  // ── Clean up processes from previous runs ──
  try {
    const tracked = await killProjectProcesses(projectFolder);
    if (tracked.length > 0) {
      // Log tracked process cleanup for visibility
      for (const msg of tracked) console.log(`[ProcessCleanup] ${msg}`);
    }
    // Also sweep for orphan dev servers not in the registry
    const { killOrphanDevServers } = await import('./processRegistry');
    const orphans = await killOrphanDevServers(projectFolder);
    for (const msg of orphans) console.log(`[OrphanCleanup] ${msg}`);
  } catch { /* ignore cleanup errors */ }

  // Classify complexity and select stages
  // On resume, use the checkpoint's complexity and derive stages from its completed data
  const complexity = resumeState ? resumeState.complexity : classifyComplexity(userMessage);
  
  // When resuming, reconstruct the stage list from the checkpoint's internalStateSnapshot
  // instead of re-classifying which could produce a different pipeline
  let selectedStageNames: StageName[];
  if (resumeState && resumeState.checkpointState?.remainingTasks) {
    // Combine completed stages + remaining stages from the checkpoint
    const completedStages = (resumeState.checkpointState.completedActions || []) as StageName[];
    const remainingStages = (resumeState.checkpointState.remainingTasks || []) as StageName[];
    selectedStageNames = [...completedStages, ...remainingStages];
  } else {
    selectedStageNames = selectStages(complexity, userMessage);
  }

  // Initialize state (or resume from checkpoint)
  const state: OrchestratorState = resumeState ? { ...resumeState, isComplete: false } : {
    taskId: taskId || `task_${Date.now()}`,
    userIntent: userMessage,
    complexity,
    stages: [],
    activeStage: null,
    recoveryCount: 0,
    maxRecoveries,
    isComplete: false,
  };

  // If resuming from a plan approval, mark the plan stage as COMPLETE (user approved it)
  // and skip directly to the next stage
  if (resumeState) {
    const lastStage = state.stages[state.stages.length - 1];
    if (lastStage && (lastStage.status === 'paused' || lastStage.status === 'failed')) {
      // Plan was approved by the user — mark it complete so it gets skipped
      lastStage.status = 'complete';
      lastStage.completedAt = Date.now();
    }
    yield {
      type: 'stage_start',
      content: `Plan approved — continuing pipeline from after ${lastStage?.stage || 'checkpoint'}...`,
      state: { ...state }
    };
  } else {
    yield {
      type: 'stage_start',
      content: `Task classified as "${complexity}" — running ${selectedStageNames.length} stages: ${selectedStageNames.join(' → ')}`,
      state: { ...state },
    };
  }

  // Run each stage sequentially
  for (const stageName of selectedStageNames) {
    // Skip stages that are already completed from the resume state
    const existingResult = state.stages.find(s => s.stage === stageName);
    if (existingResult && existingResult.status === 'complete') {
       continue;
    }

    // If resuming an active/paused stage, we might want to pop it so we can run it again cleanly
    if (existingResult && existingResult.status !== 'complete') {
        state.stages = state.stages.filter(s => s.stage !== stageName);
    }
    const stageConfig = STAGE_PROMPTS[stageName];
    if (!stageConfig) continue;

    // Run the stage
    for await (const event of runStage(stageConfig, state, vertexConfig, toolExecutor, projectContext)) {
      yield event;
      
      // If the stage produced a report, write its artifact to disk.
      if (event.type === 'stage_complete' && (event.stage === 'diagnose' || event.stage === 'audit') && state.taskId) {
        try {
            const runFolder = path.join(projectFolder, '.orbitcode', 'runs', state.taskId);
            await fs.mkdir(runFolder, { recursive: true });
            
            // Extract the completed output
            const dr = state.stages.find(s => s.stage === event.stage);
            if (dr && dr.output) {
                await fs.writeFile(path.join(runFolder, 'report.md'), dr.output, 'utf-8');
            }
        } catch (err) {
            console.error('Failed to write diagnosis report', err);
        }
      }
    }

    // Check if the last stage failed or paused
    const lastStageResult = state.stages[state.stages.length - 1];

    if (lastStageResult?.status === 'paused') {
      // If we paused, stop orchestrating
      return;
    }

    // ── APPROVAL GATE: Pause after plan stage to require explicit user approval ──
    // The plan stage proposes what will be built. The implement stage executes it.
    // We must NOT proceed to implement without explicit user consent.
    if (stageName === 'plan' && lastStageResult?.status === 'complete' && !resumeState) {
      lastStageResult.status = 'paused';
      state.checkpointState = {
        stage: 'plan',
        reason: 'approval_required',
        completedActions: state.stages.filter(s => s.status === 'complete' || s.status === 'paused').map(s => s.stage),
        remainingTasks: selectedStageNames.filter(s => !state.stages.find(r => r.stage === s && (r.status === 'complete' || r.status === 'paused'))),
        recommendedAction: 'resume',
        internalStateSnapshot: { ...state },
      };
      yield {
        type: 'run_paused',
        stage: 'plan',
        content: JSON.stringify({ type: 'plan', payload: { summary: lastStageResult.output, stages: selectedStageNames } }),
        state: { ...state },
      };
      return; // Stop here — user must explicitly approve to continue
    }

    if (lastStageResult?.status === 'failed') {
      // ── HARD GATE: build/browserQa failures MUST route to repair ──
      if ((stageName === 'build' || stageName === 'browserQa' || stageName === 'critic') && state.recoveryCount < maxRecoveries) {
        state.recoveryCount++;

        yield {
          type: 'recovery_triggered',
          stage: 'diagnose',
          content: `${stageName} failed — routing to Diagnosis → Repair (attempt ${state.recoveryCount}/${maxRecoveries})`,
          state: { ...state },
        };

        // Run diagnosis stage first
        const diagnoseConfig = STAGE_PROMPTS['diagnose'];
        if (diagnoseConfig) {
          for await (const event of runStage(diagnoseConfig, state, vertexConfig, toolExecutor, projectContext)) {
            yield event;
          }
        }

        // Then run repair stage to apply the diagnosis
        const repairConfig = STAGE_PROMPTS['repair'];
        if (repairConfig) {
          for await (const event of runStage(repairConfig, state, vertexConfig, toolExecutor, projectContext)) {
            yield event;
          }
        }

        // Continue to next stage (which would be release)
        continue;
      }

      // For unrecoverable failures, stop the pipeline — do NOT continue silently
      yield {
        type: 'stage_failed',
        stage: stageName,
        content: `Stage "${stageName}" failed and recovery is exhausted. Pipeline stopped.`,
        state: { ...state },
      };
      // Don't break — fall through to release for a FAIL verdict
    }

    // ── POST-STAGE VALIDATION: detect failure patterns in completed stage output ──
    if (lastStageResult?.status === 'complete') {
      const output = lastStageResult.output || '';
      
      if (stageName === 'build' || stageName === 'implement') {
        const buildIssues = detectBuildFailures(output);
        if (buildIssues.length > 0 && state.recoveryCount < maxRecoveries) {
          // Build passed from agent's perspective but output contains failure patterns
          lastStageResult.status = 'failed';
          lastStageResult.error = `Build validation detected issues: ${buildIssues.join('; ')}`;
          state.recoveryCount++;

          yield {
            type: 'recovery_triggered',
            stage: 'repair',
            content: `Build output validation caught issues: ${buildIssues.join(', ')} — routing to Repair (attempt ${state.recoveryCount}/${maxRecoveries})`,
            state: { ...state },
          };

          const repairConfig = STAGE_PROMPTS['repair'];
          if (repairConfig) {
            for await (const event of runStage(repairConfig, state, vertexConfig, toolExecutor, projectContext)) {
              yield event;
            }
          }
          continue;
        }
      }

      if (stageName === 'browserQa') {
        const qaIssues = detectBrowserFailures(output);
        if (qaIssues.length > 0 && state.recoveryCount < maxRecoveries) {
          lastStageResult.status = 'failed';
          lastStageResult.error = `Browser QA validation detected issues: ${qaIssues.join('; ')}`;
          state.recoveryCount++;

          yield {
            type: 'recovery_triggered',
            stage: 'repair',
            content: `Browser QA validation caught issues: ${qaIssues.join(', ')} — routing to Repair`,
            state: { ...state },
          };

          const repairConfig = STAGE_PROMPTS['repair'];
          if (repairConfig) {
            for await (const event of runStage(repairConfig, state, vertexConfig, toolExecutor, projectContext)) {
              yield event;
            }
          }
          continue;
        }
      }

      // ── Post-stage process cleanup: kill dev servers after QA ──
      if (stageName === 'browserQa' || stageName === 'build') {
        try {
          const { killOrphanDevServers, pruneDeadProcesses: prune } = await import('./processRegistry');
          const orphans = await killOrphanDevServers(projectFolder);
          for (const msg of orphans) console.log(`[PostStageCleanup] ${msg}`);
          prune(); // Also clean up dead tracked processes
        } catch { /* non-critical */ }
      }
    }
  }

  // ── Post-pipeline compliance sweep ──
  // Scan the concatenated output of implement / repair / gcpDeploy stages for
  // hard-coded secrets, PII exfil, or destructive production SQL. This is a
  // best-effort sweep of text visible to the orchestrator; the critic stage
  // already reads the actual files.
  const producedText = state.stages
    .filter(s => ['implement', 'repair', 'gcpDeploy'].includes(s.stage))
    .map(s => s.output || '')
    .join('\n');
  const finalComp = checkIntentCompliance(producedText);
  let complianceNote = '';
  if (finalComp.status === 'blocked') {
    complianceNote = `\n⚠ COMPLIANCE VIOLATION FLAGGED: ${finalComp.reason}`;
  } else if (finalComp.status === 'warn') {
    complianceNote = `\n⚠ Compliance warning: ${finalComp.reason}`;
  }

  // Build final summary — with honest verdict
  const completedStages = state.stages.filter(s => s.status === 'complete');
  const failedStages = state.stages.filter(s => s.status === 'failed');
  const hasFailures = failedStages.length > 0;

  state.isComplete = true;
  state.finalSummary = [
    `## Task ${hasFailures ? 'Completed with Issues' : 'Complete'}`,
    `Complexity: ${state.complexity}`,
    `Stages run: ${state.stages.length}`,
    `Completed: ${completedStages.length}`,
    failedStages.length > 0 ? `Failed: ${failedStages.length} (${failedStages.map(s => s.stage).join(', ')})` : '',
    state.recoveryCount > 0 ? `Recovery cycles: ${state.recoveryCount}` : '',
    complianceNote,
    hasFailures ? '\n⚠️ **Some stages failed.** The generated output may have issues.' : '',
  ].filter(Boolean).join('\n');

  // ── Persist run to disk for history ──
  try {
    const runFolder = path.join(projectFolder, '.orbitcode', 'runs', state.taskId);
    await fs.mkdir(runFolder, { recursive: true });

    // Derive verdict from release stage output if available, else from stage failures
    let derivedVerdict: string = hasFailures ? 'FAIL' : 'PASS';
    const releaseStage = state.stages.find(s => s.stage === 'release');
    if (releaseStage?.output) {
      const verdictMatch = releaseStage.output.match(/"verdict"\s*:\s*"([^"]+)"/i);
      if (verdictMatch) {
        const v = verdictMatch[1].toLowerCase();
        if (v.includes('fail')) derivedVerdict = 'FAIL';
        else if (v.includes('partial')) derivedVerdict = 'PARTIAL';
        else if (v.includes('success') && !hasFailures) derivedVerdict = 'PASS';
        else if (v.includes('success') && hasFailures) derivedVerdict = 'PARTIAL'; // Override if stages failed
      }
    }
    // Hard gate: if any build/browserQa/critic stage failed, never PASS
    const criticalFailures = failedStages.filter(s => ['build', 'browserQa', 'critic'].includes(s.stage));
    if (criticalFailures.length > 0) derivedVerdict = 'FAIL';

    const manifest = {
      taskId: state.taskId,
      intent: state.userIntent,
      complexity: state.complexity,
      verdict: derivedVerdict,
      stages: state.stages.map(s => ({
        stage: s.stage,
        status: s.status,
        turnCount: s.turnCount,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        error: s.error,
      })),
      recoveryCount: state.recoveryCount,
      startedAt: state.stages[0]?.startedAt || Date.now(),
      completedAt: Date.now(),
      status: hasFailures ? 'failed' : 'complete',
    };
    await fs.writeFile(path.join(runFolder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist run manifest:', err);
  }

  yield {
    type: 'orchestrator_complete',
    content: state.finalSummary,
    state: { ...state },
  };
}
