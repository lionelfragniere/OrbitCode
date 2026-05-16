'use client';

import React, { useState } from 'react';
import { Zap, ChevronDown, Check, Sparkles } from 'lucide-react';
import { MODEL_REGISTRY, type ModelInfo } from '@/lib/models';

interface ModelSelectorProps {
  selectedModel: string;
  onSelect: (modelId: string) => void;
}

export default function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const current = MODEL_REGISTRY.find((m) => m.id === selectedModel) || MODEL_REGISTRY[0];

  return (
    <div className="model-selector" style={{ position: 'relative' }}>
      <button
        className="model-selector__trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={`Current model: ${current.name}`}
      >
        <Zap size={11} />
        <span>{current.name}</span>
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
              Select Model
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
