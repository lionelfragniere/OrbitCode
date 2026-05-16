'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sparkles, User, Send, Trash2, Copy, ClipboardCheck,
  FileDown, FilePlus, Check, X, FileCheck, Terminal, Play, Zap, ZapOff,
  MessageSquare, Bot
} from 'lucide-react';
import { ChatMessage, OpenFile, ChatMode } from '@/lib/types';

interface ChatPanelProps {
  isOpen: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  onApplyCode: (code: string) => void;
  onSaveAsFile: (path: string, content: string) => void;
  onAutoCreateFiles: (files: Array<{ path: string; content: string }>) => void;
  onRunCommand?: (command: string) => void;
  activeFile: OpenFile | null;
  chatMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  isAgentRunning: boolean;
}

const SUGGESTED_PROMPTS = [
  'Explain this file',
  'Find bugs',
  'Add error handling',
  'Write unit tests',
  'Refactor for clarity',
  'Add TypeScript types',
  'Optimize performance',
];

/* ─── Helpers ─── */

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

/** Detect if a language identifier looks like a file path */
function isFilePath(lang: string): boolean {
  if (!lang) return false;
  // Known exact filenames without extensions that should be auto-created
  const KNOWN_FILES = ['dockerfile', 'makefile', 'procfile', '.gitignore', '.dockerignore', 
    '.env', '.env.example', '.env.local', '.eslintrc', '.prettierrc', '.babelrc',
    'gemfile', 'rakefile', 'cmakelists.txt', '.htaccess'];
  if (KNOWN_FILES.includes(lang.toLowerCase())) return true;
  // Pure language identifiers (NOT file paths)
  const PURE_LANGUAGES = ['tsx', 'ts', 'jsx', 'js', 'py', 'html', 'css', 'json', 'yaml', 'yml',
    'md', 'sql', 'sh', 'bash', 'powershell', 'go', 'rust', 'java', 'c', 'cpp', 'rb', 'php',
    'swift', 'kotlin', 'dart', 'r', 'lua', 'perl', 'scala', 'xml', 'toml', 'ini',
    'graphql', 'proto', 'prisma', 'text', 'plaintext', 'diff', 'log'];
  if (PURE_LANGUAGES.includes(lang.toLowerCase())) return false;
  // Has a file extension like .ts, .html, .py, etc.
  if (/\.[a-zA-Z0-9]+$/.test(lang)) return true;
  return false;
}

