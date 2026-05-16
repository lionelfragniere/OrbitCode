'use client';

import React from 'react';
import { Zap, FolderOpen, Terminal, GitBranch, Shield, Sparkles } from 'lucide-react';

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  hasProject: boolean;
}

export default function WelcomeScreen({ onOpenFolder, hasProject }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__logo">OrbitCode</div>
      <p className="welcome-screen__subtitle">
        Local AI coding workspace<br />
        use Ollama or your own API keys
      </p>

      <div className="welcome-screen__shortcuts">
        {!hasProject && (
          <button
            className="btn btn--primary"
            onClick={onOpenFolder}
            style={{ gap: '8px', fontSize: '13px', padding: '10px 24px', marginBottom: '16px' }}
          >
            <FolderOpen size={16} />
            Open Project Folder
          </button>
        )}

        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginTop: '8px', marginBottom: '4px' }}>
          Keyboard Shortcuts
        </div>
        <div className="welcome-screen__shortcut">
          <kbd>Ctrl+S</kbd>
          <span>Save current file</span>
        </div>
        <div className="welcome-screen__shortcut">
          <kbd>Ctrl+B</kbd>
          <span>Toggle file explorer</span>
        </div>
        <div className="welcome-screen__shortcut">
          <kbd>Ctrl+J</kbd>
          <span>Toggle AI chat panel</span>
        </div>
        <div className="welcome-screen__shortcut">
          <kbd>Ctrl+`</kbd>
          <span>Toggle terminal</span>
        </div>
        <div className="welcome-screen__shortcut">
          <kbd>Shift+Enter</kbd>
          <span>New line in chat</span>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginTop: '16px', marginBottom: '4px' }}>
          Capabilities
        </div>
        <div className="welcome-screen__shortcut" style={{ fontFamily: 'var(--font-ui)' }}>
          <Sparkles size={12} style={{ color: 'var(--accent-primary)' }} />
          <span>AI code generation, explain, refactor, debug</span>
        </div>
        <div className="welcome-screen__shortcut" style={{ fontFamily: 'var(--font-ui)' }}>
          <Terminal size={12} style={{ color: '#34d399' }} />
          <span>Built-in terminal to run builds & commands</span>
        </div>
        <div className="welcome-screen__shortcut" style={{ fontFamily: 'var(--font-ui)' }}>
          <GitBranch size={12} style={{ color: '#60a5fa' }} />
          <span>Git integration: commit, push, pull, branch</span>
        </div>
        <div className="welcome-screen__shortcut" style={{ fontFamily: 'var(--font-ui)' }}>
          <Shield size={12} style={{ color: '#34d399' }} />
          <span>Secrets are stored locally and encrypted</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '16px', fontSize: '10px', color: 'var(--text-disabled)' }}>
        <Zap size={10} /> Local-first with pluggable AI providers
      </div>
    </div>
  );
}
