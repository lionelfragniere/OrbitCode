'use client';

import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('OrbitCode Error Boundary:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
    
    // Log to audit
    fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ui_error',
        category: 'error',
        user: 'system',
        details: {
          message: error.message,
          stack: error.stack?.substring(0, 500),
          componentStack: errorInfo.componentStack?.substring(0, 500),
        },
        result: 'error',
      }),
    }).catch(() => {});
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          gap: '16px',
          color: 'var(--text-secondary)',
          textAlign: 'center',
        }}>
          <AlertTriangle size={32} style={{ color: 'var(--color-error)' }} />
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Something went wrong</h3>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-disabled)', maxWidth: '400px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              background: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