/** Extract all file code blocks from markdown content */
export function extractFileBlocks(markdown: string): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = [];
  // Match ```filename\n...content...\n```
  const regex = /```([^\n]+)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const lang = match[1].trim();
    const content = match[2];
    if (isFilePath(lang)) {
      blocks.push({ path: lang, content: content.trimEnd() });
    }
  }
  return blocks;
}

/** Extract terminal commands from markdown content (```sh or ```bash blocks) */
export function extractTerminalCommands(markdown: string): string[] {
  const cmds: string[] = [];
  const regex = /```(?:sh|bash|shell|powershell|cmd|terminal)\n([\s\S]*?)```/gi;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const content = match[1].trim();
    // Split into individual commands (skip comments)
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        cmds.push(trimmed);
      }
    });
  }
  return cmds;
}

/* ─── Code Block with actions ─── */

function CodeBlockWithActions({
  children,
  language,
  onApply,
  onCopy,
  onSaveAs,
  onRunCommand,
  autoSaved,
}: {
  children: React.ReactNode;
  language?: string;
  onApply: (code: string) => void;
  onCopy: (code: string) => void;
  onSaveAs: (code: string, suggestedName: string) => void;
  onRunCommand?: (command: string) => void;
  autoSaved?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [ran, setRan] = useState(false);
  const codeText = extractText(children);

  const handleCopy = () => {
    onCopy(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isShellBlock = language && ['sh', 'bash', 'shell', 'powershell', 'cmd', 'terminal'].includes(language.toLowerCase());
  const suggestedFileName = language && isFilePath(language) ? language : '';

  return (
    <div className="code-block-wrapper">
      <pre>
        <code>{children}</code>
      </pre>
      <div className="code-block-actions">
        {language && (
          <span style={{ fontSize: '9px', color: autoSaved ? 'var(--color-success)' : isShellBlock ? 'var(--accent-primary)' : 'var(--text-disabled)', marginRight: '4px', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: '3px' }}>
            {autoSaved && <FileCheck size={9} />}
            {isShellBlock && <Terminal size={9} />}
            {language}
          </span>
        )}
        {isShellBlock && onRunCommand && (
          <button
            className="code-block-action"
            onClick={() => {
              // Run each line as a command
              codeText.split('\n').forEach((line) => {
                const cmd = line.trim();
                if (cmd && !cmd.startsWith('#') && !cmd.startsWith('//')) {
                  onRunCommand(cmd);
                }
              });
              setRan(true);
              setTimeout(() => setRan(false), 3000);
            }}
            title="Run in terminal"
            style={ran ? { color: 'var(--color-success)' } : { color: 'var(--accent-primary)' }}
          >
            {ran ? <Check size={11} /> : <Play size={11} />}
            {ran ? 'Running' : 'Run'}
          </button>
        )}
        <button className="code-block-action" onClick={handleCopy} title="Copy code">
          {copied ? <ClipboardCheck size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="code-block-action" onClick={() => onApply(codeText)} title="Replace editor">
          <FileDown size={11} />
          Apply
        </button>
        {!autoSaved && !isShellBlock && (
          <button className="code-block-action" onClick={() => onSaveAs(codeText, suggestedFileName)} title="Save as file">
            <FilePlus size={11} />
            Save As
          </button>
        )}
        {autoSaved && (
          <span style={{ fontSize: '9px', color: 'var(--color-success)', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <FileCheck size={10} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Save-as inline bar ─── */

function SaveAsBar({
  code,
  suggestedName,
  onSave,
  onCancel,
}: {
  code: string;
  suggestedName: string;
  onSave: (path: string, content: string) => void;
  onCancel: () => void;
}) {
  const [fileName, setFileName] = useState(suggestedName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  return (
    <form className="save-as-bar" onSubmit={(e) => { e.preventDefault(); if (fileName.trim()) onSave(fileName.trim(), code); }}>
      <FilePlus size={12} style={{ color: 'var(--accent-secondary)', flexShrink: 0 }} />
      <input ref={inputRef} type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="path/to/file.ts" />
      <button type="submit" className="icon-btn" style={{ width: '20px', height: '20px' }} disabled={!fileName.trim()}>
        <Check size={12} style={{ color: 'var(--color-success)' }} />
      </button>
      <button type="button" className="icon-btn" style={{ width: '20px', height: '20px' }} onClick={onCancel}>
        <X size={12} />
      </button>
    </form>
  );
}

/* ─── Main ChatPanel ─── */

export default function ChatPanel({
  isOpen,
  messages,
  isStreaming,
  onSend,
  onClear,
  onApplyCode,
  onSaveAsFile,
  onAutoCreateFiles,
  onRunCommand,
  activeFile,
  chatMode,
  onModeChange,
  isAgentRunning,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [saveAsState, setSaveAsState] = useState<{ code: string; name: string } | null>(null);
  const [autoSavedPaths, setAutoSavedPaths] = useState<Set<string>>(new Set());
  const [autoExec, setAutoExec] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevStreamingRef = useRef(isStreaming);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '20px';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // ★ AUTO-FILE CREATION + AUTO-EXEC: When streaming finishes, parse and create files, then run commands
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      // Streaming just finished — check last assistant message for file blocks
      const lastMsg = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastMsg?.content) {
        const fileBlocks = extractFileBlocks(lastMsg.content);
        if (fileBlocks.length > 0) {
          onAutoCreateFiles(fileBlocks);
          setAutoSavedPaths((prev) => {
            const next = new Set(prev);
            fileBlocks.forEach((f) => next.add(f.path));
            return next;
          });
        }

        // ★ AUTO-EXECUTE: Automatically run terminal commands if auto-exec is enabled
        if (autoExec && onRunCommand) {
          const commands = extractTerminalCommands(lastMsg.content);
          if (commands.length > 0) {
            // Small delay to let file creation complete first
            const delay = fileBlocks.length > 0 ? 1500 : 300;
            setTimeout(() => {
              // Chain commands with && to run sequentially
              const chainedCmd = commands.join(' && ');
              onRunCommand(chainedCmd);
            }, delay);
          }
        }
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, messages, onAutoCreateFiles, autoExec, onRunCommand]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    onSend(input.trim());
    setInput('');
  }, [input, isStreaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`chat-panel ${!isOpen ? 'chat-panel--collapsed' : ''}`}>
      <div className="chat-panel__header">
        <div className="chat-panel__title">
          <Sparkles size={14} style={{ color: 'var(--accent-primary)' }} />
          AI
          {/* Mode toggle */}
          <div className="mode-toggle">
            <button
              className={`mode-toggle__btn ${chatMode === 'chat' ? 'mode-toggle__btn--active' : ''}`}
              onClick={() => onModeChange('chat')}
              title="Chat mode — markdown streaming with auto-file-creation"
            >
              <MessageSquare size={10} />
              Chat
            </button>
            <button
              className={`mode-toggle__btn ${chatMode === 'agent' ? 'mode-toggle__btn--active' : ''}`}
              onClick={() => onModeChange('agent')}
              title="Agent mode — autonomous multi-step execution with tool calling"
            >
              <Bot size={10} />
              Agent
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {chatMode === 'chat' && (
            <button
              className={`icon-btn ${autoExec ? 'icon-btn--active' : ''}`}
              onClick={() => setAutoExec(!autoExec)}
              title={autoExec ? 'Auto-execute ON — commands run automatically' : 'Auto-execute OFF — manual mode'}
              style={autoExec ? { color: 'var(--color-success)' } : { color: 'var(--text-disabled)' }}
            >
              {autoExec ? <Zap size={14} /> : <ZapOff size={14} />}
            </button>
          )}
          {chatMode === 'agent' && isAgentRunning && (
            <span className="agent-mode-indicator">
              <Bot size={10} />
              Working...
            </span>
          )}
          <button className="icon-btn" onClick={onClear} title="Clear chat">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <div className="empty-state" style={{ gap: '16px' }}>
            <Sparkles size={28} className="empty-state__icon" />
            <span className="empty-state__text">
              Ask me to build features, explain code, fix bugs, or create new files.<br />
              I have context about your project and current file.<br />
              <strong style={{ color: 'var(--accent-secondary)' }}>Files are auto-created & commands auto-run.</strong>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: autoExec ? 'var(--color-success)' : 'var(--text-disabled)', marginTop: '4px' }}>
              {autoExec ? <Zap size={10} /> : <ZapOff size={10} />}
              {autoExec ? '⚡ Autonomous mode ON — I run commands automatically' : '⏸ Manual mode — click ▶ Run to execute commands'}
            </div>
            <div className="suggested-prompts">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button key={prompt} className="suggested-prompt" onClick={() => { setInput(prompt); textareaRef.current?.focus(); }}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-message__avatar">
              {msg.role === 'user' ? (
                <><User size={12} /> You</>
              ) : (
                <><Sparkles size={12} style={{ color: 'var(--accent-primary)' }} /> OrbitCode</>
              )}
            </div>
            <div className="chat-message__bubble">
              {msg.role === 'assistant' ? (
                <>
                  {msg.content ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children }) => {
                          let language = '';
                          if (React.isValidElement(children)) {
                            const className = (children.props as { className?: string }).className || '';
                            const match = className.match(/language-(\S+)/);
                            if (match) language = match[1];
                          }
                          const codeChildren = React.isValidElement(children)
                            ? (children.props as { children?: React.ReactNode }).children
                            : children;

                          return (
                            <CodeBlockWithActions
                              language={language}
                              onApply={onApplyCode}
                              onCopy={(code) => navigator.clipboard.writeText(code)}
                              onSaveAs={(code, name) => setSaveAsState({ code, name })}
                              onRunCommand={onRunCommand}
                              autoSaved={isFilePath(language) && autoSavedPaths.has(language)}
                            >
                              {codeChildren}
                            </CodeBlockWithActions>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <div className="streaming-indicator">
                      <span className="streaming-indicator__dot" />
                      <span className="streaming-indicator__dot" />
                      <span className="streaming-indicator__dot" />
                    </div>
                  )}
                </>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Save As bar */}
      {saveAsState && (
        <div style={{ padding: '0 16px 8px' }}>
          <SaveAsBar
            code={saveAsState.code}
            suggestedName={saveAsState.name}
            onSave={(path, content) => { onSaveAsFile(path, content); setSaveAsState(null); }}
            onCancel={() => setSaveAsState(null)}
          />
        </div>
      )}

      <div className="chat-input">
        {activeFile && (
          <div className="chat-input__context">
            <FileDown size={10} />
            Context: <span className="chat-input__context-file">{activeFile.name}</span>
          </div>
        )}
        <div className="chat-input__wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input__textarea"
            placeholder={chatMode === 'agent' ? 'Tell the agent what to build, fix, or create...' : 'Ask me to build, explain, fix, or create files...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button className="chat-input__send" onClick={handleSend} disabled={!input.trim() || isStreaming} title="Send">
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
