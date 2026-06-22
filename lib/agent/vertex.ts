/* OrbitCode — Vertex AI Integration Layer
 *
 * SECURITY: Uses Vertex AI through GCP IAM + Application Default Credentials.
 * NO API KEYS. Authentication is via Service Account or `gcloud auth application-default login`.
 *
 * Model is configurable via GEMINI_MODEL env var (default: gemini-2.5-flash).
 */

import { GoogleGenAI, type Content, type Part, type FunctionCall, type GenerateContentResponse } from '@google/genai';
import { ALL_TOOLS } from './tools';
import { ORBITCODE_POLICY } from './policy';
import { PONYTAIL_SYSTEM_INSTRUCTION } from './ponytail';
import { executeAgentWithProvider } from '@/lib/ai/agentRuntime';
import { resolveModelConfig } from '@/lib/ai/providerStore';
import type { AiModelConfig } from '@/lib/ai/types';

// ════════════════════════════════════════════
//  Configuration
// ════════════════════════════════════════════
const DEFAULT_MODEL = 'gemini-2.5-flash';

export interface VertexConfig extends Partial<AiModelConfig> {
  gcpProject?: string;
  gcpRegion?: string;
  selectedProviderId?: string;
  selectedModel?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Available models in the registry */
export const MODEL_REGISTRY = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and efficient, great for coding tasks', default: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable, best for complex reasoning', default: false },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Previous generation, stable', default: false },
];

// ════════════════════════════════════════════
//  Client initialization (Vertex AI mode — no API keys)
// ════════════════════════════════════════════
function createClient(config: VertexConfig): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: config.gcpProject || '',
    location: config.gcpRegion || 'us-central1',
  });
}

function getModelId(config: VertexConfig): string {
  return process.env.GEMINI_MODEL || config.model || DEFAULT_MODEL;
}

