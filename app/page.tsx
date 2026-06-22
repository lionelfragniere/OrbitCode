'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings, PanelLeftClose, PanelLeftOpen, MessageSquare,
  Zap, Terminal, ArrowLeft, Globe, GitCompare, Shield,
  ListChecks, ShieldCheck
} from 'lucide-react';
import { AppSettings, DEFAULT_SETTINGS, ChatMessage, OpenFile, FileNode, EditorContext, ChatMode, AgentTask, AgentStep } from '@/lib/types';
import { generateId, getLanguageFromPath } from '@/lib/utils';
import { useUsageTracking } from '@/lib/hooks/useUsageTracking';
import { useProjectBrain } from '@/lib/hooks/useProjectBrain';
import FileExplorer from '@/components/FileExplorer';
import EditorTabs from '@/components/EditorTabs';
import CodeEditor from '@/components/CodeEditor';
import { AgentWorkspace } from '@/components/AgentWorkspace';
import SettingsModal from '@/components/SettingsModal';
import StatusBar from '@/components/StatusBar';
import TerminalPanel from '@/components/TerminalPanel';
import FolderBrowser from '@/components/FolderBrowser';
import Dashboard from '@/components/Dashboard';
import PreviewPanel from '@/components/PreviewPanel';
import GitPanel from '@/components/GitPanel';
import DiffViewer from '@/components/DiffViewer';
import AuditLogViewer from '@/components/AuditLogViewer';
import AgentBrowserPanel from '@/components/AgentBrowserPanel';
import RunViewer from '@/components/RunViewer';
import SystemCheck from '@/components/SystemCheck';
import type { BrowserSessionState, BrowserStep } from '@/lib/types';

interface UserConfig {
  gcpProject: string;
  gcpRegion: string;
  providerId: string;
  selectedProviderId: string;
  providerKind?: string;
  workspacePath: string;
  temperature: number;
  maxTokens: number;
  systemInstruction: string;
  selectedModel: string;
  beginnerMode: boolean;
  recentProjects: Array<{ name: string; path: string; lastOpened: number }>;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

type AppView = 'loading' | 'dashboard' | 'ide';

const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.json',
  '.py', '.rb', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
  '.md', '.txt', '.yml', '.yaml', '.toml', '.xml', '.csv', '.sql',
  '.sh', '.bat', '.ps1', '.env', '.gitignore', '.dockerfile',
  '.vue', '.svelte', '.php', '.swift', '.kt', '.scala', '.r',
  '.cfg', '.ini', '.conf', '.properties', '.makefile',
]);

const EXTENSIONLESS_TEXT_FILES = new Set([
  'readme', 'license', 'makefile', 'dockerfile', 'procfile', 'gemfile', '.gitignore',
]);

function isTextFile(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return EXTENSIONLESS_TEXT_FILES.has(filename.toLowerCase());
}

