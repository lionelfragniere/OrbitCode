/* OrbitCode — Agent Tool Definitions
 * These provider-neutral schemas are converted for each AI backend.
 * The model decides when to call which tool based on user intent.
 */

import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';

// ════════════════════════════════════════════
//  Tool: create_file
// ════════════════════════════════════════════
export const createFileTool: FunctionDeclaration = {
  name: 'create_file',
  description:
    'Create a new file or overwrite an existing file in the project. ' +
    'Use this to generate source code, configs, docs, or any text file. ' +
    'The file will be created at the specified path relative to the project root. ' +
    'Parent directories are created automatically.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: 'File path relative to the project root (e.g., "src/index.ts", "README.md", "Dockerfile")',
      },
      content: {
        type: Type.STRING,
        description: 'The complete file content to write',
      },
      description: {
        type: Type.STRING,
        description: 'Brief description of what this file does and why it was created',
      },
    },
    required: ['path', 'content'],
  },
};

// ════════════════════════════════════════════
//  Tool: edit_file
// ════════════════════════════════════════════
export const editFileTool: FunctionDeclaration = {
  name: 'edit_file',
  description:
    'Edit an existing file by replacing a specific section of text. ' +
    'Provide the exact text to find (search) and the replacement text. ' +
    'The search string must match EXACTLY (including whitespace). ' +
    'Use read_file first to see the current content if needed.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: 'File path relative to the project root',
      },
      search: {
        type: Type.STRING,
        description: 'The exact text to find in the file (must match exactly)',
      },
      replace: {
        type: Type.STRING,
        description: 'The replacement text',
      },
      description: {
        type: Type.STRING,
        description: 'Brief description of what this edit does',
      },
    },
    required: ['path', 'search', 'replace'],
  },
};

// ════════════════════════════════════════════
//  Tool: read_file
// ════════════════════════════════════════════
export const readFileTool: FunctionDeclaration = {
  name: 'read_file',
  description:
    'Read the contents of a file. Returns the full text content. ' +
    'Use this before editing to ensure your search string is exact.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: 'File path relative to the project root',
      },
    },
    required: ['path'],
  },
};

// ════════════════════════════════════════════
//  Tool: delete_file
// ════════════════════════════════════════════
export const deleteFileTool: FunctionDeclaration = {
  name: 'delete_file',
  description:
    'Delete a file or directory from the project. ' +
    'This is a destructive operation and will require user approval. ' +
    'Use with caution.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: 'File or directory path relative to the project root',
      },
      reason: {
        type: Type.STRING,
        description: 'Why this file should be deleted',
      },
    },
    required: ['path'],
  },
};

// ════════════════════════════════════════════
//  Tool: run_command
// ════════════════════════════════════════════
export const runCommandTool: FunctionDeclaration = {
  name: 'run_command',
  description:
    'Execute a shell command in the project directory. ' +
    'Use this to install dependencies (npm install), run builds, ' +
    'start dev servers, run tests, or any CLI operation. ' +
    'The command runs in the project root directory. ' +
    'Destructive commands (rm, del, format, drop) will require approval.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: 'The shell command to execute (e.g., "npm install", "npm test", "python app.py")',
      },
      description: {
        type: Type.STRING,
        description: 'What this command does and why it is needed',
      },
      wait_for_exit: {
        type: Type.BOOLEAN,
        description: 'Whether to wait for the command to finish (default true). Set false for long-running processes like dev servers.',
      },
    },
    required: ['command'],
  },
};

// ════════════════════════════════════════════
//  Tool: list_files
// ════════════════════════════════════════════
export const listFilesTool: FunctionDeclaration = {
  name: 'list_files',
  description:
    'List files and directories in the project or a subdirectory. ' +
    'Returns a tree structure with file names, paths, and sizes. ' +
    'Use this to understand the project structure.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: 'Directory path relative to project root. Omit or use "." for project root.',
      },
    },
  },
};