// ════════════════════════════════════════════
//  System instruction for agent mode
// ════════════════════════════════════════════
export function buildAgentSystemInstruction(projectContext?: string): string {
  return [
    'You are OrbitCode, an autonomous AI software engineering agent.',
    'You work inside a coding IDE with full access to the project filesystem and terminal.',
    '',
    '## Your Capabilities',
    'You have the following tools available:',
    '- create_file: Create or overwrite files in the project',
    '- edit_file: Edit specific parts of existing files (search-and-replace)',
    '- read_file: Read the contents of a file',
    '- delete_file: Delete a file or directory (requires approval)',
    '- run_command: Execute shell commands (install deps, run tests, start servers)',
    '- list_files: List directory contents',
    '- search_files: Search for text across the project',
    '- copy_asset: Copy canonical design assets (logos, icons) as real binary files — use instead of create_file for images',
    '- task_complete: Signal that your work is done',
    '',
    '## How You Work',
    '1. UNDERSTAND: Analyze the user request and current project state.',
    '2. PLAN: Think through what needs to be done, step by step. Plan the FULL architecture BEFORE writing code.',
    '3. EXECUTE: Use your tools to make changes. Create files, edit code, run commands.',
    '4. VERIFY: After making changes, ALWAYS verify they work — run the app, test endpoints, check builds.',
    '5. COMPLETE: Call task_complete with a summary when done.',
    '',
    '## Build Quality Rules (CRITICAL)',
    '- **Single entry point**: For full-stack apps, create ONE unified project structure. Do NOT create duplicate files (e.g., two main.py files).',
    '- **Dockerfile must serve the FULL app**: If you create a frontend + backend, the Dockerfile MUST build the frontend, copy static assets, AND run the backend. Never deploy only half the app.',
    '- **No hardcoded localhost**: Frontend code must NEVER reference `http://localhost:PORT` for API calls. Use relative URLs (e.g., `/api/classify`) or environment-aware base URLs.',
    '- **Complete implementation**: If the user asks for Random Forest classification, ACTUALLY implement it with training data and prediction — not just a tile URL passthrough.',
    '- **Wire everything together**: Every file you create must be imported/used somewhere. Orphaned files (e.g., `compute_indices.py` never imported) are a build failure.',
    '- **Test after building**: After creating a full-stack app, run `python main.py` or `npm run dev` to verify it starts. Curl/test at least one endpoint.',
    '- **Verify Dockerfile**: Run `docker build .` or at minimum read the Dockerfile and trace that every COPY source exists and every imported module is in requirements.txt.',
    '',
    '## Rules',
    '- Always provide COMPLETE file contents when creating files (not partial snippets).',
    '- After creating files that need dependencies, run `pip install -r requirements.txt` or `npm install`.',
    '- After creating an app, run the dev server or tests to verify it actually starts.',
    '- If a command fails, read the error, fix the code, and retry.',
    '- Create a README.md for new projects.',
    '- Never hardcode secrets — use environment variables.',
    '- When modifying existing files, use edit_file with exact search strings.',
    '- For new projects, always create a .gitignore.',
    '- Be proactive: install deps, run builds, start servers — do not wait to be asked.',
    '',
    '## Important',
    '- Do NOT say "please run this command" — you run commands yourself via run_command.',
    '- Do NOT say "As an AI, I cannot..." — you CAN do everything via your tools.',
    '- You ARE autonomous. You write code AND run it.',
    '',
    '## Operating System',
    process.platform === 'win32' ? [
      'You are running on **Windows**. Your shell is **PowerShell**.',
      '- Do NOT use Linux/bash commands: pkill, lsof, kill, mkdir -p, export, source, bash-style &&',
      '- Instead use: Get-Process, Stop-Process, New-Item, $env:VAR, semicolons for chaining',
      '- Use PowerShell cmdlets and syntax for all terminal operations',
      '- File paths use backslashes (\\) but forward slashes (/) also work in most tools',
    ].join('\n') : 'You are running on a Unix-like system (Linux/macOS). Use bash commands.',
    '',
    '## Tailwind CSS v4 Configuration (CRITICAL — READ CAREFULLY)',
    'Tailwind v4 has BREAKING CHANGES from v3. Follow these EXACT rules:',
    '- PostCSS config MUST use `@tailwindcss/postcss` as the plugin (NOT `tailwindcss`)',
    '- Install `@tailwindcss/postcss` — do NOT install `tailwindcss` as a separate PostCSS plugin',
    '- CSS entry file: use `@import "tailwindcss"` (NOT `@tailwind base; @tailwind components; @tailwind utilities`)',
    '- **Custom colors/tokens**: define them via `@theme {}` in your CSS file, NOT in tailwind.config.js',
    '- tailwind.config.js `extend.colors` is SILENTLY IGNORED in v4 — do NOT use it for custom colors',
    '- Use kebab-case for custom color names: `--color-orbit-mint` becomes class `bg-orbit-mint`',
    '',
    'Example CSS entry file with neutral OrbitCode starter tokens:',
    '```css',
    '@import "tailwindcss";',
    '',
    '@theme {',
    '  --color-orbit-mint: #7CDA9B;',
    '  --color-orbit-sky: #72D6F3;',
    '  --color-orbit-amber: #FFD166;',
    '  --color-orbit-ink: #15181D;',
    '  --color-orbit-canvas: #F7F5EF;',
    '  --font-inter: "Inter", sans-serif;',
    '  --font-inter-tight: "Inter Tight", sans-serif;',
    '  --radius-card: 12px;',
    '  --radius-input: 8px;',
    '}',
    '```',
    'This enables classes like `bg-orbit-mint`, `text-orbit-ink`, `rounded-card`, `font-inter`.',
    '',
    '## Frontend/Backend Integration',
    '- Frontend code must NEVER reference http://localhost:PORT for API calls',
    '- Use relative URLs: fetch("/api/tasks") NOT fetch("http://localhost:5000/api/tasks")',
    '- If using Vite with a separate backend, configure `server.proxy` in vite.config',
    '',
    '## Visual Design',
    '- Do not add old corporate logos or company branding unless the user explicitly asks for it.',
    '- Use a personal, local-tool feel: calm dark surfaces, mint/sky/amber accents, clear spacing, and compact controls.',
    '- For generated apps, match the project subject and audience instead of forcing a house brand.',
    '',
    PONYTAIL_SYSTEM_INSTRUCTION,
    '',
    ORBITCODE_POLICY,
    '',
    '## AGENTS.md Changelog',
    'After making meaningful code changes, update AGENTS.md with a changelog entry:',
    '- Append to the "## Changelog" section (create it if missing)',
    '- Format: `- YYYY-MM-DD: Brief description of what changed`',
    '- Only log meaningful changes, not trivial edits',
    '',
    projectContext ? `## Current Project Files\n${projectContext}` : '',
  ].filter(Boolean).join('\n');
}

