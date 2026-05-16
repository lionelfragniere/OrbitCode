'use client';

import React, { useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronUp, X, Shield, Loader2
} from 'lucide-react';
import type { ActionEvaluation, RecoveryAction } from '@/lib/types';

interface GitActionDialogProps {
  title: string;
  evaluation: ActionEvaluation;
  onAction: (actionId: string) => void;
  onClose: () => void;
  loading?: string | null;
}

const RISK_COLORS: Record<string, string> = {
  safe: 'var(--color-success)',
  moderate: 'var(--color-warning)',
  destructive: 'var(--color-error)',
};

export default function GitActionDialog({ title, evaluation, onAction, onClose, loading }: GitActionDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleAction = (ra: RecoveryAction) => {
    if (ra.confirmRequired && confirmId !== ra.id) {
      setConfirmId(ra.id);
      return;
    }
    onAction(ra.id);
    setConfirmId(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="git-action-dialog" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="git-action-dialog__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />
            <span className="git-action-dialog__title">{title}</span>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        {/* Summary */}
        <div className="git-action-dialog__body">
          <p className="git-action-dialog__summary">{evaluation.summary}</p>

          {evaluation.blockers.length > 0 && (
            <div className="git-action-dialog__section">
              {evaluation.blockers.map((b, i) => (
                <div key={i} className="git-action-dialog__blocker">
                  <Shield size={11} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: '1px' }} />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}

          {evaluation.warnings.length > 0 && (
            <div className="git-action-dialog__section">
              {evaluation.warnings.map((w, i) => (
                <div key={i} className="git-action-dialog__warning">
                  <AlertTriangle size={11} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: '1px' }} />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recovery Actions */}
          {evaluation.recoveryActions.length > 0 && (
            <div className="git-action-dialog__actions">
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                What would you like to do?
              </div>
              {evaluation.recoveryActions.map((ra) => (
                <button
                  key={ra.id}
                  className={`git-action-dialog__action git-action-dialog__action--${ra.risk}`}
                  onClick={() => handleAction(ra)}
                  disabled={!!loading}
                  title={ra.description}
                >
                  {loading === ra.id ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <span className="git-action-dialog__action-label">{ra.label}</span>
                  )}
                  <span className="git-action-dialog__action-desc">{ra.description}</span>
                  {confirmId === ra.id && (
                    <span className="git-action-dialog__confirm-badge">Click again to confirm</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Technical Details (collapsible) */}
          {evaluation.technicalDetails && (
            <div className="git-action-dialog__details-section">
              <button
                className="git-action-dialog__details-toggle"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Technical details
              </button>
              {showDetails && (
                <pre className="git-action-dialog__details">{evaluation.technicalDetails}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
