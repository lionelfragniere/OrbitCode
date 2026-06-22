'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight, FolderOpen, Globe, Search, Shield, Zap } from 'lucide-react';
import { AppSettings, DEFAULT_SETTINGS } from '@/lib/types';

interface SetupScreenProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBrowseFolder: () => void;
}

function defaultModelForProvider(providerId: string): string {
  if (providerId === 'openai') return 'gpt-4.1';
  if (providerId === 'anthropic') return 'claude-sonnet-4-5';
  if (providerId === 'gemini-api' || providerId === 'vertex-ai') return 'gemini-2.5-flash';
  return 'qwen3:8b';
}

interface LocalModelStatus {
  ollamaInstalled: boolean;
  ollamaModels: string[];
}

export default function SetupScreen({ settings, onSave, onBrowseFolder }: SetupScreenProps) {
  const [draft, setDraft] = useState<AppSettings>({
    ...DEFAULT_SETTINGS,
    ...settings,
    providerId: settings.providerId || 'local-ollama',
    selectedProviderId: settings.selectedProviderId || settings.providerId || 'local-ollama',
    selectedModel: settings.selectedModel || 'qwen3:8b',
    beginnerMode: settings.beginnerMode ?? true,
  });
  const [localStatus, setLocalStatus] = useState<LocalModelStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/local-llm/status')
      .then((response) => response.json())
      .then((status) => {
        if (!cancelled) {
          setLocalStatus({
            ollamaInstalled: Boolean(status.ollamaInstalled ?? status.ollama?.installed),
            ollamaModels: status.ollamaModels || status.ollama?.modelNames || [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLocalStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isValid = draft.projectFolder.trim();
  const localModelInstalled = Boolean(localStatus?.ollamaModels.some((model) => {
    const current = draft.selectedModel.toLowerCase();
    const installed = model.toLowerCase();
    return installed === current || (!current.includes(':') && installed.startsWith(`${current}:`));
  }));
  const installedModels = localStatus?.ollamaModels.length ? localStatus.ollamaModels.join(', ') : 'none';

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-card__brand">
          <div className="setup-card__logo">OrbitCode</div>
          <p className="setup-card__subtitle">
            Local AI coding workspace with pluggable models
          </p>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'rgba(52, 211, 153, 0.08)',
          border: '1px solid rgba(52, 211, 153, 0.2)',
          borderRadius: '8px',
          fontSize: '11px',
          color: 'var(--color-success)',
        }}>
          <Shield size={14} />
          <span>Use local Ollama, your own API keys, GPT, Claude, Gemini, or Vertex AI.</span>
        </div>

        <div className="setup-card__divider" />

        <div className="field">
          <label className="field__label">
            <Shield size={13} />
            Beginner Mode
          </label>
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '10px 12px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={draft.beginnerMode}
              onChange={(e) => setDraft({ ...draft, beginnerMode: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Recommended: keep code panels tucked away and use simpler explanations until you ask for more detail.
            </span>
          </label>
        </div>

        <div className="field">
          <label className="field__label">
            <Zap size={13} />
            Provider
          </label>
          <select
            className="field__select"
            value={draft.selectedProviderId}
            onChange={(e) => {
              const providerId = e.target.value;
              setDraft({
                ...draft,
                providerId,
                selectedProviderId: providerId,
                providerKind: providerId === 'vertex-ai' ? 'vertex' : providerId === 'openai' ? 'openai' : providerId === 'anthropic' ? 'anthropic' : providerId === 'gemini-api' ? 'gemini' : 'ollama',
                selectedModel: defaultModelForProvider(providerId),
              });
            }}
          >
            <option value="local-ollama">Ollama Local (recommended)</option>
            <option value="openai">OpenAI API</option>
            <option value="anthropic">Anthropic API</option>
            <option value="gemini-api">Gemini API</option>
            <option value="vertex-ai">Vertex AI</option>
          </select>
          <span className="field__hint" style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>
            API keys are configured later in Settings and stored encrypted locally.
          </span>
        </div>

        {draft.selectedProviderId === 'local-ollama' && localStatus?.ollamaInstalled === false && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '12px',
            background: 'rgba(96, 165, 250, 0.08)',
            border: '1px solid rgba(96, 165, 250, 0.22)',
            borderRadius: '8px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
              Local AI needs Ollama
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Ollama is optional and can use a lot of disk space, so OrbitCode will not install it silently. Install it only if you want models running on this PC.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => window.open('https://ollama.com/download', '_blank', 'noopener,noreferrer')}
              >
                Install Ollama
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => setDraft({
                  ...draft,
                  providerId: 'openai',
                  selectedProviderId: 'openai',
                  providerKind: 'openai',
                  selectedModel: defaultModelForProvider('openai'),
                })}
              >
                Use an API instead
              </button>
            </div>
          </div>
        )}

        {draft.selectedProviderId === 'local-ollama' && localStatus?.ollamaInstalled && (
          <div style={{
            padding: '10px 12px',
            background: localModelInstalled ? 'rgba(52, 211, 153, 0.08)' : 'rgba(255, 203, 56, 0.08)',
            border: localModelInstalled ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(255, 203, 56, 0.22)',
            borderRadius: '8px',
            fontSize: '11px',
            color: localModelInstalled ? 'var(--color-success)' : '#FFCB38',
          }}>
            {localModelInstalled
              ? `Local model installed: ${draft.selectedModel}. Available: ${installedModels}`
              : `Model not installed. Run: ollama pull ${draft.selectedModel || 'qwen3:8b'}. Available: ${installedModels}`}
          </div>
        )}

        <div className="field">
          <label className="field__label">
            <Zap size={13} />
            Model ID
            <span className="field__hint">(editable)</span>
          </label>
          <input
            className="field__input"
            type="text"
            placeholder="Type any model ID, e.g. gpt-5.4"
            value={draft.selectedModel}
            onChange={(e) => setDraft({ ...draft, selectedModel: e.target.value })}
          />
          <span className="field__hint" style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>
            Use the exact model name supported by your provider. Presets are only starting points.
          </span>
        </div>

        {draft.selectedProviderId === 'vertex-ai' && (
        <div className="field">
          <label className="field__label">
            <Zap size={13} />
            Vertex AI Project ID
            <span className="field__hint">(optional)</span>
          </label>
          <input
            className="field__input"
            type="text"
            placeholder="my-gcp-project-id"
            value={draft.gcpProject}
            onChange={(e) => setDraft({ ...draft, gcpProject: e.target.value })}
            autoFocus
          />
        </div>
        )}

        {draft.selectedProviderId === 'vertex-ai' && (
        <div className="field">
          <label className="field__label">
            <Globe size={13} />
            Vertex Region
          </label>
          <select
            className="field__select"
            value={draft.gcpRegion}
            onChange={(e) => setDraft({ ...draft, gcpRegion: e.target.value })}
          >
            <option value="us-central1">us-central1 (Iowa)</option>
            <option value="us-east4">us-east4 (Virginia)</option>
            <option value="us-west1">us-west1 (Oregon)</option>
            <option value="europe-west1">europe-west1 (Belgium)</option>
            <option value="europe-west4">europe-west4 (Netherlands)</option>
            <option value="asia-northeast1">asia-northeast1 (Tokyo)</option>
            <option value="asia-southeast1">asia-southeast1 (Singapore)</option>
          </select>
        </div>
        )}

        <div className="field">
          <label className="field__label">
            <FolderOpen size={13} />
            Project Folder
            <span className="field__hint">(your Git repository / codebase)</span>
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="field__input"
              style={{ flex: 1 }}
              type="text"
              placeholder="C:\Users\you\projects\my-app"
              value={draft.projectFolder}
              onChange={(e) => setDraft({ ...draft, projectFolder: e.target.value })}
            />
            <button
              className="btn btn--ghost"
              onClick={onBrowseFolder}
              style={{ flexShrink: 0, gap: '6px' }}
              type="button"
            >
              <Search size={13} />
              Browse
            </button>
          </div>
        </div>

        <div className="setup-card__divider" />

        <div className="setup-card__actions">
          <button
            className="btn btn--primary"
            onClick={() => onSave(draft)}
            disabled={!isValid}
            style={{ opacity: isValid ? 1 : 0.4, gap: '8px', padding: '10px 24px' }}
          >
            Launch OrbitCode
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