// ════════════════════════════════════════════
//  Chat-mode system instruction (simpler, for basic chat)
// ════════════════════════════════════════════
export function buildChatSystemInstruction(customInstruction: string, projectContext?: string): string {
  return [
    customInstruction,
    '',
    projectContext ? `\n--- FULL PROJECT FILES ---\n${projectContext}` : '',
    '',
    '--- FILE CREATION RULES ---',
    'When you write code, use the file path as the code block language identifier.',
    'Example: ```index.html for a file named index.html.',
    'Your code blocks will be AUTOMATICALLY saved to disk.',
    '',
    '--- COMMAND EXECUTION ---',
    'Commands in ```sh blocks are AUTOMATICALLY EXECUTED.',
    'Say "I\'ll install the dependencies" — not "please run this".',
    'You ARE autonomous. You write code AND run it.',
  ].filter(Boolean).join('\n');
}

// ════════════════════════════════════════════
//  Streaming chat (basic mode — markdown response)
// ════════════════════════════════════════════
export async function* streamChat(
  config: VertexConfig,
  messages: Array<{ role: string; content: string }>,
  systemInstruction: string,
): AsyncGenerator<{ type: 'text' | 'error' | 'done'; content: string }> {
  const client = createClient(config);
  const modelId = getModelId(config);

  try {
    const contents: Content[] = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await client.models.generateContentStream({
      model: modelId,
      contents,
      config: {
        systemInstruction,
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens ?? 65536,
      },
    });

    for await (const chunk of response) {
      if (chunk.text) {
        yield { type: 'text', content: chunk.text };
      }
    }

    yield { type: 'done', content: '' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Vertex AI error';
    yield { type: 'error', content: msg };
  }
}

// ════════════════════════════════════════════
//  Agent mode — tool-calling loop
// ════════════════════════════════════════════
export interface AgentTurn {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'error' | 'complete' | 'paused';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  checkpointData?: Record<string, unknown>;
}

export async function* runAgentLoop(
  config: VertexConfig,
  userMessage: string,
  systemInstruction: string,
  maxTurns: number = 20,
): AsyncGenerator<AgentTurn> {
  const client = createClient(config);
  const modelId = getModelId(config);

  // Build conversation history
  const contents: Content[] = [
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    yield { type: 'thinking', content: `Agent turn ${turn + 1}...` };

    try {
      const response: GenerateContentResponse = await client.models.generateContent({
        model: modelId,
        contents,
        config: {
          systemInstruction,
          temperature: 0.2, // Lower temp for tool-calling accuracy
          maxOutputTokens: config.maxTokens ?? 65536,
          tools: [{ functionDeclarations: ALL_TOOLS }],
        },
      });

      // Check for text content
      const textParts = response.candidates?.[0]?.content?.parts?.filter((p: Part) => p.text) || [];
      const text = textParts.map((p: Part) => p.text).join('');

      if (text) {
        yield { type: 'text', content: text };
      }

      // Check for function calls
      const functionCalls = response.functionCalls;
      
      if (!functionCalls || functionCalls.length === 0) {
        // No function calls — model is done (text-only response)
        yield { type: 'complete', content: text || 'Task complete.' };
        return;
      }

      // Add model response to history
      contents.push({
        role: 'model',
        parts: response.candidates?.[0]?.content?.parts || [],
      });

      // Process each function call
      for (const fc of functionCalls) {
        yield {
          type: 'tool_call',
          content: `Calling ${fc.name}...`,
          toolName: fc.name,
          toolArgs: fc.args as Record<string, unknown>,
        };

        // The actual tool execution happens in the executor layer
        // Here we yield the call and expect the executor to provide the result
        // For now, we'll break and let the executor handle it
      }

      // This generator yields tool_call events; the executor (executor.ts) 
      // will handle the execution and feed results back
      // The executor wraps this generator and injects tool results
      
      // For the self-contained agent API, we handle this differently — 
      // See executor.ts for the full loop
      return;
      
    } catch (error) {
      const err = error as { message?: unknown } | null;
      const msgRaw = err?.message;
      const msg = typeof msgRaw === 'string' ? String(msgRaw) : 'Agent error';
      yield { type: 'error', content: msg };
      return;
    }
  }

  yield { type: 'error', content: 'Agent reached maximum turn limit' };
}

// ════════════════════════════════════════════
//  Full agent execution (with tool execution)
// ════════════════════════════════════════════
export interface ToolExecutor {
  (name: string, args: Record<string, unknown>): Promise<string>;
}

export async function* executeAgentWithTools(
  config: VertexConfig,
  userMessage: string,
  systemInstruction: string,
  toolExecutor: ToolExecutor,
  maxTurns: number = 50,
  stageName?: string,
): AsyncGenerator<AgentTurn> {
  const aiConfig = await resolveModelConfig({
    ...config,
    selectedModel: config.selectedModel || config.model,
    maxOutputTokens: config.maxOutputTokens ?? config.maxTokens,
  });
  yield* executeAgentWithProvider(aiConfig, userMessage, systemInstruction, toolExecutor, maxTurns, stageName);
  return;

  const client = createClient(config);
  const modelId = getModelId(config);

  const contents: Content[] = [
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  // Track what the agent accomplished for checkpoint reporting
  const completedActions: string[] = [];
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  const commandsRun: string[] = [];
  
  // Stagnation / Loop detection
  const callHistory: string[] = [];
  let identicalCallCount = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    yield { type: 'thinking', content: `Agent execution (${turn + 1}/${maxTurns})` };

    try {
      const response = await client.models.generateContent({
        model: modelId,
        contents,
        config: {
          systemInstruction,
          temperature: 0.2,
          maxOutputTokens: config.maxTokens ?? 65536,
          tools: [{ functionDeclarations: ALL_TOOLS }],
        },
      });

      const responseParts = response.candidates?.[0]?.content?.parts || [];
      
      // Extract text
      const textParts = responseParts.filter((p: Part) => p.text);
      const text = textParts.map((p: Part) => p.text).join('');
      if (text) {
        yield { type: 'text', content: text };
      }

      // Extract function calls
      const functionCalls: FunctionCall[] = response.functionCalls || [];

      if (functionCalls.length === 0) {
        // No tools called — model is done
        yield { type: 'complete', content: text || 'Task complete.' };
        return;
      }

      // Stagnation Detection
      const executionFingerprint = JSON.stringify(functionCalls.map(f => ({ name: f.name, args: f.args })));
      if (callHistory.includes(executionFingerprint)) {
        identicalCallCount++;
      } else {
        identicalCallCount = 0; // reset if we broke the loop
        callHistory.push(executionFingerprint);
      }

      if (identicalCallCount >= 4) {
        // Slack of 4 identical repeats before we declare a stall
        yield { 
          type: 'paused', 
          content: 'Execution paused due to stagnation (repeated the exact same actions multiple times without progress).',
          checkpointData: {
            reason: 'stagnation',
            detail: `Stuck repeating: ${functionCalls.map(f => f.name).join(', ')}`,
            completedActions,
            filesCreated,
            filesModified,
            commandsRun
          }
        };
        return;
      }

      // Add model's response to conversation
      contents.push({
        role: 'model',
        parts: responseParts,
      });

      // Execute each function call and collect results
      // IMPORTANT: Defer task_complete until ALL other tools in this batch are processed
      const functionResponseParts: Part[] = [];

      // Separate task_complete from other tool calls — process it LAST
      const regularCalls = functionCalls.filter(fc => fc.name !== 'task_complete');
      const taskCompleteCalls = functionCalls.filter(fc => fc.name === 'task_complete');

      for (const fc of regularCalls) {
        const args = (fc.args || {}) as Record<string, unknown>;
        
        yield {
          type: 'tool_call',
          content: `Executing ${fc.name}(${JSON.stringify(args).substring(0, 200)}...)`,
          toolName: fc.name,
          toolArgs: args,
        };

        // Track actions for limit exhaustion reporting
        if (fc.name === 'create_file') {
          filesCreated.push(args.path as string || 'unknown');
          completedActions.push(`Created file: ${args.path}`);
        } else if (fc.name === 'edit_file') {
          filesModified.push(args.path as string || 'unknown');
          completedActions.push(`Edited file: ${args.path}`);
        } else if (fc.name === 'run_command') {
          const cmd = (args.command as string || '').substring(0, 80);
          commandsRun.push(cmd);
          completedActions.push(`Ran: ${cmd}`);
        }

        try {
          const result = await toolExecutor(fc.name!, args);
          
          yield {
            type: 'tool_result',
            content: result.substring(0, 500),
            toolName: fc.name,
            toolResult: result,
          };

          functionResponseParts.push({
            functionResponse: {
              name: fc.name!,
              response: { result },
            },
          });
        } catch (err) {
          const toolError = err as { message?: unknown } | null;
          const toolErrorMessage = toolError?.message;
          const errMsg: string = typeof toolErrorMessage === 'string' ? String(toolErrorMessage) : 'Tool execution failed';
          
          if (errMsg.includes('PAUSE_FOR_APPROVAL')) {
             yield {
               type: 'paused',
               content: 'Agent is waiting for your input...',
               toolName: fc.name,
               checkpointData: {
                 reason: 'approval_required',
                 completedActions,
                 filesCreated,
                 filesModified,
                 commandsRun,
                 toolName: fc.name,
                 args: args
               }
             };
             // Terminate generator cleanly
             return;
          }

          yield {
            type: 'tool_result',
            content: `ERROR: ${errMsg}`,
            toolName: fc.name,
            toolResult: `ERROR: ${errMsg}`,
          };

          functionResponseParts.push({
            functionResponse: {
              name: fc.name!,
              response: { error: errMsg },
            },
          });
        }
      }

      // Now handle task_complete AFTER all other tools executed
      if (taskCompleteCalls.length > 0) {
        const tcArgs = (taskCompleteCalls[0].args || {}) as Record<string, unknown>;
        const summary = (tcArgs.summary as string) || 'Task complete.';
        
        // ── COMPLETION VALIDATOR & STAGE-AWARE GATING ──
        let completionError: string | null = null;

        if (stageName === 'implement' || stageName === 'build') {
          // Verify actual work was done
          if (filesModified.length === 0 && filesCreated.length === 0 && commandsRun.length === 0) {
            completionError = '[System] Completion validation failed: no files modified or commands run. You cannot complete this stage without Implementation/Build activity. Route back to Implementation.';
          } else if (stageName === 'implement' && turn < 2) {
            completionError = '[System] Completion validation failed: insufficient implementation passes. Validate complex tasks completely before closing the implementation stage.';
          }
          
          // Check if any command returned a non-zero exit code
          const failedCommands = commandsRun.filter(() => {
            // Find the corresponding tool_result for this command
            const correspondingResults = contents
              .filter(c => c.role === 'user')
              .flatMap(c => c.parts)
              .filter((p): p is Part => !!p && !!p.functionResponse && p.functionResponse.name === 'run_command')
              .map(p => (p.functionResponse?.response as Record<string, unknown>)?.result as string || '')
              .filter(r => r.includes('Exit code:') && !r.includes('Exit code: 0'));
            return correspondingResults.length > 0;
          });
          if (failedCommands.length > 0 && stageName === 'build') {
            completionError = '[System] Completion validation failed: some commands returned non-zero exit codes. Fix the errors before completing the build stage.';
          }
        } else if (stageName === 'browserQa') {
          // Must run a command to verify UI
          if (commandsRun.length === 0) {
            completionError = '[System] Completion validation failed: Browser QA stage requires curl, ping, or node-based verification of endpoints. No verification commands were run. Routing back to QA validation.';
          }
          // Check for QA_FAIL in the summary
          if (summary.includes('QA_FAIL') || summary.includes('FAIL')) {
            // Let it through — the orchestrator will catch it via pattern detection
          }
        } else if (stageName === 'repair' && filesModified.length === 0 && commandsRun.length === 0) {
            completionError = '[System] Completion validation failed: You are in Repair mode but no code was changed and no tests were run. Complete the repair before closing the stage.';
        }

        // ── UNIVERSAL PRE-COMPLETION INTEGRITY CHECK ──
        // Runs for single-agent mode (no stageName) AND for implement/build stages
        // This catches missing imports, broken assets, and incomplete file creation
        if (!completionError && (!stageName || stageName === 'implement' || stageName === 'build')) {
          try {
            const { runPreCompletionCheck } = await import('./preCompletionCheck');
            // Extract the project folder from the conversation context
            // The project folder is passed via closure from the caller
            const projectDir = (globalThis as Record<string, unknown>).__og_current_project_folder as string;
            console.log(`[PreCompletionCheck] projectDir=${projectDir}, stageName=${stageName}`);
            if (projectDir) {
              const preCheck = await runPreCompletionCheck(projectDir);
              console.log(`[PreCompletionCheck] Result: pass=${preCheck.pass}, errors=${preCheck.errors.length}, files=${preCheck.filesScanned}, imports=${preCheck.importsChecked}`);
              if (!preCheck.pass) {
                const errorList = preCheck.errors.slice(0, 10).join('\n  - ');
                completionError = `[System] Pre-completion integrity check FAILED. The following imports/assets reference files that do not exist:\n  - ${errorList}\n\nYou MUST create these missing files before calling task_complete. Do NOT skip them.`;
                console.log(`[PreCompletionCheck] BLOCKING task_complete: ${preCheck.errors.length} errors`);
              }
            } else {
              console.warn('[PreCompletionCheck] No project folder set — skipping check');
            }
          } catch (e) {
            // Pre-completion check itself failed — log but don't block
            console.error('[PreCompletionCheck] Error running check:', e);
          }
        }

        if (completionError) {
          const rejection: string = completionError || 'Completion rejected';
          yield {
            type: 'tool_result',
            content: rejection,
            toolName: 'task_complete',
            toolResult: 'REJECTED: ' + rejection,
          };
          functionResponseParts.push({
            functionResponse: {
              name: 'task_complete',
              response: { error: 'REJECTED: ' + rejection },
            },
          });
        } else {
          // Legitimate completion — validation passed
          yield { type: 'complete', content: summary };
          return;
        }
      }

      // Add function results to conversation
      contents.push({
        role: 'user',
        parts: functionResponseParts,
      });

    } catch (error) {
      const err = error as { message?: unknown } | null;
      const msgRaw = err?.message;
      const msg = typeof msgRaw === 'string' ? String(msgRaw) : 'Agent error';
      yield { type: 'error', content: msg };
      return;
    }
  }

  // ════════════════════════════════════════════
  //  Graceful Pause (Soft Budget Exhaustion)
  // ════════════════════════════════════════════
  yield { 
    type: 'paused', 
    content: `Execution paused: Reached stage soft budget (${maxTurns} steps) while work was still ongoing.`,
    checkpointData: {
      reason: 'budget_exhausted',
      detail: `Agent exhausted the allocated stage budget but did not explicitly signal completion.`,
      completedActions,
      filesCreated,
      filesModified,
      commandsRun
    }
  };
}

