'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Globe, X, RefreshCw, ExternalLink, ChevronDown } from 'lucide-react';

interface PreviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectFolder: string;
  previewFile: string; // e.g. "index.html"
}

export default function PreviewPanel({ isOpen, onClose, projectFolder, previewFile }: PreviewPanelProps) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState(0); // Force iframe reload
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (isOpen && projectFolder && previewFile) {
      const previewUrl = `/api/preview?projectFolder=${encodeURIComponent(projectFolder)}&filePath=${encodeURIComponent(previewFile)}`;
      setUrl(previewUrl);
    }
  }, [isOpen, projectFolder, previewFile]);

  const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(previewFile);

  const handleRefresh = () => {
    setKey((k) => k + 1);
  };

  const handleOpenExternal = () => {
    if (url) window.open(url, '_blank');
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
          {previewFile}
        </div>
        <div className="preview-header__actions">
          <button className="icon-btn" onClick={handleRefresh} title="Refresh">
            <RefreshCw size={12} />
          </button>
          <button className="icon-btn" onClick={handleOpenExternal} title="Open in browser">
            <ExternalLink size={12} />
          </button>
          <button className="icon-btn" onClick={onClose} title="Close preview">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div className="preview-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: isImage ? 'var(--bg-tertiary)' : undefined, overflow: 'auto' }}>
        {url ? (
          isImage ? (
            <img 
              key={key} 
              src={url} 
              alt={previewFile}
              title={previewFile}
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
              key={key}
              ref={iframeRef}
              src={url}
              className="preview-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              title="Preview"
            />
          )
        ) : (
          <div className="empty-state">
            <Globe size={28} className="empty-state__icon" />
            <span className="empty-state__text">No file to preview</span>
          </div>
        )}
      </div>
    </div>
  );
}
