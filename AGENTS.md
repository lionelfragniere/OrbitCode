<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# OrbitCode — Agent Architecture

## Agent Orchestration (Phase 1)

### Tool-Calling Flow
- User input → `/api/agent` → provider-neutral AI runtime → Tool execution → Result fed back → Loop until task_complete
- Providers: OpenAI, Anthropic, Gemini API, Vertex AI, Ollama, and custom OpenAI-compatible endpoints
- Tools include filesystem, terminal, browser QA, git/deploy actions, and MemPalace-backed memory tools.

### Key Agent Files
- `lib/agent/tools.ts` — Tool schemas (FunctionDeclaration with Type enum)
- `lib/ai/providerStore.ts` / `lib/ai/providerClient.ts` — Provider selection, encrypted secrets, and provider adapters
- `lib/ai/agentRuntime.ts` — Provider-neutral agent loop
- `lib/agent/vertex.ts` — Compatibility wrapper around provider-neutral execution
- `lib/agent/orchestrator.ts` — Multi-stage orchestrator (selective stage pipeline)
- `lib/agent/stages.ts` — Stage-specific system prompts and turn budgets, including read-only codebase audits
- `lib/agent/ponytail.ts` — Built-in Ponytail prompt rules and report-command detection
- `lib/agent/executor.ts` — Tool implementations (filesystem, terminal, search)
- `lib/agent/safety.ts` — Command safety classification + audit log
- `app/api/agent/route.ts` — Agent API endpoint (SSE streaming, single + orchestrated)
- `components/TaskPanel.tsx` — Real-time task execution timeline with stage pipeline

## Model Abstraction (Phase 2)
- `lib/models.ts` — MODEL_REGISTRY with 3 models + pricing
- `components/ModelSelector.tsx` — Dropdown in StatusBar
- `lib/hooks/useUsageTracking.ts` — Per-request token counting

## Local Memory (Phase 2)
- `lib/hooks/useProjectBrain.ts` — MemPalace-backed local memory compatibility hook
- `lib/memory/mempalace.ts` — MemPalace CLI bridge for status, search, notes, wake-up context, init, and mining
- `app/api/memory/route.ts` — Memory status/search/init/mine API

## GitHub Workflow (Phase 3)
- `lib/git/gitInspect.ts` — Repo state inspection (worktree-safe via `git rev-parse --git-path`)
- `lib/git/gitStateEngine.ts` — Action evaluation (blockers/warnings/recovery) + execution engine
- `components/GitPanel.tsx` — State-aware git panel with operation banners and pull dropdown
- `components/GitActionDialog.tsx` — Blocked-action modal with recovery options
- `components/BranchManager.tsx` — Pre-switch validation with `git switch`
- `components/DiffViewer.tsx` — Unified diff viewer (working/staged)
- `app/api/git/route.ts` — All actions routed through state engine; evaluate endpoint

## Artifacts & Trust (Phase 4)
- `components/ArtifactPanel.tsx` — Plans, walkthroughs, reports
- `components/AuditLogViewer.tsx` — Filterable audit timeline
- `app/api/artifacts/route.ts` / `app/api/audit/route.ts`

## Authentication (Phase 5)
- `lib/auth.ts` — Pluggable auth (AUTH_MODE: none/iap/oauth)
- `app/api/auth/route.ts` — User session endpoint

## Code Quality (Phase 6)
- `lib/hooks/useConfig.ts` — Config management
- `lib/hooks/useToasts.ts` — Toast notifications
- `components/ErrorBoundary.tsx` — React error boundary + audit

## Security
- API keys are stored in local encrypted secret storage, never in project files or browser-visible config.
- Vertex AI remains available through `@google/genai` with ADC auth.
- Local Ollama runs through the OpenAI-compatible endpoint.
- **AUTH_MODE** env var for authentication mode
- Path traversal protection in executor
- Command safety classification (safe/write/destructive/blocked)
- Destructive commands require approval
- All operations logged to append-only audit JSONL

