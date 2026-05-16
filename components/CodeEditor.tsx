'use client';

import React, { useCallback, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { OpenFile, EditorContext } from '@/lib/types';

interface CodeEditorProps {
  file: OpenFile;
  onChange: (content: string) => void;
  onSave: () => void;
  onContextUpdate: (ctx: EditorContext | null) => void;
}

export default function CodeEditor({ file, onChange, onSave, onContextUpdate }: CodeEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Keyboard shortcut: Ctrl+S to save
    editor.addAction({
      id: 'orbitcode-save',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSave(),
    });

    // Track selection changes for context
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && model) {
        const selectedText = model.getValueInRange(selection);
        const position = editor.getPosition();
        onContextUpdate({
          filePath: file.path,
          fileName: file.name,
          language: file.language,
          content: model.getValue(),
          selectedText: selectedText || undefined,
          cursorLine: position?.lineNumber,
          cursorColumn: position?.column,
        });
      }
    });

    // Set editor theme customizations
    monaco.editor.defineTheme('orbitcode-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '636980', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c4b5fd' },
        { token: 'string', foreground: '34d399' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'type', foreground: '60a5fa' },
        { token: 'variable', foreground: 'e8eaed' },
        { token: 'function', foreground: 'a78bfa' },
      ],
      colors: {
        'editor.background': '#0a0a0f',
        'editor.foreground': '#e8eaed',
        'editor.lineHighlightBackground': '#1a1e2a',
        'editor.selectionBackground': '#8b5cf633',
        'editor.inactiveSelectionBackground': '#8b5cf622',
        'editorCursor.foreground': '#a78bfa',
        'editorLineNumber.foreground': '#4a4f60',
        'editorLineNumber.activeForeground': '#9aa0b0',
        'editorIndentGuide.background': '#1f2435',
        'editorIndentGuide.activeBackground': '#2d3348',
        'editor.selectionHighlightBackground': '#8b5cf620',
        'editorBracketMatch.background': '#8b5cf630',
        'editorBracketMatch.border': '#8b5cf650',
        'scrollbarSlider.background': '#2d334880',
        'scrollbarSlider.hoverBackground': '#636980',
        'scrollbarSlider.activeBackground': '#9aa0b0',
        'editorWidget.background': '#151820',
        'editorWidget.border': '#ffffff19',
        'editorSuggestWidget.background': '#151820',
        'editorSuggestWidget.border': '#ffffff19',
        'editorSuggestWidget.selectedBackground': '#252a3a',
        'list.hoverBackground': '#252a3a',
        'minimap.background': '#0a0a0f',
      },
    });

    monaco.editor.setTheme('orbitcode-dark');
    editor.focus();
  };

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) onChange(value);
    },
    [onChange]
  );

  return (
    <Editor
      height="100%"
      language={file.language}
      value={file.content}
      onChange={handleChange}
      onMount={handleMount}
      theme="vs-dark"
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontLigatures: true,
        lineNumbers: 'on',
        minimap: { enabled: true, scale: 2, showSlider: 'mouseover' },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        bracketPairColorization: { enabled: true },
        renderLineHighlight: 'all',
        wordWrap: 'on',
        tabSize: 2,
        padding: { top: 12 },
        suggest: {
          showKeywords: true,
          showSnippets: true,
        },
        quickSuggestions: true,
        formatOnPaste: true,
        autoIndent: 'full',
        mouseWheelZoom: true,
      }}
      loading={
        <div className="empty-state">
          <div className="streaming-indicator">
            <span className="streaming-indicator__dot" />
            <span className="streaming-indicator__dot" />
            <span className="streaming-indicator__dot" />
          </div>
          <span style={{ color: '#636980', fontSize: '12px' }}>Loading editor...</span>
        </div>
      }
    />
  );
}
