# OrbitCode

OrbitCode is a local AI coding workspace. It can read a project, write files, run safe commands, test in a browser, keep local project memory, and help with Git, while letting you choose the AI provider.

It is designed to run locally through one Windows launcher script:

```bat
start.bat
```

## OrbitCode Adaptation

- Renamed the product to OrbitCode.
- Removed old corporate branding and logos.
- Added beginner mode for simpler explanations and a less code-heavy first screen.
- Replaced the Vertex-only AI path with a provider layer.
- Added provider setup for OpenAI, Anthropic, Gemini API, Vertex AI, Ollama, and custom OpenAI-compatible endpoints.
- Moved app storage to `.orbitcode`, with a legacy read fallback for older local installs.
- Replaced Project Brain with MemPalace-backed local memory hooks and memory tools.

## Quick Start

```bat
start.bat
```

The launcher:

1. Checks Node.js, npm, and Git.
2. Installs npm dependencies if needed.
3. Installs Playwright Chromium if needed.
4. Installs the small local memory helpers `uv` and MemPalace when needed.
5. Leaves Ollama as an explicit UI choice because Ollama and model downloads can be large.
6. Starts OrbitCode at `http://localhost:3000`.

## AI Providers

OrbitCode supports:

- Ollama local models, using `http://localhost:11434/v1`.
- OpenAI via the Responses API.
- Anthropic via the Messages API.
- Gemini API.
- Vertex AI with Application Default Credentials.
- Custom OpenAI-compatible endpoints.

API keys are stored in local encrypted secret storage. On Windows, OrbitCode uses DPAPI when available. Project files and browser-visible config should contain only provider IDs and secret references, not raw keys.

## Local Models

When you choose local AI in the UI, OrbitCode suggests Ollama models:

- `qwen3:8b` as the fast safe default.
- `qwen3:14b` as a balanced option.
- `qwen3-coder:30b` as a higher-quality but slower/RAM-heavy option.

Ollama itself is not installed silently. If you choose local AI and Ollama is missing, OrbitCode shows an in-app prompt with an install link and an API-provider alternative.
Setup and Settings also check `ollama list`, show installed local models, and warn when the selected Ollama model is missing.

## Codebase Audits

Ask the agent to audit or review a codebase, repository, project, or folder to run a read-only audit pipeline. The audit stage scouts the folder, samples important files, searches for risk markers, and writes a ranked report without modifying files.

The Agent workspace also includes quick-start task buttons for common flows: audit, smallest useful improvement, and browser-verified app work.

## Local QA Notes

OrbitCode's project/file APIs are intended to work with arbitrary local folders. File, preview, and reveal endpoints keep requests inside the selected project folder, and project listing only reports Git metadata when the project folder itself is the repository root.

## Memory

OrbitCode uses MemPalace for local project memory. The launcher quietly installs `uv` and MemPalace when they are missing, using the official `uv` installer and `uv tool install mempalace`.

MemPalace can create metadata in the project and in `~/.mempalace`, so project initialization/mining should be opt-in.

Memory-backed tools:

- `memory_status`
- `memory_search`
- `memory_note`

## Beginner Mode

Beginner mode is enabled by default on first run. It:

- Opens directly to the Agent workspace.
- Keeps code-heavy panels closed by default.
- Asks the assistant to explain changes in plain language.
- Avoids low-level details unless the user asks for them.

You can change this in Settings.

## Ponytail Mode

OrbitCode includes the Ponytail rules from `DietrichGebert/ponytail` in both chat and agent prompts. The default is full: smallest working change, standard library and native platform first, no speculative abstractions.

Supported request commands include `/ponytail lite`, `/ponytail full`, `/ponytail ultra`, `/ponytail off`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, and `/ponytail-help`.

## Project Data

New local data is stored in:

- User config: `~/.orbitcode`
- Per-project runs/history: `.orbitcode`

Legacy local data is read as fallback where migration access is useful.

## Development

```bat
npm.cmd install
npm.cmd run build
npm.cmd run lint
```

Current note: `npm.cmd run build` passes. `npm.cmd run lint` still reports older lint issues in existing files that are outside the OrbitCode provider/memory rename path.

With OrbitCode running at `http://localhost:3000`, the local smoke harness checks the Monthey crop-intel project, core APIs, Git state, and the real GUI preview:

```bat
node scripts\orbitcode-smoke.mjs
```

Optional local-model checks:

```bat
set ORBITCODE_SMOKE_PROVIDER=1
set ORBITCODE_SMOKE_AGENT=1
node scripts\orbitcode-smoke.mjs
```

## Publishing

This project is intended to be pushed to a private GitHub repository under `lionelfragniere` once the local verification pass is complete.