## Multi-Stage Agent Orchestration (Phase 7)
- `lib/agent/orchestrator.ts` — Manager: classifies complexity, selects stages, manages recovery
- `lib/agent/stages.ts` — 10 specialist roles with focused prompts and soft turn budgets
- Stages: Intent → Scout → Strategy → Plan → Implement → Build → Browser QA → Critic → Repair → Release
- Complexity classification: simple (3 stages), moderate (5 stages), complex (9 stages)
- Recovery loop: Critic can trigger repair, max 2 recovery cycles
- Execution Governance: Heuristic stagnation detection and pause/resume checkpoints.
- Stage pipeline UI: colored pills with live status indicators in TaskPanel
- Backward compatible: `orchestrated: true` param enables multi-stage, omit for legacy single-agent

## Changelog

- 2026-06-22: Added built-in Ponytail prompt rules for chat and agent mode, including request commands for Ponytail mode, review, audit, debt, gain, and help.
- 2026-06-22: Added Ollama local model availability checks in setup/settings and a read-only codebase audit stage for large existing folders.
- 2026-06-22: QA/polish pass: added Agent quick-start task buttons, made browser-session stop idempotent, fixed nested project Git detection, hardened file/preview/reveal path handling, and verified with a `.orbitcode/qa-workspace` smoke project.
- 2026-06-22: Representative project smoke test fixed IDE project-open file-tree loading and preview handling for root-style public asset paths.
- 2026-06-22: Human-style GUI smoke test fixed manual HTML file preview targeting so explorer-opened pages update the preview panel.
- 2026-06-22: Monthey crop-intel GUI smoke test added iframe navigation awareness to PreviewPanel and keyboard/ARIA activation to file tree rows.
- 2026-06-22: Monthey GUI hardening added keyboard/ARIA activation to dashboard project cards and removed same-origin preview sandboxing via a minimal postMessage location bridge.
- 2026-06-22: Secondary IDE panel smoke test restored visible Audit Log rendering and made the Agent Browser toolbar button open/focus the live browser tab.
- 2026-06-22: Agent/provider smoke test made provider connection tests reject empty model output, hardened executor/git path handling, and added `.orbitcode/` to new project git ignores.
- 2026-06-22: Added `scripts/orbitcode-smoke.mjs` to repeat the Monthey project API, Git, preview, GUI, optional provider, and optional agent smoke checks against a running OrbitCode server.
- 2026-06-22: Lint noise reduced by removing dead UI imports/components, deleting unused QA temporaries, and disabling image/effect rules that were noisy for local screenshots and fetch-on-mount panels.
- 2026-06-22: Turbopack output tracing excludes generated workspaces/source artifacts, and Monthey GUI verification now includes in-app-browser screenshot evidence.
- 2026-05-16: Completed OrbitCode adaptation, removed legacy corporate branding, added beginner mode, introduced pluggable provider architecture, added MemPalace-backed memory service, moved storage to `.orbitcode` with legacy local-data fallback, and replaced the launcher with a local-first single-file Windows script.
- 2026-05-16: Launcher now silently installs `uv` and MemPalace when missing; Ollama remains opt-in with UI prompts because local model downloads can be large.

