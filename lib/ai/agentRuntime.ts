import type { AgentTurn, ToolExecutor } from '@/lib/agent/vertex';
import { createAiProviderClient } from './providerClient';
import { toolsFromGoogleDeclarations } from './toolSchemas';
import type { AiMessage, AiModelConfig } from './types';

export async function* executeAgentWithProvider(
  config: AiModelConfig,
  userMessage: string,
  systemInstruction: string,
  toolExecutor: ToolExecutor,
  maxTurns: number = 50,
  stageName?: string,
): AsyncGenerator<AgentTurn> {
  const client = createAiProviderClient(config);
  const tools = toolsFromGoogleDeclarations();
  const messages: AiMessage[] = [{ role: 'user', content: userMessage }];

  const completedActions: string[] = [];
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  const commandsRun: string[] = [];
  const callHistory: string[] = [];
  let identicalCallCount = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    yield { type: 'thinking', content: `Agent execution (${turn + 1}/${maxTurns})` };

    try {
      const response = await client.complete({
        messages,
        systemInstruction,
        tools,
        temperature: config.temperature ?? 0.2,
        maxOutputTokens: config.maxOutputTokens ?? 65536,
      });

      if (response.text) {
        yield { type: 'text', content: response.text };
      }

      if (response.toolCalls.length === 0) {
        yield { type: 'complete', content: response.text || 'Task complete.' };
        return;
      }

      const executionFingerprint = JSON.stringify(response.toolCalls.map((call) => ({ name: call.name, args: call.args })));
      if (callHistory.includes(executionFingerprint)) identicalCallCount++;
      else {
        identicalCallCount = 0;
        callHistory.push(executionFingerprint);
      }

      if (identicalCallCount >= 4) {
        yield {
          type: 'paused',
          content: 'Execution paused due to stagnation (repeated the exact same actions multiple times without progress).',
          checkpointData: {
            reason: 'stagnation',
            detail: `Stuck repeating: ${response.toolCalls.map((call) => call.name).join(', ')}`,
            completedActions,
            filesCreated,
            filesModified,
            commandsRun,
          },
        };
        return;
      }

      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const regularCalls = response.toolCalls.filter((call) => call.name !== 'task_complete');
      const taskCompleteCalls = response.toolCalls.filter((call) => call.name === 'task_complete');

      for (const call of regularCalls) {
        const args = call.args || {};
        yield {
          type: 'tool_call',
          content: `Executing ${call.name}(${JSON.stringify(args).substring(0, 200)}...)`,
          toolName: call.name,
          toolArgs: args,
        };

        if (call.name === 'create_file') {
          filesCreated.push(String(args.path || 'unknown'));
          completedActions.push(`Created file: ${args.path}`);
        } else if (call.name === 'edit_file') {
          filesModified.push(String(args.path || 'unknown'));
          completedActions.push(`Edited file: ${args.path}`);
        } else if (call.name === 'run_command') {
          const command = String(args.command || '').substring(0, 80);
          commandsRun.push(command);
          completedActions.push(`Ran: ${command}`);
        }

        try {
          const result = await toolExecutor(call.name, args);
          yield {
            type: 'tool_result',
            content: result.substring(0, 500),
            toolName: call.name,
            toolResult: result,
          };
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: result,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Tool execution failed';
          if (errMsg.includes('PAUSE_FOR_APPROVAL')) {
            yield {
              type: 'paused',
              content: 'Agent is waiting for your input...',
              toolName: call.name,
              checkpointData: {
                reason: 'approval_required',
                completedActions,
                filesCreated,
                filesModified,
                commandsRun,
                toolName: call.name,
                args,
              },
            };
            return;
          }
          yield {
            type: 'tool_result',
            content: `ERROR: ${errMsg}`,
            toolName: call.name,
            toolResult: `ERROR: ${errMsg}`,
          };
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: `ERROR: ${errMsg}`,
          });
        }
      }

      if (taskCompleteCalls.length > 0) {
        const summary = String(taskCompleteCalls[0].args.summary || 'Task complete.');
        let completionError: string | null = null;

        if ((stageName === 'implement' || stageName === 'build') && filesCreated.length === 0 && filesModified.length === 0 && commandsRun.length === 0) {
          completionError = 'Completion rejected: this stage must make or verify concrete changes before task_complete.';
        }

        if (!completionError) {
          try {
            const projectFolder = (globalThis as Record<string, unknown>).__og_current_project_folder as string | undefined;
            if (projectFolder) {
              const { runPreCompletionCheck } = await import('@/lib/agent/preCompletionCheck');
              const check = await runPreCompletionCheck(projectFolder);
              if (!check.pass) completionError = `Completion rejected by pre-completion check:\n${check.errors.join('\n')}`;
            }
          } catch {
            // Pre-completion checks are best effort for non-app projects.
          }
        }

        if (completionError) {
          messages.push({
            role: 'tool',
            toolCallId: taskCompleteCalls[0].id,
            toolName: 'task_complete',
            content: completionError,
          });
          yield { type: 'tool_result', content: completionError, toolName: 'task_complete', toolResult: completionError };
          continue;
        }

        yield { type: 'complete', content: summary };
        return;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Agent error';
      yield { type: 'error', content: msg };
      return;
    }
  }

  yield {
    type: 'paused',
    content: 'Execution paused because the agent reached the turn limit.',
    checkpointData: {
      reason: 'turn_limit',
      completedActions,
      filesCreated,
      filesModified,
      commandsRun,
    },
  };
}
