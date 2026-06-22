/* OrbitCode — Shared TypeScript types */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tokenCount?: number;
}

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  size?: number;
  isReport?: boolean;
  runId?: string;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
  isImage?: boolean;
  isAgent?: boolean;
  isBrowser?: boolean;     // Indicates this tab should render the Agent Browser workspace
  isReport?: boolean;      // Indicates this tab should render a Diagnosis/Artifact report
  runId?: string;          // Associates the tab with a specific agent run
  isRunViewer?: boolean;   // First-class Historical Run Viewer tab (index + detail)
  isSystemCheck?: boolean; // First-class System Check tab (startup preflight)
}

export interface EditorContext {
  filePath: string;
  fileName: string;
  language: string;
  content: string;
  selectedText?: string;
  cursorLine?: number;
  cursorColumn?: number;
}

export interface AppSettings {
  gcpProject: string;
  gcpRegion: string;
  providerId: string;
  selectedProviderId: string;
  providerKind?: string;
  temperature: number;
  maxTokens: number;
  systemInstruction: string;
  projectFolder: string;
  selectedModel: string;
  beginnerMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  gcpProject: '',
  gcpRegion: 'us-central1',
  providerId: 'local-ollama',
  selectedProviderId: 'local-ollama',
  providerKind: 'ollama',
  temperature: 0.7,
  maxTokens: 8192,
  systemInstruction: `You are OrbitCode, an expert Senior Software Engineer AI assistant.

Rules:
1. Precision: Modify only the code sections specifically requested. Do not refactor unrelated logic.
2. Security & Best Practices: Always check for common vulnerabilities and language-specific anti-patterns.
3. Output: Provide code in clear Markdown code blocks with the language specified. Be concise.
4. Clarification: If a request is ambiguous, ask for clarification before generating code.
5. Context: Use the provided file context and project structure to give accurate, relevant answers.`,
  projectFolder: '',
  selectedModel: 'qwen3:8b',
  beginnerMode: true,
};

export interface StreamChunk {
  type: 'text' | 'error' | 'done';
  content: string;
}

// ════════════════════════════════════════════
//  Agent Task Types
// ════════════════════════════════════════════
export type AgentTaskStatus = 'idle' | 'planning' | 'executing' | 'verifying' | 'complete' | 'paused' | 'error' | 'approval_required';

export interface AgentToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'blocked';
  safetyLevel?: 'safe' | 'write' | 'destructive' | 'blocked';
  timestamp: number;
}

export interface AgentStep {
  id: string;
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'error' | 'complete' | 'approval_required';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  timestamp: number;
}

export interface AgentTask {
  id: string;
  intent: string;
  status: AgentTaskStatus;
  steps: AgentStep[];
  filesCreated: string[];
  filesModified: string[];
  commandsRun: string[];
  summary?: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
  // Orchestration fields
  orchestrated?: boolean;
  complexity?: 'simple' | 'moderate' | 'complex';
  stageResults?: OrchestratorStageResult[];
  activeStage?: string;
  recoveryCount?: number;
  checkpointState?: CheckpointState;
}

export type ChatMode = 'chat' | 'agent';

// ════════════════════════════════════════════
//  Orchestration Types
// ════════════════════════════════════════════

export type OrchestratorStageName =
  | 'intent' | 'scout' | 'toolStrategy' | 'plan' | 'implement'
  | 'build' | 'browserQa' | 'critic' | 'repair' | 'diagnose' | 'audit' | 'release' | 'gitSync' | 'gcpDeploy';

// ════════════════════════════════════════════
//  Browser Session Types (Agent Browser)
// ════════════════════════════════════════════

export type BrowserSessionStatus = 'idle' | 'running' | 'paused' | 'complete' | 'failed';

export interface BrowserStep {
  id: string;
  action: string;        // 'navigate' | 'click' | 'type' | 'scroll' | 'wait' | 'screenshot' | 'assert'
  description: string;
  url: string;
  timestamp: number;
  screenshot?: string;   // base64 data URI
  duration?: number;
  error?: string;
}

export interface BrowserSessionState {
  sessionId: string;
  status: BrowserSessionStatus;
  currentUrl: string;
  currentStep: string;
  stepCount: number;
  steps: BrowserStep[];
  logs: string[];
  errors: string[];
  screenshots: string[];  // base64 data URIs
  startedAt: number;
  completedAt?: number;
}

export interface DiagnosticArtifact {
  issueSummary: string;
  evidenceObserved: string[];
  reproductionStatus: 'reproduced' | 'not_reproduced' | 'partial' | 'skipped';
  probableRootCause: string;
  proposedFix: string;
  acceptanceChecks: string[];
}

export type OrchestratorStageStatus = 'pending' | 'active' | 'complete' | 'paused' | 'failed' | 'skipped';

export interface OrchestratorStageResult {
  stage: OrchestratorStageName;
  status: OrchestratorStageStatus;
  output: string;
  startedAt: number;
  completedAt?: number;
  turnCount: number;
  error?: string;
}

export interface CheckpointState {
  stage: OrchestratorStageName;
  reason: string;
  completedActions: string[];
  remainingTasks: string[];
  recommendedAction: 'resume' | 'repair' | 'abort';
  internalStateSnapshot: Record<string, unknown>;
}

// ════════════════════════════════════════════
//  Git State Engine Types
// ════════════════════════════════════════════

export interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted';
  staged: boolean;
}

export interface RepoState {
  // Identity
  isRepo: boolean;
  isCorrupt: boolean;
  branch: string | null;
  isDetachedHead: boolean;

  // Working tree
  isClean: boolean;
  unstagedChanges: FileChange[];
  stagedChanges: FileChange[];
  untrackedFiles: string[];
  hasConflictMarkers: boolean;
  conflictedFiles: string[];

  // Operations in progress
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  cherryPickInProgress: boolean;
  revertInProgress: boolean;
  hasLockFile: boolean;

  // Remote & sync
  hasRemote: boolean;
  remoteUrl: string | null;
  hasUpstream: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  diverged: boolean;

  // Stash
  stashCount: number;

  // Raw output for technical details panel
  rawStatusOutput: string;

  // Error state
  inspectionError?: string;
}

export type GitAction =
  | 'pull' | 'pull-merge' | 'pull-rebase'
  | 'push' | 'publish-branch'
  | 'commit'
  | 'checkout' | 'create-branch' | 'delete-branch'
  | 'stash' | 'stash-untracked' | 'stash-pop'
  | 'stash-and-pull' | 'stash-untracked-and-pull'
  | 'fetch'
  | 'continue-rebase' | 'abort-rebase'
  | 'continue-merge' | 'abort-merge'
  | 'remove-lock'
  | 'sync';

export interface RecoveryAction {
  id: string;
  label: string;
  description: string;
  risk: 'safe' | 'moderate' | 'destructive';
  confirmRequired: boolean;
}

export interface ActionEvaluation {
  canProceed: boolean;
  summary: string;
  warnings: string[];
  blockers: string[];
  recoveryActions: RecoveryAction[];
  technicalDetails?: string;
}

export interface ActionResult {
  success: boolean;
  output: string;
  partialSuccess?: boolean;
  partialMessage?: string;
  updatedState?: RepoState;
}