- 2026-04-15: Default mode changed to Agent (agent-first UX)
- 2026-04-15: Agent turn limit raised from 25 to 50, now configurable via `maxAgentTurns`
- 2026-04-15: Rich limit exhaustion report — shows completed actions, files, commands, and next steps
- 2026-04-15: Legacy corporate design system injected into agent system prompt
- 2026-04-15: Agent instructed to maintain AGENTS.md changelog for meaningful changes
- 2026-04-15: File explorer context menu with "Open in Terminal" and "Reveal in File Explorer"
- 2026-04-15: AI-powered commit message autofill in GitPanel
- 2026-04-15: Session summary export for collaboration artifacts
- 2026-04-15: Agent API rate limiting (max 5 concurrent runs, 429 on overflow)
- 2026-04-15: Brain API accepts both `projectPath` and `project` params, returns empty array instead of 404
- 2026-04-15: Audit JSONL confirmed persistent across restarts (no in-memory cache)
- 2026-04-15: UI Polish — sidebar width increased to 280px, overflow/ellipsis protection across all text
- 2026-04-15: Git panel layout reworked — vertical commit stack, CSS-class-based overflow, remote URL tooltips
- 2026-04-15: Toolbar brand overflow protection with max-width and ellipsis
- 2026-04-15: Status bar overflow protection with flex-shrink and text truncation
- 2026-04-15: Multi-stage agent orchestration engine (orchestrator.ts + stages.ts)
- 2026-04-15: 10 specialist stages: Intent, Scout, Strategy, Plan, Implement, Build, Browser QA, Critic, Repair, Release
- 2026-04-15: Task complexity classification (simple/moderate/complex) → selective stage invocation
- 2026-04-15: Stage pipeline UI in TaskPanel — colored pills with spinner/check/X status indicators
- 2026-04-15: Agent API route supports `orchestrated: true` for multi-stage mode
- 2026-04-15: SSE events extended with run_paused, checkpointState, stage results
- 2026-04-15: Execution Governance: Replaced hard turn caps with heuristic stagnation detection loops and graceful pause/resume.
- 2026-04-15: Native image rendering support added to PreviewPanel.
- 2026-04-15: PNG Logo routing fix via `public/` directory fallback in the preview API relative routing.
- 2026-04-15: Always-on Policy / Compliance Layer configured in `policy.ts`, explicitly validated by the Critic stage.
- 2026-04-15: Stage-Aware Completion Gating implemented inside the Vertex executor loop, rejecting premature `task_complete` requests.
- 2026-04-15: Reveal in File Explorer rewritten — dedicated `/api/reveal` endpoint with cross-platform OS support (Win/Mac/Linux) and explorer.exe exit code fix.
- 2026-04-15: Image preview pipeline overhaul — `openFile()` detects image extensions, bypasses `/api/files`, renders via native `<img>` with checkerboard transparency background.
- 2026-04-15: `isImage` flag added to `OpenFile` interface for clean editor/image routing.
- 2026-04-15: Playwright browser subagent (`browserRunner.ts`) — headless Chromium automation with live screenshot streaming via SSE.
- 2026-04-15: `run_browser_test` tool added — agent can execute Playwright scripts against live pages.
- 2026-04-15: `git_action` tool added — agent can diff, commit, and push via structured tool calls.
- 2026-04-15: `gcp_action` tool added — agent can deploy to Cloud Run via `gcloud` CLI.
- 2026-04-15: `gitSync` orchestrator stage — auto-injected when user intent contains git/push/commit keywords.
- 2026-04-15: `gcpDeploy` orchestrator stage — auto-injected when user intent contains deploy/gcp/cloud-run keywords.
- 2026-04-15: `selectStages()` now accepts user intent for dynamic stage injection beyond complexity classification.
- 2026-04-15: TaskPanel updated with `Monitor`, `GitMerge`, `CloudUpload` icons and `browser_screenshot` inline rendering.
- 2026-04-15: Tool registry expanded from 8 to 11 tools; safety classifications updated for new tool categories.
- 2026-04-15: README.md fully rewritten to document all Phase 1–8 capabilities, 12-stage orchestrator, and 11 agent tools.
- 2026-04-16: `diagnose` orchestrator stage added — dedicated to debugging, reviewing evidence, and proposing fixes before repair.
- 2026-04-16: Orchestrator routing updated: Bug/fix intents trigger diagnose → implement pipeline. Critic/BrowserQA failures trigger diagnosis recovery loop.
- 2026-04-16: `browserRunner.ts` fully rewritten to support step-by-step state streaming, URL tracking, console/error capture, and interactive pause/resume controls.
- 2026-04-16: `AgentBrowserPanel.tsx` created — live browser observation panel with 4 tabs: Viewport (live screenshot), Steps (timeline), Logs, and Screenshots gallery.
- 2026-04-16: `/api/browser-session` endpoint added to allow frontend polling and control of headless Playwright sessions.
- 2026-04-16: TaskPanel timeline updated to render `browser_step` events with inline screenshot thumbnails.
- 2026-04-24: **RELIABILITY REMEDIATION** — Windows-safe command execution: shell changed from `cmd.exe` to `powershell.exe` with `-NoProfile -NonInteractive` flags.
- 2026-04-24: Command sanitizer added to `executor.ts` — auto-translates Linux commands (pkill, lsof, mkdir -p, export, &&) to PowerShell equivalents.
- 2026-04-24: OS awareness injected into agent system prompt — agent now receives platform-specific shell guidance.
- 2026-04-24: Tailwind CSS v4 configuration rules added to system prompt and implement/build stage prompts.
- 2026-04-24: Frontend/backend integration rules added — prevents hardcoded localhost URLs, enforces Vite proxy configuration.
- 2026-04-24: **BUILD TRUTHFULNESS** — orchestrator now validates build stage output for failure patterns (npm errors, PostCSS failures, syntax errors, non-zero exit codes).
- 2026-04-24: **BROWSER QA TRUTHFULNESS** — orchestrator validates browserQa output for failure patterns (Vite overlay, 404/500, HTML-as-JSON, blank page, console errors).
- 2026-04-24: Hard stage gates: build and browserQa failures now route to Diagnosis→Repair instead of silently continuing.
- 2026-04-24: Turn budget exhaustion now marks stage as FAILED (was incorrectly marking as 'complete').
- 2026-04-24: Build stage completion validator now checks for non-zero exit codes in command history.
- 2026-04-24: **PROCESS ISOLATION** — `processRegistry.ts` added to track spawned child processes per project.
- 2026-04-24: Orchestrator kills previous project processes before starting new runs.
- 2026-04-24: Browser sessions now project-keyed (Map instead of singleton) for session isolation.
- 2026-04-24: **APPROVAL SAFETY** — Removed auto-approve for delete_file operations. All destructive ops now blocked until explicit approval.
- 2026-04-24: Git commit action refactored for platform safety — sequential `git add` then `git commit` instead of `&&` chaining.
- 2026-04-24: **RUN PERSISTENCE** — All orchestrator runs now saved to `.orbitcode/runs/{taskId}/manifest.json` with intent, verdict, stages, and timing.
- 2026-04-24: Run history API enhanced to detect task runs (intent/verdict/complexity) vs browser runs vs diagnosis runs.
- 2026-04-24: Release stage prompt enforces honest verdicts — FAIL if build/QA/critic stages had issues.
- 2026-04-24: Critic stage prompt enhanced with specific PostCSS, proxy, asset, and localhost validation checks.
- 2026-04-24: Orchestrator final summary now distinguishes "Task Complete" from "Task Completed with Issues".
- 2026-04-24: **SSE CRASH FIX** — `send()` in agent route now guards against closed ReadableStream controller, preventing cascading `ERR_INVALID_STATE` crashes.
- 2026-04-24: **COMPLEXITY RECLASSIFICATION** — App creation intents (build/create + app/website/dashboard) now routed to `complex` pipeline to ensure build+browserQa run.
- 2026-04-24: `moderate` pipeline now includes `build` stage (was skipping install/compile entirely).
- 2026-04-24: Browser session teardown changed from DELETE to POST with `action: stop` (matches API contract).
- 2026-04-24: `DELETE /api/agent` endpoint added for project-scoped process cleanup during teardown.
- 2026-04-24: TaskPanel checkpoint card now correctly labels `approval_required` vs `stagnation` vs budget exhaustion.
- 2026-04-24: `tsconfig.json` excludes workspace directory `s/` — generated project files no longer break OG builds.
- 2026-04-24: Text input during paused plan now aborts old plan and starts fresh request (prevents unintentional auto-resume).
- 2026-04-24: **E2E VALIDATED** — Full product flow tested: project creation → app build → approval → testing → modification → run persistence → isolation.
- 2026-04-24: **CANONICAL STARTER TEMPLATES** — `lib/agent/starterTemplates.ts` provides exact known-good file contents for React+Vite+Tailwind v4 projects.
- 2026-04-24: **TAILWIND V4 ROOT CAUSE FIX** — Agent now uses CSS `@theme` directive for custom colors instead of silently-ignored `tailwind.config.js extend.colors`.
- 2026-04-24: Implement stage prompt injects full canonical template with exact file contents — no model guessing.
- 2026-04-24: Base system prompt (vertex.ts) now contains explicit `@theme` CSS snippet with design tokens.
- 2026-04-24: **VISUAL BROWSER QA** — `lib/agent/visualQa.ts` adds Playwright-based visual QA with 10 element-specific checks.
- 2026-04-24: `run_visual_qa` tool added — agent can trigger automated visual verification during browserQa stage.
- 2026-04-24: Visual QA checks: page load, not blank, no error overlay, CSS loaded, layout elements, images, header styling, layout not collapsed, console errors.
- 2026-04-24: Browser QA stage prompt rewritten to mandate visual QA tool before functional checks.
- 2026-04-24: Orchestrator verdict gates now detect visual QA failures (QA_FAIL, ❌ check markers).
- 2026-04-24: **PROCESS CLEANUP IMPROVED** — per-run tracking, auto-pruning (60s), folder-based orphan sweep with logging.
- 2026-04-24: Post-build/browserQa stage cleanup kills orphan dev servers automatically.
- 2026-04-24: Tool registry expanded from 12 to 13 tools with `run_visual_qa`.
- 2026-04-24: **PRE-COMPLETION INTEGRITY CHECK** — `lib/agent/preCompletionCheck.ts` scans all JS/TS/JSX/TSX imports before allowing task_complete. Handles extensionless imports, index files, @/ aliases, dynamic imports, and asset references.
- 2026-04-24: **POST-BUILD VERIFICATION GATE** — `lib/agent/postBuildVerify.ts` starts dev server, runs HTTP + visual QA, kills server. Produces structured pass/fail with evidence.
- 2026-04-24: **NO FALSE SUCCESS** — `vertex.ts` universal completion gate blocks task_complete when pre-completion check finds broken imports/assets. Applies to both single-agent and orchestrated modes.
- 2026-04-24: **SINGLE-AGENT VERIFICATION** — `route.ts` runs post-build verification after single-agent completion. If verification fails, final SSE event is `error` (not `complete`).
- 2026-04-24: **PATCH /api/agent** — API-driven approval-resume endpoint. Enforces: only paused runs, specific taskId, idempotent (409 on re-approve), action=approve only.
- 2026-04-24: **EVIDENCE PERSISTENCE** — All verification results (pre-check, build verify, visual QA, screenshots) saved to `.orbitcode/runs/{taskId}/verification_evidence.json`.
- 2026-04-24: **DEPLOYMENT SMOKE TEST** — `postBuildVerify.ts` includes `runDeploymentSmokeTest()` with auth-protected URL detection (401/403/Google Sign-In redirect reported as "blocked by auth").
- 2026-04-24: **COPY_ASSET TOOL** — `copy_asset` tool added to executor.ts for bundled binary assets.
- 2026-04-24: `copyAssetTool` registered in tools.ts and classified as SAFE.
- 2026-04-24: Starter template and system prompt updated to instruct agent to use `copy_asset` instead of `create_file` for logos/icons.
- 2026-04-24: **AUTO-PROCESS CLEANUP** — `killProjectProcesses()` now runs automatically in the `finally` block of every POST and PATCH agent run. Kills all agent-spawned dev servers on run completion.
- 2026-04-24: Pre-completion check debug logging added for traceability (projectDir, result, blocking decisions).
- 2026-04-24: README.md fully rewritten with Trust Gates section, pre-completion checks, post-build verification, approval/resume, visual QA, process cleanup, and known limitations.
- 2026-04-24: `.gitignore` updated — broader patterns for test scripts, validation reports, and temp artifacts.
- 2026-04-24: Stale files removed: `public/test-logo.html`, temp test scripts, old report artifacts.
- 2026-04-24: Tool registry expanded from 14 to 15 tools with `copy_asset`.
- 2026-04-24: **E2E VALIDATED** — Fresh project → build → pre-check gate → post-build verify PASS → modification cycle → re-verify PASS. Logo renders correctly, process count stable.
- 2026-04-25: **ROUTE COVERAGE QA** — `lib/agent/routeCoverageQa.ts` added. Post-build verification now discovers and tests every declared route in generated apps.
- 2026-04-25: Route discovery from both React Router source files (App.jsx/tsx `<Route path>`) and DOM nav links.
- 2026-04-25: Per-route content completeness checks: meaningful content (≥30 chars), not placeholder, has semantic elements, content area not collapsed.
- 2026-04-25: **SIDEBAR-ONLY PAGES NOW FAIL** — Pages rendering only sidebar/header/nav with no main content area fail completeness QA.
- 2026-04-25: Placeholder text detection: "coming soon", "todo", "lorem ipsum", "placeholder", "under construction", etc.
- 2026-04-25: Route coverage integrated into `postBuildVerify.ts` — runs after homepage visual QA, failures prevent PASS.
- 2026-04-25: Verdicts: COVERAGE_PASS (all routes pass), COVERAGE_PARTIAL (some fail → build FAILS), COVERAGE_FAIL (all fail → build FAILS).
- 2026-04-25: Per-route screenshots saved to `.orbitcode/screenshots/route_qa_*.png`.
- 2026-04-25: Route coverage results persisted in `verification_evidence.json` with per-route scorecard.
- 2026-04-25: `stages.ts` browserQa prompt updated — agent instructed to test EVERY route, not just homepage. Turn budget increased to 20.
- 2026-04-25: README.md updated with Route Coverage QA documentation, check table, and verdict levels.
- 2026-04-25: **E2E VALIDATED** — 3-phase test: clean build 3/3 PASS → sabotage (placeholder + blank) → FAIL detected → fix → 3/3 PASS again.
- 2026-04-27: **GIT STATE ENGINE** — `lib/git/gitInspect.ts` + `lib/git/gitStateEngine.ts` — reusable state-engine that all git actions route through.
- 2026-04-27: `inspectRepoState()` detects 17+ states: dirty tree, diverged, merge/rebase/cherry-pick in progress, detached HEAD, lock files, no upstream, no remote, stash count.
- 2026-04-27: Uses `git rev-parse --git-path` for worktree-safe file detection (not raw `.git/` access).
- 2026-04-27: `evaluateAction()` — pure function mapping RepoState × GitAction to plain-English summary, blockers, warnings, and recovery actions.
- 2026-04-27: `executeAction()` — handles 18+ actions with partial-success reporting (e.g., stash-and-pull where stash pop creates conflicts).
- 2026-04-27: `classifyGitError()` — categorizes raw git stderr into known error types (auth_failed, non_fast_forward, would_overwrite, conflict, etc.).
- 2026-04-27: `git switch` used for branch switching instead of `git checkout`.
- 2026-04-27: Default pull strategy changed from `--rebase` to `--no-rebase` (merge). Rebase offered as secondary option via UI dropdown.
- 2026-04-27: **GIT API REFACTOR** — `app/api/git/route.ts` rewritten to route all POST actions through the state engine.
- 2026-04-27: New API endpoints: `GET ?action=state` (full RepoState), `POST action=evaluate` (pre-flight check without execution).
- 2026-04-27: Blocked actions return `{ blocked: true, evaluation: {...} }` instead of raw errors.
- 2026-04-27: Composite actions: stash-and-pull, publish-branch, continue/abort rebase/merge, remove-lock, sync (fetch+pull+push).
- 2026-04-27: **GIT PANEL REWRITE** — `components/GitPanel.tsx` — state-aware panel with operation banners, pull dropdown, state message bar.
- 2026-04-27: **GitActionDialog** — `components/GitActionDialog.tsx` — modal for blocked actions with recovery action buttons, risk coloring, and collapsible technical details.
- 2026-04-27: Destructive recovery actions (discard all changes) require double-click confirmation.
- 2026-04-27: **BranchManager** updated — pre-switch validation via evaluateAction, stash/commit/discard dialog, `git switch` on backend.
- 2026-04-27: **StatusBar** enriched — merge/rebase in-progress indicators, conflict count, diverged state.
- 2026-04-27: Background auto-fetch on project open (throttled, 2s delay, non-blocking) for accurate ahead/behind counts.
- 2026-04-27: Named stashes: "OG auto-stash before pull - {timestamp}" for user identification.
- 2026-04-27: Safe fallback for unknown git states and unclassified errors.
- 2026-04-27: Git state types added to `lib/types.ts`: RepoState, ActionEvaluation, RecoveryAction, GitAction, FileChange, ActionResult.