export default function Home() {
  // ── App view state ──
  const [view, setView] = useState<AppView>('loading');
  const [config, setConfig] = useState<UserConfig | null>(null);

  // ── Active project ──
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');

  // ── Layout ──
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState('index.html');
  const [externalCommand, setExternalCommand] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [folderBrowserTarget, setFolderBrowserTarget] = useState<'workspace' | 'project'>('workspace');
  const [showBrowserPanel, setShowBrowserPanel] = useState(false);
  const [browserSessionState, setBrowserSessionState] = useState<BrowserSessionState | null>(null);

  // ── Files ──
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  // ── Chat ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Toasts ──
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Agent mode (agent-first by default) ──
  const [chatMode] = useState<ChatMode>('agent');
  const [agentTask, setAgentTask] = useState<AgentTask | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  // ── Project isolation: abort controller + session ID ──
  const agentAbortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef(0);

  // ── Usage tracking (Phase 2) ──
  const { getSummary: getUsageSummary } = useUsageTracking();

  // ── Project Brain (Phase 2) ──
  const { brain } = useProjectBrain(projectPath);

  const editorContextRef = useRef<EditorContext | null>(null);

  // ──────────────────────────────────────────
  //  Project teardown — called before switching projects
  // ──────────────────────────────────────────
  const teardownActiveProject = useCallback(() => {
    // 1. Abort any active SSE stream
    if (agentAbortRef.current) {
      agentAbortRef.current.abort();
      agentAbortRef.current = null;
    }
    // 2. Increment session ID — late events from old session will be rejected
    sessionIdRef.current += 1;
    // 3. Kill browser subagent session if active
    fetch('/api/browser-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    }).catch(() => {});
    // 4. Kill any dev server processes spawned by the old project
    if (projectPath) {
      fetch('/api/agent', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectFolder: projectPath }),
      }).catch(() => {});
    }
    // 5. Reset all agent/runtime state — complete wipe, no bleed
    setAgentTask(null);
    setIsAgentRunning(false);
    setIsStreaming(false);
    setMessages([]);
    setBrowserSessionState(null);
    setShowBrowserPanel(false);
    // 6. Reset UI panels
    setOpenFiles([]);
    setActiveFilePath(null);
    setFileTree([]);
    setTerminalOpen(false);
    setPreviewOpen(false);
    setShowDiffViewer(false);
    setShowAuditLog(false);
    setExternalCommand(null);
  }, [projectPath]);

  // ──────────────────────────────────────────
  //  Toast helper
  // ──────────────────────────────────────────
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  // ──────────────────────────────────────────
  //  Config management (persistent, ~/.orbitcode/config.json)
  // ──────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (typeof data.beginnerMode !== 'boolean') data.beginnerMode = true;
      setConfig(data);
      return data as UserConfig;
    } catch (err) {
      console.error('Failed to load config:', err);
      return null;
    }
  }, []);

  const updateConfig = useCallback(async (updates: Partial<UserConfig>) => {
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (typeof data.beginnerMode !== 'boolean') data.beginnerMode = true;
      setConfig(data);
      return data as UserConfig;
    } catch (err) {
      console.error('Failed to update config:', err);
      return null;
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadConfig().then(() => setView('dashboard'));
  }, [loadConfig]);

  // Polling for Agent Browser session state
  useEffect(() => {
    if (!showBrowserPanel) return;
    const poll = async () => {
      try {
        const params = projectPath ? `?projectFolder=${encodeURIComponent(projectPath)}` : '';
        const res = await fetch(`/api/browser-session${params}`);
        const data = await res.json();
        if (data.session) setBrowserSessionState(data.session);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [showBrowserPanel, projectPath]);

  // ──────────────────────────────────────────
  //  Keyboard shortcuts
  // ──────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (view !== 'ide') return;
      if (e.ctrlKey && e.key === '`') { e.preventDefault(); setTerminalOpen((p) => !p); }
      if (e.ctrlKey && e.key === 'b') { e.preventDefault(); setSidebarOpen((p) => !p); }
      if (e.ctrlKey && e.key === 'j') { 
        e.preventDefault(); 
        setOpenFiles((prev) => {
          if (!prev.find(f => f.isAgent)) {
            return [...prev, { path: 'agent://workspace', name: 'Agent', content: '', language: 'agent', isDirty: false, isAgent: true }];
          }
          return prev;
        });
        setActiveFilePath('agent://workspace');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view]);

  // ──────────────────────────────────────────
  //  Open a project → switch to IDE view
  // ──────────────────────────────────────────
  const openProject = useCallback(async (projPath: string, name: string) => {
    // Teardown previous project — abort streams, kill processes, reset state
    teardownActiveProject();

    setProjectPath(projPath);
    setProjectName(name);

    const agentFile: OpenFile = {
      path: 'agent://workspace',
      name: 'Agent',
      content: '',
      language: 'agent',
      isDirty: false,
      isAgent: true,
    };
    setOpenFiles([agentFile]);
    setActiveFilePath(agentFile.path);
    setFileTree([]);
    setSidebarOpen(!(config?.beginnerMode ?? true));
    setTerminalOpen(false);
    setPreviewOpen(false);

    // Load chat history for this project
    try {
      const res = await fetch(`/api/chat-history?projectFolder=${encodeURIComponent(projPath)}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    }

    try {
      const res = await fetch(`/api/files?projectFolder=${encodeURIComponent(projPath)}`);
      const data = await res.json();
      setFileTree(data.tree || []);
    } catch {
      setFileTree([]);
    }

    // Track as recent
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-recent', name, path: projPath }),
    });

    // Reload config to get updated recents
    await loadConfig();

    setView('ide');
  }, [config?.beginnerMode, loadConfig, teardownActiveProject]);

  // Save chat history when messages change (debounced)
  useEffect(() => {
    if (view !== 'ide' || !projectPath || messages.length === 0) return;
    const timer = setTimeout(() => {
      fetch('/api/chat-history', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectFolder: projectPath, messages }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [messages, projectPath, view]);

  // ──────────────────────────────────────────
  //  File tree
  // ──────────────────────────────────────────
  const loadFileTree = useCallback(async () => {
    if (!projectPath) return;
    try {
      const res = await fetch(`/api/files?projectFolder=${encodeURIComponent(projectPath)}`);
      const data = await res.json();
      if (data.tree) setFileTree(data.tree);
    } catch (err) {
      console.error('Failed to load file tree:', err);
      showToast('Failed to load file tree', 'error');
    }
  }, [projectPath, showToast]);

  // Load file tree when entering IDE
  useEffect(() => {
    if (view === 'ide' && projectPath) loadFileTree();
  }, [view, projectPath, loadFileTree]);

  // Open a file
  const openFile = async (node: FileNode) => {
    if (node.isDirectory) return;
    const existing = openFiles.find((f) => f.path === node.path);
    if (existing) { setActiveFilePath(node.path); return; }

    const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(node.path);
    if (isImage) {
      const newFile: OpenFile = {
        path: node.path,
        name: node.name,
        content: '',
        language: 'image',
        isDirty: false,
        isImage: true,
        isReport: node.isReport,
        runId: node.runId,
      };
      setOpenFiles((prev) => [...prev, newFile]);
      setActiveFilePath(node.path);
      return;
    }

    if (node.isReport) {
      const newFile: OpenFile = {
        path: node.path,
        name: node.name,
        content: '',
        language: 'text',
        isDirty: false,
        isReport: true,
        runId: node.runId,
      };
      setOpenFiles((prev) => [...prev, newFile]);
      setActiveFilePath(node.path);
      return;
    }

    try {
      const res = await fetch(
        `/api/files?projectFolder=${encodeURIComponent(projectPath)}&filePath=${encodeURIComponent(node.path)}`
      );
      const data = await res.json();
      if (data.content !== undefined) {
        const newFile: OpenFile = {
          path: node.path,
          name: node.name,
          content: data.content,
          language: getLanguageFromPath(node.path),
          isDirty: false,
        };
        setOpenFiles((prev) => [...prev, newFile]);
        setActiveFilePath(node.path);
        if (/\.html?$/i.test(node.path)) setPreviewFile(node.path);
      }
    } catch {
      showToast('Failed to open file', 'error');
    }
  };

  const closeFile = (path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    if (activeFilePath === path) {
      const remaining = openFiles.filter((f) => f.path !== path);
      setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  };

  const updateFileContent = (path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, content, isDirty: true } : f))
    );
  };

  const saveFile = async (path: string) => {
    const file = openFiles.find((f) => f.path === path);
    if (!file) return;
    try {
      await fetch('/api/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectFolder: projectPath, filePath: path, content: file.content }),
      });
      setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, isDirty: false } : f)));
      showToast(`Saved ${file.name}`);
    } catch {
      showToast('Failed to save file', 'error');
    }
  };

  const createFile = async (filePath: string, content: string) => {
    try {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectFolder: projectPath, filePath, content }),
      });
      showToast(`Created ${filePath}`);
      await loadFileTree();
      const name = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
      const newFile: OpenFile = {
        path: filePath,
        name,
        content,
        language: getLanguageFromPath(filePath),
        isDirty: false,
      };
      setOpenFiles((prev) => {
        // Don't duplicate if already open
        if (prev.some((f) => f.path === filePath)) {
          return prev.map((f) => f.path === filePath ? newFile : f);
        }
        return [...prev, newFile];
      });
      setActiveFilePath(filePath);
    } catch {
      showToast('Failed to create file', 'error');
    }
  };

  // ★ AUTO-CREATE FILES: Called by ChatPanel when AI finishes streaming
  const autoCreateFiles = useCallback(async (files: Array<{ path: string; content: string }>) => {
    let createdCount = 0;
    let lastHtmlFile = '';
    for (const file of files) {
      try {
        await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectFolder: projectPath, filePath: file.path, content: file.content }),
        });
        createdCount++;
        // Track HTML files for auto-preview
        if (file.path.endsWith('.html')) lastHtmlFile = file.path;
        // Open the file in editor
        const name = file.path.replace(/\\/g, '/').split('/').pop() || file.path;
        const newFile: OpenFile = {
          path: file.path,
          name,
          content: file.content,
          language: getLanguageFromPath(file.path),
          isDirty: false,
        };
        setOpenFiles((prev) => {
          if (prev.some((f) => f.path === file.path)) {
            return prev.map((f) => f.path === file.path ? newFile : f);
          }
          return [...prev, newFile];
        });
      } catch (err) {
        console.error(`Failed to create ${file.path}:`, err);
      }
    }
    if (createdCount > 0) {
      showToast(`✨ Auto-created ${createdCount} file${createdCount > 1 ? 's' : ''}`);
      await loadFileTree();
      // Auto-open first created file
      setActiveFilePath(files[0].path);
      // Auto-open preview if an HTML file was created (small delay to ensure files are written)
      if (lastHtmlFile) {
        setPreviewFile(lastHtmlFile);
        setTimeout(() => setPreviewOpen(true), 500);
      }
    }
  }, [projectPath, showToast, loadFileTree]);

  // ──────────────────────────────────────────
  //  AI Chat — Full Project Context (Antigravity-style)
  // ──────────────────────────────────────────
  const buildFullProjectContext = useCallback(async (): Promise<string> => {
    if (!projectPath) return '';

    // Collect all file paths from tree
    const filePaths: string[] = [];
    const walk = (nodes: FileNode[], prefix = '') => {
      for (const node of nodes) {
        const fp = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.isDirectory && node.children) {
          walk(node.children, fp);
        } else if (!node.isDirectory && isTextFile(node.name) && (!node.size || node.size < 50000)) {
          filePaths.push(fp);
        }
      }
    };
    walk(fileTree);

    // Prioritize AGENT.md and README.md — they provide project context for collaboration
    const priority = ['AGENT.md', 'agent.md', 'README.md', 'readme.md'];
    filePaths.sort((a, b) => {
      const aName = a.split('/').pop()?.toLowerCase() || '';
      const bName = b.split('/').pop()?.toLowerCase() || '';
      const aPriority = priority.findIndex(p => p.toLowerCase() === aName);
      const bPriority = priority.findIndex(p => p.toLowerCase() === bName);
      if (aPriority !== -1 && bPriority === -1) return -1;
      if (aPriority === -1 && bPriority !== -1) return 1;
      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      return 0;
    });

    // Read contents of all text files (parallel, max 30 files)
    const toRead = filePaths.slice(0, 30);
    const fileContents: string[] = [];
    let totalChars = 0;
    const MAX_CONTEXT_CHARS = 120000; // ~30k tokens

    const results = await Promise.allSettled(
      toRead.map(async (fp) => {
        const res = await fetch(`/api/files?projectFolder=${encodeURIComponent(projectPath)}&filePath=${encodeURIComponent(fp)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return { path: fp, content: data.content as string };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { path: fp, content } = result.value;
        if (totalChars + content.length > MAX_CONTEXT_CHARS) break;
        fileContents.push(`### FILE: ${fp}\n\`\`\`\n${content}\n\`\`\``);
        totalChars += content.length;
      }
    }

    // Also list files that weren't read (too large or too many)
    const unread = filePaths.slice(30);
    const unreadList = unread.length > 0 ? `\n\nOther files (not loaded): ${unread.join(', ')}` : '';

    return fileContents.join('\n\n') + unreadList;
  }, [fileTree, projectPath]);

  const sendMessage = async (text: string) => {
    if (!config) return;
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: text, timestamp: Date.now() };
    const assistantMsg: ChatMessage = { id: generateId(), role: 'assistant', content: '', timestamp: Date.now() };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      const allMessages = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const activeFile = openFiles.find((f) => f.path === activeFilePath);
      const editorCtx = editorContextRef.current;
      const projectContext = await buildFullProjectContext();
      const beginnerInstruction = config.beginnerMode
        ? `\n\n--- BEGINNER MODE ---\nSpeak in simple, friendly language. Hide low-level code details by default. When code is needed, explain what it does before showing it, avoid jargon, and give the user one clear next action.`
        : '';

      const enrichedInstruction = config.systemInstruction +
        beginnerInstruction +
        (projectContext ? `\n\n--- FULL PROJECT FILES (read-only context) ---\nBelow are the current contents of ALL files in this project. Use this to understand the existing codebase before making changes.\n${projectContext}` : '') +
        `\n\n--- CRITICAL FILE CREATION RULES ---` +
        `\nWhen you write code, you MUST use the file path as the code block language identifier.` +
        `\nExample: \`\`\`index.html for a file named index.html in the root.` +
        `\nExample: \`\`\`src/utils.ts for a file at src/utils.ts.` +
        `\nDo NOT use plain language names like "html", "javascript", "css" as identifiers.` +
        `\nAlways use the actual file path (e.g. index.html, styles.css, app.js, src/components/Header.tsx).` +
        `\nYour code blocks will be AUTOMATICALLY saved to disk as real files.` +
        `\nYou can create multiple files in one response — each code block becomes a separate file.` +
        `\nProvide complete, working code with all imports in every file.` +
        `\nIf packages need installing, tell the user the exact npm install command.` +
        `\n\n--- INTENT UNDERSTANDING ---` +
        `\nYou have access to the FULL CONTENTS of every file in this project (see above).` +
        `\nWhen the user says things like "make this better", "improve this", "add features", or "fix this":` +
        `\n1. READ the existing project files provided above to understand what the project does.` +
        `\n2. ANALYZE the codebase — understand the architecture, patterns, and technologies used.` +
        `\n3. GENERATE improved versions of the relevant files, keeping existing functionality intact.` +
        `\n4. Always re-emit the COMPLETE file contents (not just diffs or snippets).` +
        `\nExamples:` +
        `\n- "make this game better" → Read all game files, add new features (sounds, levels, animations, polish).` +
        `\n- "add dark mode" → Read the CSS and HTML, add a theme toggle and dark mode styles.` +
        `\n- "build me something to calculate pi with html and py" → Create all necessary files from scratch.` +
        `\nAlways create ALL necessary files (HTML, CSS, JS, Python, README, config files) even if the user doesn't list them explicitly.` +
        `\nAlways create a README.md explaining the project, how to install dependencies, and how to run it.` +
        `\n\n--- SECURITY BEST PRACTICES ---` +
        `\nNever hardcode secrets, API keys, passwords, or credentials in source code.` +
        `\nIf the user needs to configure sensitive values:` +
        `\n1. Create a .env file with the actual values (it will be gitignored).` +
        `\n2. Create a .env.example file with placeholder values and comments explaining each variable.` +
        `\n3. Ensure .gitignore includes .env, .env.local, and .env.production.` +
        `\n4. In code, read values from environment variables (process.env.VAR_NAME or os.environ['VAR_NAME']).` +
        `\nExample .env.example:` +
        `\n# Database\nDATABASE_URL=postgresql://user:password@host:5432/dbname` +
        `\n# API Keys\nAPI_KEY=your-api-key-here` +
        `\n\n--- AUTONOMOUS COMMAND EXECUTION ---` +
        `\nYou are a FULLY AUTONOMOUS AI coding assistant. You DO NOT just suggest commands — you EXECUTE them.` +
        `\nYou have a built-in terminal that executes commands automatically.` +
        `\nWhen you put commands in \`\`\`sh code blocks, they are AUTOMATICALLY EXECUTED in the project terminal.` +
        `\nThis means:` +
        `\n- Do NOT say "please run this command" or "you can run this" — say "I'll install the dependencies" or "Running the dev server now".` +
        `\n- Do NOT say "I don't have a local server" or "As an AI, I can't..." — YOU CAN and you DO run commands.` +
        `\n- Be PROACTIVE: install deps, start servers, run tests, deploy — all autonomously.` +
        `\n- After creating files, ALWAYS include the necessary \`\`\`sh blocks to install dependencies and run/test the app.` +
        `\n- When asked to "run it" or "test it" or "deploy it", ALWAYS provide the exact commands in \`\`\`sh blocks.` +
        `\nExamples:` +
        `\n\`\`\`sh` +
        `\nnpm install` +
        `\n\`\`\`` +
        `\n\`\`\`sh` +
        `\nnpm run dev` +
        `\n\`\`\`` +
        `\nFor deployment:` +
        `\n\`\`\`sh` +
        `\ngcloud run deploy my-app --source . --region europe-west1 --allow-unauthenticated` +
        `\n\`\`\`` +
        `\nMultiple commands in one block will be chained with && and run sequentially.` +
        `\nWhen creating an app, ALWAYS include \`\`\`sh blocks for: 1) installing deps, 2) running/testing it.` +
        `\nWhen the user says "deploy", include the exact \`\`\`sh deployment commands.` +
        `\nAlways provide complete, runnable code. Test mentally that imports, file references, and paths are correct.` +
        `\nYou are like a senior developer pair-programming: you write code AND run it.` +
        `\n\n--- DEPLOYMENT GUIDANCE ---` +
        `\nWhen the user asks to deploy, guide them through GCP deployment AND provide the gcloud commands as \`\`\`sh blocks:` +
        `\n- For web apps: Create a Dockerfile and deploy to Cloud Run using gcloud run deploy.` +
        `\n- For databases: Guide Cloud SQL setup with connection via Cloud SQL Proxy.` +
        `\n- For static sites: Deploy to Cloud Storage with gsutil.` +
        `\nAlways create deployment configs (Dockerfile, cloudbuild.yaml, etc.) when relevant.` +
        `\n\n--- COLLABORATIVE CONTEXT (AGENT.md) ---` +
        `\nThis is a COLLABORATIVE tool. Multiple people may work on the same project via Git.` +
        `\nWhenever you create or significantly modify a project, you MUST create or update an AGENT.md file at the project root.` +
        `\nAGENT.md serves as a handoff document so that when another user pulls the repo, their OrbitCode instance can immediately understand the project.` +
        `\nAGENT.md must contain:` +
        `\n# Project Name` +
        `\n## Overview` +
        `\nBrief description of what this project does.` +
        `\n## Tech Stack` +
        `\nList of technologies, frameworks, and languages used.` +
        `\n## Architecture` +
        `\nHow the project is structured (key files and their purposes).` +
        `\n## Setup` +
        `\nHow to install dependencies and run the project.` +
        `\n## Current State` +
        `\nWhat has been implemented so far and what works.` +
        `\n## Known Issues` +
        `\nAny bugs or limitations.` +
        `\n## Next Steps` +
        `\nSuggested improvements or features to add.` +
        `\n## Change Log` +
        `\nBrief log of major changes made (newest first).` +
        `\nIf AGENT.md already exists, READ it first and UPDATE it with your changes — do NOT overwrite the change log, append to it.` +
        `\n\n--- RESPONSE FORMAT ---` +
        `\nWhen starting a task, structure your response as:` +
        `\n## Task\nBrief description of what you're building.` +
        `\n## Plan\nNumbered list of files you'll create/modify (always include AGENT.md).` +
        `\nThen provide each file as a code block with the filename.` +
        `\nAfter all code, add:` +
        `\n## Summary\nWhat was created and how to use/test it.`;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages,
          settings: {
            providerId: config.selectedProviderId || config.providerId,
            selectedProviderId: config.selectedProviderId || config.providerId,
            providerKind: config.providerKind,
            selectedModel: config.selectedModel,
            gcpProject: config.gcpProject,
            gcpRegion: config.gcpRegion,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            systemInstruction: enrichedInstruction,
            beginnerMode: config.beginnerMode,
          },
          editorContext: activeFile
            ? { filePath: activeFile.path, language: activeFile.language, content: activeFile.content, selectedText: editorCtx?.selectedText }
            : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `❌ Error: ${err.error || 'Request failed'}` } : m));
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'text') {
                  accumulated += data.content;
                  setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: accumulated } : m));
                } else if (data.type === 'error') {
                  accumulated += `\n\n❌ ${data.content}`;
                  setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: accumulated } : m));
                }
              } catch { /* skip */ }
            }
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `❌ ${msg}` } : m));
    } finally {
      setIsStreaming(false);
    }
  };

  // ──────────────────────────────────────────
  //  Agent Mode — Autonomous execution via /api/agent
  // ──────────────────────────────────────────
  const sendAgentMessage = async (text: string) => {
    if (!config) return;

    // Add user message to chat
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    // Create a new task — always orchestrated
    const task: AgentTask = {
      id: generateId(),
      intent: text,
      status: 'planning',
      steps: [],
      filesCreated: [],
      filesModified: [],
      commandsRun: [],
      startedAt: Date.now(),
      orchestrated: true,
      stageResults: [],
    };
    setAgentTask(task);
    setIsAgentRunning(true);

    _runAgentPipeline(text, task);
  };

  const handleResumeTask = async (taskId: string, action: string) => {
    if (!config || !agentTask || agentTask.id !== taskId || !agentTask.checkpointState) return;

    if (action === 'abort') {
      setAgentTask(prev => prev ? { ...prev, status: 'error', error: 'Execution aborted by user.' } : null);
      return;
    }

    const decisionPrefix = 'decision:';
    const selectedDecision = action.startsWith(decisionPrefix)
      ? action.slice(decisionPrefix.length).trim()
      : '';
    const displayAction = selectedDecision ? `Selected option: ${selectedDecision}` : `Resuming orchestrator execution (${action})`;

    // Add resume message to chat
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: displayAction, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    setAgentTask(prev => prev ? { ...prev, status: 'executing' } : null);
    setIsAgentRunning(true);

    const resumeSnapshot = {
      ...agentTask.checkpointState.internalStateSnapshot,
    } as Record<string, unknown>;
    const resumeIntent = selectedDecision
      ? `${agentTask.intent}\n\nUser selected this option: ${selectedDecision}`
      : agentTask.intent;
    if (selectedDecision) {
      const previousIntent = typeof resumeSnapshot.userIntent === 'string'
        ? resumeSnapshot.userIntent
        : agentTask.intent;
      resumeSnapshot.userIntent = `${previousIntent}\n\nUser selected this option: ${selectedDecision}`;
    }

    _runAgentPipeline(resumeIntent, agentTask, resumeSnapshot);
  };

  const _runAgentPipeline = async (text: string, currentTask: AgentTask, resumeState?: Record<string, unknown>) => {
    if (!config) return;

    // Capture session ID at start — if it changes mid-run, we abort
    const mySession = sessionIdRef.current;

    // Set up abort controller for this run
    const abortCtrl = new AbortController();
    agentAbortRef.current = abortCtrl;

    try {
      const projectContext = await buildFullProjectContext();

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          message: text,
          providerId: config.selectedProviderId || config.providerId,
          selectedProviderId: config.selectedProviderId || config.providerId,
          providerKind: config.providerKind,
          gcpProject: config.gcpProject,
          gcpRegion: config.gcpRegion,
          projectFolder: projectPath,
          projectContext,
          model: config.selectedModel || undefined,
          temperature: 0.2,
          maxTokens: config.maxTokens,
          maxAgentTurns: 50,
          orchestrated: true,
          beginnerMode: config.beginnerMode,
          resumeState,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Agent request failed' }));
        if (sessionIdRef.current !== mySession) return; // stale
        setAgentTask((prev) => prev ? { ...prev, status: 'error', error: err.error || 'Request failed', completedAt: Date.now() } : null);
        setIsAgentRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let agentText = '';

      if (reader) {
        while (true) {
          // Session guard: if project changed, cancel this reader
          if (sessionIdRef.current !== mySession) {
            reader.cancel().catch(() => {});
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                // Late-event guard: skip if project switched
                if (sessionIdRef.current !== mySession) continue;

                // Handle stage lifecycle events
                const isStageEvent = ['stage_start', 'stage_complete', 'stage_failed', 'recovery_triggered', 'orchestrator_complete', 'orchestrator_error', 'run_paused'].includes(data.type);

                const step: AgentStep = {
                  id: generateId(),
                  type: isStageEvent ? (data.type === 'stage_complete' || data.type === 'orchestrator_complete' ? 'complete' :
                        data.type === 'stage_failed' || data.type === 'orchestrator_error' ? 'error' :
                        data.type === 'run_paused' ? 'approval_required' : 'thinking') :
                        data.type,
                  content: data.content || '',
                  toolName: data.toolName,
                  toolArgs: data.toolArgs,
                  toolResult: data.toolResult,
                  timestamp: Date.now(),
                };

                // Update task with new step
                setAgentTask((prev) => {
                  if (!prev) return null;
                  const updated = { ...prev, steps: [...prev.steps, step] };

                  // Update orchestration metadata from SSE
                  if (data.stageResults) {
                    updated.stageResults = data.stageResults;
                  }
                  if (data.stage) {
                    updated.activeStage = data.stage;
                  }
                  if (data.complexity) {
                    updated.complexity = data.complexity;
                  }

                  // Track status changes
                  if (data.type === 'thinking' || data.type === 'stage_start') {
                    updated.status = 'executing';
                  } else if (data.type === 'tool_call') {
                    updated.status = 'executing';
                    if (data.toolName === 'run_command' && data.toolArgs?.command) {
                      updated.commandsRun = [...updated.commandsRun, String(data.toolArgs.command)];
                    }
                  } else if (data.type === 'tool_result') {
                    const filePath = data.toolArgs?.path ? String(data.toolArgs.path) : '';
                    if (data.toolName === 'create_file' && filePath) {
                      updated.filesCreated = [...updated.filesCreated, filePath];
                    } else if (data.toolName === 'edit_file' && filePath) {
                      updated.filesModified = [...updated.filesModified, filePath];
                    }
                  } else if (data.type === 'complete' || data.type === 'orchestrator_complete') {
                    // Don't override paused status — the approval gate must be preserved
                    if (updated.status !== 'paused') {
                      updated.status = 'complete';
                      updated.summary = data.content;
                      updated.completedAt = Date.now();
                      updated.activeStage = undefined;
                    }
                  } else if (data.type === 'error' || data.type === 'orchestrator_error') {
                    updated.status = 'error';
                    updated.error = data.content;
                    updated.completedAt = Date.now();
                  } else if (data.type === 'run_paused' || data.type === 'paused') {
                    updated.status = 'paused';
                    updated.completedAt = Date.now();
                    updated.activeStage = undefined;
                    if (data.state?.checkpointState) {
                      updated.checkpointState = data.state.checkpointState;
                    }
                  } else if (data.type === 'stage_complete') {
                    // Stage completed but pipeline continues
                    updated.status = 'executing';
                  } else if (data.type === 'recovery_triggered') {
                    updated.status = 'verifying';
                    updated.recoveryCount = (updated.recoveryCount || 0) + 1;
                  }

                  return updated;
                });

                // Accumulate ONLY user-facing text for the conversation thread.
                // Technical payloads (tool calls, browser events, JSON blobs, internal status) stay in task steps only.
                if (data.type === 'text') {
                  const t = (data.content || '').trim();
                  // Skip empty / trivially short
                  if (!t || t.length < 3) { /* skip */ }
                  // Skip standalone raw JSON payloads
                  else if (((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) && (() => { try { JSON.parse(t); return true; } catch { return false; } })()) { /* skip JSON */ }
                  // Skip internal SSE / tool / browser markers
                  else if (/\/api\/preview\?/.test(t)) { /* skip */ }
                  else if (/"type"\s*:\s*"(tool_call|tool_result|browser_step|browser_screenshot)"/.test(t)) { /* skip */ }
                  else if (/^(data:|event:)/m.test(t)) { /* skip */ }
                  // Skip internal orchestrator status lines
                  else if (/PAUSE_FOR_APPROVAL/i.test(t)) { /* skip */ }
                  else if (/Orchestrator finished/i.test(t)) { /* skip */ }
                  else if (/Task Complete Complexity/i.test(t)) { /* skip */ }
                  else if (/^## Task Complete/i.test(t)) { /* skip */ }
                  else if (/Stages run:\s*\d+/i.test(t)) { /* skip */ }
                  else if (/^\[System\]:/i.test(t)) { /* skip */ }
                  else if (/recovery_triggered|stage_start|stage_complete/i.test(t)) { /* skip */ }
                  // Skip text chunks that contain embedded JSON verdict objects
                  else if (/"verdict"\s*:\s*"/.test(t) && /"summary"\s*:\s*"/.test(t)) { /* skip verdict JSON */ }
                  // Skip raw tool result echoes (files_created, files_modified, commands_run)
                  else if (/"files_created"\s*:/.test(t) || /"files_modified"\s*:/.test(t) || /"commands_run"\s*:/.test(t)) { /* skip */ }
                  else {
                    agentText += data.content;
                  }
                } else if (data.type === 'complete' || data.type === 'orchestrator_complete') {
                  // Only add if it's a genuinely new summary (avoid duplicating what's already in agentText)
                  const summary = (data.content || '').trim();
                  if (summary && !agentText.includes(summary)
                      && !/Orchestrator finished/i.test(summary)
                      && !/Task Complete Complexity/i.test(summary)
                      && !/Stages run:\s*\d+/i.test(summary)) {
                    agentText += `\n\n${summary}`;
                  }
                } else if (data.type === 'error' || data.type === 'orchestrator_error') {
                  agentText += `\n\n${data.content}`;
                }
              } catch { /* skip */ }
            }
          }
        }
      }

      // Add the assistant summary message (only if still same project)
      if (agentText.trim() && sessionIdRef.current === mySession) {
        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: agentText.trim(),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      // Refresh file tree after agent work
      await loadFileTree();

    } catch (error) {
      // Ignore AbortError — expected when project switches
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (sessionIdRef.current !== mySession) return; // stale session
      const msg = error instanceof Error ? error.message : 'Agent error';
      setAgentTask((prev) => prev ? { ...prev, status: 'error', error: msg, completedAt: Date.now() } : null);
    } finally {
      if (sessionIdRef.current === mySession) {
        setIsAgentRunning(false);
      }
      // Clear abort ref if it's still ours
      if (agentAbortRef.current === abortCtrl) {
        agentAbortRef.current = null;
      }
    }
  };

  // Dispatch to correct handler based on mode
  const handleSend = (text: string) => {
    // ── APPROVAL SAFETY: Text input NEVER auto-resumes a paused plan ──
    // Only the explicit "Approve & Continue" button (via onResumeTask) can resume.
    // If the user types while paused, treat it as a revision / new request:
    // abort the paused plan and start a fresh agent run with their text.
    if (chatMode === 'agent' && agentTask?.status === 'paused' && agentTask.checkpointState) {
      // Abort the current paused plan
      setAgentTask(prev => prev ? { ...prev, status: 'error', error: 'Plan replaced by new user request.' } : null);
      // Start a fresh agent run with the user's revision text
      sendAgentMessage(text);
      return;
    }

    if (chatMode === 'agent') {
      sendAgentMessage(text);
    } else {
      sendMessage(text);
    }
  };

  const applyCode = (code: string) => {
    if (!activeFilePath) return;
    const activeFile = openFiles.find((f) => f.path === activeFilePath);
    if (activeFile) {
      const editorCtx = editorContextRef.current;
      if (editorCtx?.selectedText) {
        updateFileContent(activeFilePath, activeFile.content.replace(editorCtx.selectedText, code));
      } else {
        updateFileContent(activeFilePath, code);
      }
      showToast('Code applied to editor');
    }
  };

  const updateEditorContext = (ctx: EditorContext | null) => { editorContextRef.current = ctx; };
  const activeFile = openFiles.find((f) => f.path === activeFilePath) || null;

  // Build settings object from config for components that need AppSettings
  const appSettings: AppSettings = config ? {
    gcpProject: config.gcpProject,
    gcpRegion: config.gcpRegion,
    providerId: config.providerId,
    selectedProviderId: config.selectedProviderId,
    providerKind: config.providerKind,
    projectFolder: projectPath,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    systemInstruction: config.systemInstruction,
    selectedModel: config.selectedModel || 'qwen3:8b',
    beginnerMode: config.beginnerMode ?? true,
  } : DEFAULT_SETTINGS;

  const usageSummary = getUsageSummary();

  // Extract browser steps from the current task for the panel
  const currentBrowserSteps: BrowserStep[] = agentTask?.steps
    .filter(s => s.toolName === 'browser_step' || s.toolName === 'browser_screenshot')
    .map(s => {
      try { return JSON.parse(s.content).step as BrowserStep; } catch { return null; }
    })
    .filter(Boolean) as BrowserStep[] || [];

  // Auto-open browser panel when a browser session starts
  useEffect(() => {
    if (agentTask?.status === 'executing' && agentTask.steps.length > 0) {
      const lastStep = agentTask.steps[agentTask.steps.length - 1];
      if (lastStep.toolName === 'browser_session' || lastStep.toolName === 'browser_step') {
        setShowBrowserPanel(true);
      }
    }
  }, [agentTask?.steps, agentTask?.status]);

  // ──────────────────────────────────────────
  //  RENDER
  // ──────────────────────────────────────────

  if (view === 'loading' || !config) {
    return (
      <div className="setup-screen">
        <div className="streaming-indicator">
          <span className="streaming-indicator__dot" />
          <span className="streaming-indicator__dot" />
          <span className="streaming-indicator__dot" />
        </div>
      </div>
    );
  }

  // ── DASHBOARD VIEW ──
  if (view === 'dashboard') {
    return (
      <>
        <Dashboard
          config={config}
          onOpenProject={openProject}
          onUpdateConfig={(updates) => updateConfig(updates)}
          onBrowseWorkspace={() => {
            setFolderBrowserTarget('workspace');
            setShowFolderBrowser(true);
          }}
          onOpenSettings={() => setShowSettings(true)}
        />
        {showFolderBrowser && (
          <FolderBrowser
            currentPath={config.workspacePath || ''}
            onSelect={(path) => {
              if (folderBrowserTarget === 'workspace') {
                updateConfig({ workspacePath: path });
              }
              setShowFolderBrowser(false);
            }}
            onClose={() => setShowFolderBrowser(false)}
          />
        )}
        {showSettings && (
          <SettingsModal
            settings={appSettings}
            onSave={(s) => {
              updateConfig({
                gcpProject: s.gcpProject,
                gcpRegion: s.gcpRegion,
                providerId: s.selectedProviderId || s.providerId,
                selectedProviderId: s.selectedProviderId || s.providerId,
                providerKind: s.providerKind,
                temperature: s.temperature,
                maxTokens: s.maxTokens,
                systemInstruction: s.systemInstruction,
                selectedModel: s.selectedModel,
                beginnerMode: s.beginnerMode,
              });
              setShowSettings(false);
            }}
            onClose={() => setShowSettings(false)}
            onBrowseFolder={() => {
              setShowSettings(false);
              setFolderBrowserTarget('workspace');
              setShowFolderBrowser(true);
            }}
          />
        )}
        {toasts.length > 0 && (
          <div className="toast-container">
            {toasts.map((t) => (
              <div key={t.id} className={`toast toast--${t.type}`}>
                {t.type === 'success' ? '✓' : '✗'} {t.message}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // ── IDE VIEW ──
  return (
    <div className="ide-container">
      <header className="ide-toolbar">
        <button
          className="icon-btn"
          onClick={() => {
            teardownActiveProject();
            setView('dashboard');
          }}
          title="Back to Dashboard"
          style={{ marginRight: '4px' }}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="ide-toolbar__brand" title={projectName}>
          <Zap size={18} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>OrbitCode · {projectName}</span>
        </div>
        <div className="ide-toolbar__spacer" />
        <div className="ide-toolbar__actions">
          {!config.beginnerMode && (
            <>
              <button className={`icon-btn ${sidebarOpen ? 'icon-btn--active' : ''}`} onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle Explorer (Ctrl+B)">
                {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
              <button className={`icon-btn ${terminalOpen ? 'icon-btn--active' : ''}`} onClick={() => setTerminalOpen(!terminalOpen)} title="Toggle Terminal (Ctrl+`)">
                <Terminal size={16} />
              </button>
            </>
          )}
          <button className={`icon-btn ${previewOpen ? 'icon-btn--active' : ''}`} onClick={() => setPreviewOpen(!previewOpen)} title="Toggle Preview">
            <Globe size={16} />
          </button>
          {!config.beginnerMode && (
            <>
              <button className="icon-btn" onClick={() => setShowDiffViewer(true)} title="View Changes (Diff)">
                <GitCompare size={16} />
              </button>
              <button className="icon-btn" onClick={() => {
                setOpenFiles((prev) => {
                  if (!prev.find(f => f.isRunViewer)) {
                    return [...prev, { path: 'run-viewer://index', name: 'Runs', content: '', language: 'runviewer', isDirty: false, isRunViewer: true }];
                  }
                  return prev;
                });
                setActiveFilePath('run-viewer://index');
              }} title="Historical Runs">
                <ListChecks size={16} />
              </button>
              <button className="icon-btn" onClick={() => {
                setOpenFiles((prev) => {
                  if (!prev.find(f => f.isSystemCheck)) {
                    return [...prev, { path: 'system-check://main', name: 'System Check', content: '', language: 'syscheck', isDirty: false, isSystemCheck: true }];
                  }
                  return prev;
                });
                setActiveFilePath('system-check://main');
              }} title="System Check (Preflight)">
                <ShieldCheck size={16} />
              </button>
              <button className={`icon-btn ${showAuditLog ? 'icon-btn--active' : ''}`} onClick={() => setShowAuditLog(!showAuditLog)} title="Audit Log">
                <Shield size={16} />
              </button>
            </>
          )}
          <button className="icon-btn" onClick={() => {
            setOpenFiles((prev) => {
              if (!prev.find(f => f.isAgent)) {
                return [...prev, { path: 'agent://workspace', name: 'Agent', content: '', language: 'agent', isDirty: false, isAgent: true }];
              }
              return prev;
            });
            setActiveFilePath('agent://workspace');
          }} title="Open Agent Tab (Ctrl+J)">
            <MessageSquare size={16} />
          </button>
          <button className={`icon-btn ${showBrowserPanel ? 'icon-btn--active' : ''}`} onClick={() => {
            if (showBrowserPanel) {
              setShowBrowserPanel(false);
              if (activeFilePath === 'browser://live') setActiveFilePath('agent://workspace');
              return;
            }
            setShowBrowserPanel(true);
            setOpenFiles((prev) => {
              if (!prev.find(f => f.isBrowser && !f.runId)) {
                return [...prev, { path: 'browser://live', name: 'Browser', content: '', language: 'browser', isDirty: false, isBrowser: true }];
              }
              return prev;
            });
            setActiveFilePath('browser://live');
          }} title="Agent Browser">
            <Globe size={16} style={showBrowserPanel ? { color: '#4EC3E0' } : {}} />
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={16} />
          </button>
        </div>
      </header>

      <main className="ide-main">
        {/* Sidebar: File Explorer + Git Panel */}
        {sidebarOpen && (
          <div className="sidebar-wrapper">
            <FileExplorer
              isOpen={sidebarOpen}
              fileTree={fileTree}
              activeFilePath={activeFilePath}
              onFileSelect={(node) => {
                openFile(node);
                // Auto-close sidebar for run viewer to focus UX
                if (node.isReport) {
                  setSidebarOpen(false);
                }
              }}
              onRefresh={loadFileTree}
              projectFolder={projectPath}
              onOpenInTerminal={(dir) => {
                // Open a terminal tab rooted at the given directory
                setTerminalOpen(true);
                showToast(`Terminal opened at ${dir}`, 'success');
              }}
              onToast={showToast}
            />
            {!(((activeFile?.isBrowser || activeFile?.isReport) && !!activeFile?.runId) ||
               activeFile?.isRunViewer || activeFile?.isSystemCheck) && (
              <GitPanel projectFolder={projectPath} onToast={showToast} />
            )}
          </div>
        )}
        {showAuditLog && (
          <aside style={{ width: 360, maxWidth: '35vw', flexShrink: 0, borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
            <AuditLogViewer projectPath={projectPath} />
          </aside>
        )}
        <div className="editor-area" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <EditorTabs openFiles={openFiles} activeFilePath={activeFilePath} onSelect={setActiveFilePath} onClose={closeFile} onSave={saveFile} />
          <div className="editor-preview-split" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div className="editor-content" style={{ flex: 1, minWidth: 0, display: 'flex' }}>
              {/* 
                We keep the AgentWorkspace perpetually mounted using display: none 
                when it isn't active, so text input and scroll states aren't lost tab-switching
              */}
              <div style={{ display: activeFile?.isAgent ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' }}>
                <AgentWorkspace
                  isOpen={true} // It's a tab now, always considered open if active
                  messages={messages}
                  task={agentTask}
                  isAgentRunning={isAgentRunning}
                  isStreaming={isStreaming}
                  onSend={handleSend}
                  onClear={() => {
                    // Abort running agent if active
                    if (agentAbortRef.current) { agentAbortRef.current.abort(); agentAbortRef.current = null; }
                    sessionIdRef.current += 1;
                    setMessages([]); setAgentTask(null); setIsAgentRunning(false);
                  }}
                  onApplyCode={applyCode}
                  onSaveAsFile={createFile}
                  onAutoCreateFiles={autoCreateFiles}
                  onRunCommand={(cmd) => {
                    setTerminalOpen(true);
                    setExternalCommand(cmd);
                  }}
                  activeFile={activeFile}
                  onResumeTask={handleResumeTask}
                />
              </div>

              {/* Only render other views if active file is NOT the agent */}
              {activeFile && !activeFile.isAgent && (
                activeFile.isImage ? (
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0f', overflow: 'auto', padding: '2rem' }}>
                    <div style={{ background: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAOklEQVQYV2NkYGAwYWBgOMuAACA+A7oIE2EQNqEoxjAg1A0wjHCVMDHcwXASB3bTDEbY+tAlQkIYGAMAkX8E927YtU0AAAAASUVORK5CYII=") repeat', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                      <img 
                        src={`/api/preview?projectFolder=${encodeURIComponent(projectPath)}&filePath=${encodeURIComponent(activeFile.path)}`} 
                        alt={activeFile.name}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                      />
                    </div>
                  </div>
                ) : activeFile.isRunViewer ? (
                  <RunViewer
                    projectFolder={projectPath}
                    runId={activeFile.runId}
                    onOpenRun={(id) => {
                      // Replace the index tab in-place with a detail view so we don't
                      // accumulate orphaned tabs.
                      setOpenFiles((prev) => prev.map((f) =>
                        f.path === activeFile.path
                          ? { ...f, path: `run-viewer://${id}`, name: `Run · ${id.slice(0, 10)}`, runId: id }
                          : f
                      ));
                      setActiveFilePath(`run-viewer://${id}`);
                    }}
                    onBack={() => {
                      setOpenFiles((prev) => prev.map((f) =>
                        f.path === activeFile.path
                          ? { ...f, path: 'run-viewer://index', name: 'Runs', runId: undefined }
                          : f
                      ));
                      setActiveFilePath('run-viewer://index');
                    }}
                  />
                ) : activeFile.isSystemCheck ? (
                  <SystemCheck projectFolder={projectPath} />
                ) : activeFile.isBrowser || activeFile.isReport ? (
                  <AgentBrowserPanel
                    liveSessionState={activeFile.runId ? undefined : browserSessionState}
                    liveBrowserSteps={activeFile.runId ? undefined : currentBrowserSteps}
                    runId={activeFile.runId}
                    projectFolder={projectPath}
                  />
                ) : (
                  <CodeEditor
                    file={activeFile}
                    onChange={(content) => updateFileContent(activeFile.path, content)}
                    onSave={() => saveFile(activeFile.path)}
                    onContextUpdate={updateEditorContext}
                  />
                )
              )}

              {/* Minimal Empty State when no tabs are open */}
              {!activeFile && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled)', gap: '16px' }}>
                  <Zap size={32} style={{ opacity: 0.35, color: 'var(--accent-primary)' }} />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    <button className="btn" onClick={() => setSidebarOpen(true)}>Open Explorer</button>
                    <button className="btn btn--primary" onClick={() => {
                        setOpenFiles([{ path: 'agent://workspace', name: 'Agent', content: '', language: 'agent', isDirty: false, isAgent: true }]);
                        setActiveFilePath('agent://workspace');
                    }}>Open Agent</button>
                  </div>
                </div>
              )}
            </div>
            {/* Preview Panel — side by side with editor */}
            {previewOpen && (
              <PreviewPanel
                isOpen={previewOpen}
                onClose={() => setPreviewOpen(false)}
                projectFolder={projectPath}
                previewFile={previewFile}
              />
            )}
          </div>
          <TerminalPanel isOpen={terminalOpen} onToggle={() => setTerminalOpen(false)} projectFolder={projectPath} externalCommand={externalCommand} onExternalCommandDone={() => setExternalCommand(null)} />
        </div>
      </main>

      <StatusBar
        gcpProject={config.gcpProject}
        providerId={config.selectedProviderId || config.providerId}
        activeFile={activeFile}
        isStreaming={isStreaming}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        selectedModel={config.selectedModel || 'qwen3:8b'}
        onModelChange={(modelId) => updateConfig({ selectedModel: modelId })}
        projectFolder={projectPath}
        onToast={showToast}
        usageSummary={usageSummary}
        brainEntryCount={brain?.entries?.length}
      />

      {/* DiffViewer Modal */}
      <DiffViewer
        projectFolder={projectPath}
        isOpen={showDiffViewer}
        onClose={() => setShowDiffViewer(false)}
      />

      {showFolderBrowser && (
        <FolderBrowser
          currentPath={config.workspacePath || ''}
          onSelect={(path) => {
            updateConfig({ workspacePath: path });
            setShowFolderBrowser(false);
          }}
          onClose={() => setShowFolderBrowser(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={appSettings}
          onSave={(s) => {
            updateConfig({
              gcpProject: s.gcpProject,
              gcpRegion: s.gcpRegion,
              providerId: s.selectedProviderId || s.providerId,
              selectedProviderId: s.selectedProviderId || s.providerId,
              providerKind: s.providerKind,
              temperature: s.temperature,
              maxTokens: s.maxTokens,
              systemInstruction: s.systemInstruction,
              selectedModel: s.selectedModel,
              beginnerMode: s.beginnerMode,
            });
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
          onBrowseFolder={() => {
            setShowSettings(false);
            setFolderBrowserTarget('workspace');
            setShowFolderBrowser(true);
          }}
        />
      )}

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.type}`}>
              {t.type === 'success' ? '✓' : '✗'} {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