// ════════════════════════════════════════════
//  Tool: search_files
// ════════════════════════════════════════════
export const searchFilesTool: FunctionDeclaration = {
  name: 'search_files',
  description:
    'Search for text content across files in the project. ' +
    'Returns matching file paths and line content. ' +
    'Useful for finding where something is defined or used.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The text or pattern to search for',
      },
      path: {
        type: Type.STRING,
        description: 'Directory to search in (relative to project root). Omit for entire project.',
      },
      file_pattern: {
        type: Type.STRING,
        description: 'File pattern to filter (e.g., "*.ts", "*.py"). Omit to search all text files.',
      },
    },
    required: ['query'],
  },
};

// ════════════════════════════════════════════
//  Tool: task_complete
// ════════════════════════════════════════════
export const taskCompleteTool: FunctionDeclaration = {
  name: 'task_complete',
  description:
    'Signal that the current task is complete. ' +
    'Call this when all requested work has been done. ' +
    'Provide a structured summary of outcomes to surface as a Result Card.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      summary: {
        type: Type.STRING,
        description: 'High-level summary of what was accomplished',
      },
      verdict: {
        type: Type.STRING,
        description: 'Short pass/fail/completed status (e.g., "Deployed Successfully", "Bug Fixed", "Deployment Failed")',
      },
      files_created: {
        type: Type.ARRAY,
        description: 'List of files that were created',
        items: { type: Type.STRING },
      },
      files_modified: {
        type: Type.ARRAY,
        description: 'List of files that were modified',
        items: { type: Type.STRING },
      },
      commands_run: {
        type: Type.ARRAY,
        description: 'List of commands that were executed',
        items: { type: Type.STRING },
      },
      links: {
        type: Type.ARRAY,
        description: 'Array of relevant links generated (e.g. preview deployment URL, PR link, etc.)',
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            url: { type: Type.STRING },
          },
          required: ['label', 'url'],
        },
      },
      next_steps: {
        type: Type.STRING,
        description: 'Suggested next steps or improvements',
      },
    },
    required: ['summary', 'verdict'],
  },
};

// ════════════════════════════════════════════
//  Tool: propose_plan
// ════════════════════════════════════════════
export const proposePlanTool: FunctionDeclaration = {
  name: 'propose_plan',
  description:
    'Propose an implementation plan to the user. ' +
    'This pauses execution and asks the user for explicit approval before proceeding. ' +
    'Use this during the planning stage or before massive architectural changes.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      goal: {
        type: Type.STRING,
        description: 'A summary of the overall goal of the plan',
      },
      task_breakdown: {
        type: Type.ARRAY,
        description: 'Ordered list of steps to accomplish the goal',
        items: { type: Type.STRING },
      },
      acceptance_criteria: {
        type: Type.ARRAY,
        description: 'List of criteria that define success for this plan',
        items: { type: Type.STRING },
      },
    },
    required: ['goal', 'task_breakdown', 'acceptance_criteria'],
  },
};

// ════════════════════════════════════════════
//  Tool: ask_decision
// ════════════════════════════════════════════
export const askDecisionTool: FunctionDeclaration = {
  name: 'ask_decision',
  description:
    'Ask the user to make a decision or provide approval to proceed. ' +
    'This pauses execution. Use this before deploying, git pushes, destructive changes, ' +
    'or when requirements are ambiguous. Every option must be a real, plain-language action. ' +
    'Never use placeholders like "Option 1", "Option 2", or "Required Decision".',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Short plain-language title of the decision (e.g., "Choose the workout app style"). Do not use generic titles.',
      },
      description: {
        type: Type.STRING,
        description: 'A useful explanation of what the user is deciding and what happens next.',
      },
      options: {
        type: Type.ARRAY,
        description: 'Concrete choices with clear labels (e.g. ["Build the simple version first", "Ask me two setup questions", "Cancel"]). Never use Option 1 or Option 2.',
        items: { type: Type.STRING },
      },
    },
    required: ['title', 'description', 'options'],
  },
};

// ════════════════════════════════════════════
//  New Capability Tools (Browser, Git, GCP)
// ════════════════════════════════════════════

export const runBrowserTestTool: FunctionDeclaration = {
  name: 'run_browser_test',
  description: 'Execute a Playwright browser automation script. You are provided with `page` (Playwright Page), `emitProgress(type, detail)` to send screenshots, and `logs` arrays. Example: `await page.goto("http://localhost:3000"); const buf = await page.screenshot(); emitProgress("screenshot", buf.toString("base64"));`',
  parameters: {
    type: Type.OBJECT,
    properties: {
      script: { type: Type.STRING, description: 'The async execution body for the playwright browser page.' }
    },
    required: ['script']
  }
};

