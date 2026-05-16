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
4. Checks optional tools: Ollama, Python, uv, MemPalace, and gcloud.
5. Guides local model and MemPalace setup without silently installing them.
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

On first launcher run, OrbitCode suggests local Ollama models:

- `qwen3:8b` as the fast safe default.
- `qwen3:14b` as a balanced option.
- `qwen3-coder:30b` as a higher-quality but slower/RAM-heavy option.

Ollama itself is not installed silently. Install it from [ollama.com](https://ollama.com), then rerun `start.bat`.

## Memory

OrbitCode uses MemPalace for local project memory. If MemPalace or `uv` is missing, the app shows guided setup commands only.

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

## Publishing

This project is intended to be pushed to a private GitHub repository under `lionelfragniere` once the local verification pass is complete.
