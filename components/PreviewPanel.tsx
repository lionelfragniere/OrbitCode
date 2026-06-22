'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Globe, X, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';

interface PreviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectFolder: string;
  previewFile: string; // e.g. "index.html"
}

export default function PreviewPanel({ isOpen, onClose, projectFolder, previewFile }: PreviewPanelProps) {
  const [key, setKey] = useState(0); // Force iframe reload
  const [locationState, setLocationState] = useState<{ sourceFile: string; href: string; filePath: string } | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(previewFile);
  const url = isOpen && projectFolder && previewFile
    ? `/api/preview?projectFolder=${encodeURIComponent(projectFolder)}&filePath=${encodeURIComponent(previewFile)}`
    : '';
  const activeLocation = locationState?.sourceFile === previewFile ? locationState : null;
  const displayFile = activeLocation?.filePath || previewFile;
  const currentUrl = activeLocation?.href || url;
  const loadKey = url ? `${url}:${key}` : '';
  const loading = !!url && loadedKey !== loadKey;

  useEffect(() => {
    if (!loadKey || loadedKey === loadKey) return;
    // ponytail: local iframe load events can be swallowed; add error UI if preview requests stop being local.
    const timer = window.setTimeout(() => setLoadedKey(loadKey), 1500);
    return () => window.clearTimeout(timer);
  }, [loadKey, loadedKey]);

  const applyLocation = useCallback((href: string) => {
    try {
      const nextUrl = new URL(href, window.location.href);
      if (nextUrl.origin !== window.location.origin || nextUrl.pathname !== '/api/preview') return;
      const filePath = nextUrl.searchParams.get('filePath');
      setLocationState({ sourceFile: previewFile, href: nextUrl.href, filePath: filePath || previewFile });
    } catch {}
  }, [previewFile]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: string; href?: string } | null;
      if (data?.type !== 'orbitcode:preview-location' || typeof data.href !== 'string') return;
      setLoadedKey(loadKey);
      applyLocation(data.href);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [applyLocation, loadKey]);

  const handleRefresh = () => {
    setKey((k) => k + 1);
  };

  const handleOpenExternal = () => {
    if (currentUrl || url) window.open(currentUrl || url, '_blank');
  };

  const handleFrameLoad = () => {
    setLoadedKey(loadKey);
    try {
      const href = iframeRef.current?.contentWindow?.location.href;
      if (href) applyLocation(href);
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <div className="preview-panel">
      {/* Header */}
      <div className="preview-header">
        <div className="preview-header__title">
          <Globe size={13} style={{ color: 'var(--color-info)' }} />
          Preview
        </div>
        <div className="preview-header__url">
          {displayFile}
        </div>
        <div className="preview-header__actions">
          <button className="icon-btn" onClick={handleRefresh} title="Refresh" aria-label="Refresh preview">
            <RefreshCw size={12} />
          </button>
          <button className="icon-btn" onClick={handleOpenExternal} title="Open in browser" aria-label="Open preview in browser">
            <ExternalLink size={12} />
          </button>
          <button className="icon-btn" onClick={onClose} title="Close preview" aria-label="Close preview">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div
        className="preview-content"
        data-loading={loading ? 'true' : 'false'}
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: isImage ? 'var(--bg-tertiary)' : undefined, overflow: 'auto' }}
      >
        {url ? (
          isImage ? (
            <img 
              key={key} 
              src={url} 
              alt={previewFile}
              title={previewFile}
              onLoad={() => setLoadedKey(loadKey)}
              onError={() => setLoadedKey(loadKey)}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                display: 'block',
                // Optional checkered pattern for transparent images
                backgroundImage: 'repeating-linear-gradient(45deg, var(--bg-primary) 25%, transparent 25%, transparent 75%, var(--bg-primary) 75%, var(--bg-primary)), repeating-linear-gradient(45deg, var(--bg-primary) 25%, var(--bg-secondary) 25%, var(--bg-secondary) 75%, var(--bg-primary) 75%, var(--bg-primary))',
                backgroundPosition: '0 0, 8px 8px',
                backgroundSize: '16px 16px',
              }}
            />
          ) : (
            <iframe
              key={`${url}:${key}`}
              ref={iframeRef}
              src={url}
              className="preview-iframe"
              sandbox="allow-scripts allow-forms allow-popups"
              title="Preview"
              onLoad={handleFrameLoad}
            />
          )
        ) : (
          <div className="empty-state">
            <Globe size={28} className="empty-state__icon" />
            <span className="empty-state__text">No file to preview</span>
          </div>
        )}
        {loading && (
          <div className="preview-loading" role="status" aria-live="polite">
            <Loader2 size={16} className="spin" />
            <span>Loading preview...</span>
          </div>
        )}
      </div>
    </div>
  );
}
