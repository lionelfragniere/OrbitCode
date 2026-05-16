'use client';

import React, { useEffect, useState } from 'react';
import { Zap, ChevronDown, Check, Sparkles } from 'lucide-react';
import { MODEL_REGISTRY, type ModelInfo } from '@/lib/models';

interface ModelSelectorProps {
  selectedModel: string;
  onSelect: (modelId: string) => void;
}

export default function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customModel, setCustomModel] = useState(selectedModel);
  const current = MODEL_REGISTRY.find((m) => m.id === selectedModel);
  const displayName = current?.name || selectedModel || 'Custom model';

  useEffect(() => {
    setCustomModel(selectedModel);
  }, [selectedModel]);

  const applyCustomModel = () => {
    const value = customModel.trim();
    if (!value) return;
    onSelect(value);
    setIsOpen(false);
  };

  return (
    <div className="model-selector" style={{ position: 'relative' }}>
      <button
        className="model-selector__trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={`Current model: ${displayName}`}
      >
        <Zap size={11} />
        <span>{displayName}</span>
        <ChevronDown size={10} style={{ opacity: 0.5 }} />
      </button>

      {isOpen && (
        <>
          <div
            className="model-selector__backdrop"
            onClick={() => setIsOpen(false)}
          />
          <div className="model-selector__dropdown">
            <div className="model-selector__dropdown-header">
              <Sparkles size={12} style={{ color: 'var(--accent-primary)' }} />
              Select or enter model
            </div>
            <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                className="field__input"
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyCustomModel();
                  }
                }}
                placeholder="Type any model ID, e.g. gpt-5.4"
                style={{ width: '100%', fontSize: 11, marginBottom: 6 }}
              />
              <button
                className="btn btn--ghost"
                type="button"
                onClick={applyCustomModel}
                style={{ width: '100%', justifyContent: 'center', fontSize: 11 }}
              >
                Use typed model
              </button>
            </div>
            {MODEL_REGISTRY.map((model: ModelInfo) => (
              <button
                key={model.id}
                className={`model-selector__option ${model.id === selectedModel ? 'model-selector__option--active' : ''}`}
                onClick={() => { onSelect(model.id); setIsOpen(false); }}
              >
                <div className="model-selector__option-info">
                  <span className="model-selector__option-name">
                    {model.name}
                    {model.default && (
                      <span className="model-selector__default-badge">default</span>
                    )}
                  </span>
                  <span className="model-selector__option-desc">{model.description}</span>
                  <span className="model-selector__option-pricing">
                    ${model.inputPricePerMToken}/1M in · ${model.outputPricePerMToken}/1M out
                  </span>
                </div>
                {model.id === selectedModel && (
                  <Check size={13} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
