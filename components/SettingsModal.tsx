'use client';

import React, { useEffect, useState } from 'react';
import { Settings, X, Zap, FolderOpen, Globe, Thermometer, Hash, BookOpen, Search, Shield, Sparkles, Check } from 'lucide-react';
import { AppSettings } from '@/lib/types';
import { MODEL_REGISTRY, type ModelInfo } from '@/lib/models';

interface SettingsModalProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  onBrowseFolder: () => void;
}

export default function SettingsModal({ settings, onSave, onClose, onBrowseFolder }: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [activeTab, setActiveTab] = useState<'general' | 'model' | 'prompt'>('general');
  const [providers, setProviders] = useState<Array<{ id: string; name: string; kind: string; defaultModel: string; enabled: boolean; hasApiKey?: boolean; baseUrl?: string }>>([]);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const [ollamaInstalled, setOllamaInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/providers')
      .then((res) => res.json())
      .then((data) => setProviders(data.providers || []))
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/local-llm/status')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setOllamaInstalled(Boolean(data.ollamaInstalled));
      })
      .catch(() => {
        if (!cancelled) setOllamaInstalled(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const selectedProvider = providers.find((provider) => provider.id === (draft.selectedProviderId || draft.providerId));

  const saveAll = async () => {
    if (selectedProvider && (apiKeyDraft.trim() || baseUrlDraft.trim())) {
      await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedProvider.id,
          name: selectedProvider.name,
          kind: selectedProvider.kind,
          defaultModel: draft.selectedModel || selectedProvider.defaultModel,
          enabled: true,
          baseUrl: baseUrlDraft.trim() || selectedProvider.baseUrl,
          apiKey: apiKeyDraft.trim() || undefined,
        }),
      });
    } else if (draft.selectedProviderId || draft.providerId) {
      await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select', providerId: draft.selectedProviderId || draft.providerId }),
      }).catch(() => undefined);
    }
    onSave(draft);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '540px' }}>
        <div className="modal__header">
          <h2 className="modal__title">
            <Settings size={18} style={{ color: 'var(--accent-primary)' }} />
            Settings
          </h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)',
          padding: '0 16px',
        }}>
          {(['general', 'model', 'prompt'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 14px', fontSize: '11px', fontWeight: 600, border: 'none', background: 'none',
                color: activeTab === tab ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                borderBottom: activeTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="modal__body">
          {/* Privacy notice */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px',
            background: 'rgba(52, 211, 153, 0.08)',
            border: '1px solid rgba(52, 211, 153, 0.2)',
            borderRadius: '8px', fontSize: '11px', color: 'var(--color-success)',
          }}>
            <Shield size={14} style={{ flexShrink: 0 }} />
            <span>Provider credentials stay in local encrypted storage. Local models use Ollama on this machine.</span>
          </div>

          {activeTab === 'general' && (
            <>
              <div className="field">
                <label className="field__label">
                  <Sparkles size={13} />
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
                    onChange={(e) => updateField('beginnerMode', e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Keep code panels closed by default and ask OrbitCode to explain things in simpler language.
                  </span>
                </label>
              </div>

              {selectedProvider?.kind === 'vertex' && (
                <>
                  <div className="field">
                    <label className="field__label">
                      <Zap size={13} />
                      Vertex AI Project ID
                    </label>
                    <input
                      className="field__input"
                      type="text"
                      placeholder="my-gcp-project-id"
                      value={draft.gcpProject}
                      onChange={(e) => updateField('gcpProject', e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="field__label">
                      <Globe size={13} />
                      Vertex Region
                    </label>
                    <select
                      className="field__select"
                      value={draft.gcpRegion}
                      onChange={(e) => updateField('gcpRegion', e.target.value)}
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
                </>
              )}

              {/* Project Folder */}
              <div className="field">
                <label className="field__label">
                  <FolderOpen size={13} />
                  Project Folder
                  <span className="field__hint">(Git repo / codebase)</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    className="field__input"
                    style={{ flex: 1 }}
                    type="text"
                    placeholder="C:\Users\you\projects\my-app"
                    value={draft.projectFolder}
                    onChange={(e) => updateField('projectFolder', e.target.value)}
                  />
                  <button
                    className="btn btn--ghost"
                    onClick={onBrowseFolder}
                    type="button"
                    style={{ flexShrink: 0, gap: '6px' }}
                  >
                    <Search size={13} />
                    Browse
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'model' && (
            <>
              <div className="field">
                <label className="field__label">
                  <Globe size={13} />
                  Provider
                </label>
                <select
                  className="field__select"
                  value={draft.selectedProviderId || draft.providerId}
                  onChange={(e) => {
                    const provider = providers.find((item) => item.id === e.target.value);
                    setBaseUrlDraft(provider?.baseUrl || '');
                    setApiKeyDraft('');
                    setDraft((prev) => ({
                      ...prev,
                      providerId: e.target.value,
                      selectedProviderId: e.target.value,
                      providerKind: provider?.kind,
                      selectedModel: provider?.defaultModel || prev.selectedModel,
                    }));
                  }}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} ({provider.kind})
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '10px', color: 'var(--text-disabled)', marginTop: 4 }}>
                  {selectedProvider?.hasApiKey ? 'Encrypted API key saved locally.' : 'No API key saved for this provider.'}
                </div>
              </div>

              {selectedProvider?.kind === 'ollama' && ollamaInstalled === false && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '12px',
                  marginBottom: '12px',
                  background: 'rgba(96, 165, 250, 0.08)',
                  border: '1px solid rgba(96, 165, 250, 0.22)',
                  borderRadius: '8px',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                    Local AI needs Ollama
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Ollama is optional and can use a lot of disk space. OrbitCode will not install it silently.
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
                      onClick={() => {
                        const openAiProvider = providers.find((provider) => provider.id === 'openai');
                        updateField('providerId', 'openai');
                        updateField('selectedProviderId', 'openai');
                        updateField('providerKind', 'openai');
                        updateField('selectedModel', openAiProvider?.defaultModel || 'gpt-4.1');
                      }}
                    >
                      Use an API instead
                    </button>
                  </div>
                </div>
              )}

              {selectedProvider && selectedProvider.kind !== 'vertex' && selectedProvider.kind !== 'ollama' && (
                <div className="field">
                  <label className="field__label">
                    <Shield size={13} />
                    API Key
                    <span className="field__hint">(stored encrypted locally)</span>
                  </label>
                  <input
                    className="field__input"
                    type="password"
                    placeholder={selectedProvider.hasApiKey ? 'Leave blank to keep saved key' : 'Paste API key'}
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.target.value)}
                  />
                </div>
              )}

              {selectedProvider && (selectedProvider.kind === 'openai-compatible' || selectedProvider.kind === 'ollama') && (
                <div className="field">
                  <label className="field__label">
                    <Globe size={13} />
                    Base URL
                  </label>
                  <input
                    className="field__input"
                    type="text"
                    placeholder="http://localhost:11434/v1"
                    value={baseUrlDraft || selectedProvider.baseUrl || ''}
                    onChange={(e) => setBaseUrlDraft(e.target.value)}
                  />
                </div>
              )}

              {/* Model Selection */}
              <div className="field">
                <label className="field__label">
                  <Sparkles size={13} />
                  AI Model
                  <span className="field__hint">(type any model your provider supports)</span>
                </label>
                <input
                  className="field__input"
                  type="text"
                  value={draft.selectedModel}
                  onChange={(e) => updateField('selectedModel', e.target.value)}
                  placeholder="gpt-5.4, gpt-5.5, claude-sonnet-4-5, qwen3:8b..."
                  style={{ marginBottom: '8px' }}
                />
                <div style={{ fontSize: '10px', color: 'var(--text-disabled)', marginBottom: '8px', lineHeight: 1.5 }}>
                  Presets below are only suggestions. OrbitCode sends the exact model ID you type to the selected provider.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {MODEL_REGISTRY.map((model: ModelInfo) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        updateField('selectedModel', model.id);
                        if (model.providerId) {
                          updateField('providerId', model.providerId);
                          updateField('selectedProviderId', model.providerId);
                          updateField('providerKind', model.providerKind);
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '10px 12px', width: '100%',
                        background: draft.selectedModel === model.id ? 'rgba(96,165,250,0.08)' : 'var(--bg-secondary)',
                        border: draft.selectedModel === model.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {model.name}
                          {model.default && (
                            <span style={{ fontSize: '8px', padding: '1px 4px', background: 'rgba(96,165,250,0.15)', color: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)', fontWeight: 600, textTransform: 'uppercase' }}>
                              default
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-disabled)', marginTop: '2px' }}>
                          {model.description}
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-disabled)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                          ${model.inputPricePerMToken}/1M in · ${model.outputPricePerMToken}/1M out · max {model.maxOutputTokens.toLocaleString()} tokens
                        </div>
                      </div>
                      {draft.selectedModel === model.id && (
                        <Check size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Temperature */}
              <div className="field">
                <label className="field__label">
                  <Thermometer size={13} />
                  Temperature
                </label>
                <div className="field__slider-row">
                  <input
                    className="field__slider"
                    type="range" min="0" max="1" step="0.05"
                    value={draft.temperature}
                    onChange={(e) => updateField('temperature', parseFloat(e.target.value))}
                  />
                  <span className="field__value">{draft.temperature.toFixed(2)}</span>
                </div>
              </div>

              {/* Max Tokens */}
              <div className="field">
                <label className="field__label">
                  <Hash size={13} />
                  Max Output Tokens
                </label>
                <div className="field__slider-row">
                  <input
                    className="field__slider"
                    type="range" min="256" max="65536" step="256"
                    value={draft.maxTokens}
                    onChange={(e) => updateField('maxTokens', parseInt(e.target.value))}
                  />
                  <span className="field__value">{draft.maxTokens.toLocaleString()}</span>
                </div>
              </div>
            </>
          )}

          {activeTab === 'prompt' && (
            <div className="field">
              <label className="field__label">
                <BookOpen size={13} />
                System Instruction
              </label>
              <textarea
                className="field__textarea"
                value={draft.systemInstruction}
                onChange={(e) => updateField('systemInstruction', e.target.value)}
                rows={12}
                placeholder="You are a helpful coding assistant..."
              />
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={() => { void saveAll(); }}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