export const gitActionTool: FunctionDeclaration = {
  name: 'git_action',
  description: 'Perform a GitHub action. Committing writes all changes. Pushing sends local commits to the remote.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, description: 'commit, push, or diff' },
      message: { type: Type.STRING, description: 'Commit message if action is commit' }
    },
    required: ['action']
  }
};

export const gcpActionTool: FunctionDeclaration = {
  name: 'gcp_action',
  description: 'Perform a GCP action such as deploying a Cloud Run service. The user has already approved this action via the plan approval gate — execute directly without asking for further confirmation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, description: 'cloudrun_deploy' },
      serviceName: { type: Type.STRING, description: 'Name of the service to deploy/update' },
      region: { type: Type.STRING, description: 'GCP region (e.g. europe-west1). Defaults to europe-west1.' },
      project: { type: Type.STRING, description: 'GCP project ID. If provided, uses --project flag.' },
    },
    required: ['action', 'serviceName']
  }
};

export const runVisualQaTool: FunctionDeclaration = {
  name: 'run_visual_qa',
  description: 'Run automated visual QA checks against a running web app using Playwright. Checks: page loads, not blank, no error overlay, CSS loaded, layout elements exist, images load, header is styled, layout not collapsed, console errors. Returns a structured report with PASS/FAIL per check and an overall verdict. Use this during browser QA instead of curl for visual verification.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: 'The URL of the running app to test (e.g. "http://localhost:5173")' }
    },
    required: ['url']
  }
};

export const copyAssetTool: FunctionDeclaration = {
  name: 'copy_asset',
  description: 'Copy a bundled binary asset from OrbitCode into the project. Use this only when a listed asset is available; otherwise create or import project-specific assets normally.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      asset: { type: Type.STRING, description: 'Asset identifier.' },
      destination: { type: Type.STRING, description: 'Destination path relative to project root.' }
    },
    required: ['asset', 'destination']
  }
};

// ════════════════════════════════════════════
//  All tools combined
// ════════════════════════════════════════════
export const memorySearchTool: FunctionDeclaration = {
  name: 'memory_search',
  description: 'Search OrbitCode persistent memory through MemPalace. Use this to recall prior decisions, architecture context, or project history before changing code.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Search query for project memory.' },
      limit: { type: Type.INTEGER, description: 'Maximum number of memory results. Defaults to 5.' },
    },
    required: ['query'],
  },
};

export const memoryStatusTool: FunctionDeclaration = {
  name: 'memory_status',
  description: 'Check whether MemPalace memory is installed and available for this project.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

export const memoryNoteTool: FunctionDeclaration = {
  name: 'memory_note',
  description: 'File a concise project memory note through MemPalace. Use for important decisions, constraints, and handoff context.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'Short note title.' },
      content: { type: Type.STRING, description: 'Verbatim note content to remember.' },
      room: { type: Type.STRING, description: 'Optional MemPalace room/category.' },
    },
    required: ['title', 'content'],
  },
};

export const ALL_TOOLS: FunctionDeclaration[] = [
  createFileTool,
  editFileTool,
  readFileTool,
  deleteFileTool,
  runCommandTool,
  listFilesTool,
  searchFilesTool,
  taskCompleteTool,
  proposePlanTool,
  askDecisionTool,
  runBrowserTestTool,
  gitActionTool,
  gcpActionTool,
  runVisualQaTool,
  copyAssetTool,
  memorySearchTool,
  memoryStatusTool,
  memoryNoteTool
];

// Tool categories for safety classification
export const SAFE_TOOLS = new Set(['read_file', 'list_files', 'search_files', 'task_complete', 'run_browser_test', 'run_visual_qa', 'propose_plan', 'ask_decision', 'copy_asset', 'memory_search', 'memory_status']);
export const WRITE_TOOLS = new Set(['create_file', 'edit_file', 'memory_note']);
export const DESTRUCTIVE_TOOLS = new Set(['delete_file']);
export const COMMAND_TOOLS = new Set(['run_command', 'git_action', 'gcp_action']);
