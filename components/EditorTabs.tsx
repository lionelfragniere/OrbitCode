'use client';

import React from 'react';
import { X, Sparkles } from 'lucide-react';
import { OpenFile } from '@/lib/types';

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onSave: (path: string) => void;
}

export default function EditorTabs({
  openFiles,
  activeFilePath,
  onSelect,
  onClose,
  onSave,
}: EditorTabsProps) {
  if (openFiles.length === 0) return null;

  return (
    <div className="editor-tabs">
      {openFiles.map((file) => (
        <div
          key={file.path}
          className={`editor-tab ${file.path === activeFilePath ? 'editor-tab--active' : ''}`}
          onClick={() => onSelect(file.path)}
          onDoubleClick={() => onSave(file.path)}
          title={`${file.path}${file.isDirty ? ' (unsaved)' : ''}\nDouble-click to save`}
        >
          {file.isDirty && <span className="editor-tab__dot" />}
          {file.isAgent && <Sparkles size={12} style={{ color: 'var(--accent-primary)', marginRight: '4px' }} />}
          <span>{file.name}</span>
          <span
            className="editor-tab__close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(file.path);
            }}
          >
            <X size={12} />
          </span>
        </div>
      ))}
    </div>
  );
}
