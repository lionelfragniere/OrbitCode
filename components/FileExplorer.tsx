'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChevronRight, File, Folder, FolderOpen, RefreshCw,
  FileCode, FileJson, FileText, FileType, Database, Terminal, Image,
  Plus, FolderPlus, ExternalLink, FolderSearch
} from 'lucide-react';
import { FileNode } from '@/lib/types';

interface FileExplorerProps {
  isOpen: boolean;
  fileTree: FileNode[];
  activeFilePath: string | null;
  onFileSelect: (node: FileNode) => void;
  onRefresh: () => void;
  projectFolder: string;
  onOpenInTerminal?: (dirPath: string) => void;
  onToast?: (message: string, type: 'success' | 'error') => void;
}

function getFileIconComponent(name: string, isDirectory: boolean, isOpen?: boolean) {
  if (isDirectory) {
    return isOpen ? <FolderOpen size={15} style={{ color: '#fbbf24' }} /> : <Folder size={15} style={{ color: '#fbbf24' }} />;
  }
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode size={15} style={{ color: '#3b82f6' }} />;
    case 'js':
    case 'jsx':
    case 'mjs':
      return <FileCode size={15} style={{ color: '#eab308' }} />;
    case 'py':
      return <FileCode size={15} style={{ color: '#22c55e' }} />;
    case 'json':
      return <FileJson size={15} style={{ color: '#f97316' }} />;
    case 'md':
      return <FileText size={15} style={{ color: '#60a5fa' }} />;
    case 'css':
    case 'scss':
      return <FileType size={15} style={{ color: '#a78bfa' }} />;
    case 'sql':
      return <Database size={15} style={{ color: '#f472b6' }} />;
    case 'sh':
    case 'bash':
    case 'bat':
    case 'ps1':
      return <Terminal size={15} style={{ color: '#34d399' }} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <Image size={15} style={{ color: '#fb923c' }} />;
    default:
      return <File size={15} style={{ color: '#9aa0b0' }} />;
  }
}

// ════════════════════════════════════════════
//  Context Menu
// ════════════════════════════════════════════
interface ContextMenuProps {
  x: number;
  y: number;
  node: FileNode;
  projectFolder: string;
  onClose: () => void;
  onOpenInTerminal?: (dirPath: string) => void;
  onToast?: (message: string, type: 'success' | 'error') => void;
}

function ContextMenu({ x, y, node, projectFolder, onClose, onOpenInTerminal, onToast }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const targetDir = node.isDirectory ? node.path : node.path.replace(/[/\\][^/\\]+$/, '');
  const fullPath = `${projectFolder}/${node.path}`.replace(/\//g, '\\');
  const fullDir = `${projectFolder}/${targetDir}`.replace(/\//g, '\\');

  const handleOpenInTerminal = () => {
    if (onOpenInTerminal) {
      onOpenInTerminal(fullDir);
    }
    onClose();
  };

  const handleRevealInExplorer = async () => {
    try {
      const res = await fetch('/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectFolder,
          nodePath: node.path,
          isDirectory: node.isDirectory,
        }),
      });
      if (res.ok) {
        onToast?.('Revealed in File Explorer', 'success');
      } else {
        onToast?.('Failed to reveal in File Explorer — this feature requires Windows', 'error');
      }
    } catch {
      onToast?.('Failed to reveal in File Explorer', 'error');
    }
    onClose();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 9999,
      }}
    >
      <button className="context-menu__item" onClick={handleOpenInTerminal}>
        <Terminal size={13} />
        <span>Open in Terminal</span>
      </button>
      <button className="context-menu__item" onClick={handleRevealInExplorer}>
        <FolderSearch size={13} />
        <span>Reveal in File Explorer</span>
      </button>
    </div>
  );
}

// ════════════════════════════════════════════
//  File Node Component
// ════════════════════════════════════════════
interface FileNodeComponentProps {
  node: FileNode;
  depth: number;
  activeFilePath: string | null;
  onSelect: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
}

function FileNodeComponent({ node, depth, activeFilePath, onSelect, onContextMenu }: FileNodeComponentProps) {
  const [isOpen, setIsOpen] = useState(depth < 1);

  const handleClick = () => {
    if (node.isDirectory) {
      setIsOpen(!isOpen);
    } else {
      onSelect(node);
    }
  };

  const isActive = !node.isDirectory && node.path === activeFilePath;

  return (
    <div>
      <div
        className={`file-node ${isActive ? 'file-node--active' : ''} ${node.isDirectory ? 'file-node--directory' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        title={node.path}
      >
        {node.isDirectory && (
          <ChevronRight
            size={14}
            className={`file-node__chevron ${isOpen ? 'file-node__chevron--open' : ''}`}
          />
        )}
        <span className="file-node__icon">
          {getFileIconComponent(node.name, node.isDirectory, isOpen)}
        </span>
        <span className="file-node__name">{node.name}</span>
      </div>
      {node.isDirectory && isOpen && node.children && (
        <div className="file-node__children">
          {node.children.map((child) => (
            <FileNodeComponent
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════
//  Main File Explorer
// ════════════════════════════════════════════
export default function FileExplorer({
  isOpen,
  fileTree,
  activeFilePath,
  onFileSelect,
  onRefresh,
  projectFolder,
  onOpenInTerminal,
  onToast,
}: FileExplorerProps) {
  const [showNewInput, setShowNewInput] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  
  const [runs, setRuns] = useState<{id: string, type: string, timestamp: number, status: string}[]>([]);
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch(`/api/runs?projectFolder=${encodeURIComponent(projectFolder)}`);
      const data = await res.json();
      if (data.runs) setRuns(data.runs);
    } catch {}
    setLoadingRuns(false);
  }, [projectFolder]);

  useEffect(() => {
    if (runsExpanded) {
      loadRuns();
    }
  }, [runsExpanded, loadRuns]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      setShowNewInput(null);
      return;
    }
    try {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectFolder,
          filePath: newName.trim(),
          isDirectory: showNewInput === 'folder',
          content: '',
        }),
      });
      onRefresh();
    } catch (err) {
      console.error('Failed to create:', err);
    }
    setNewName('');
    setShowNewInput(null);
  }, [newName, showNewInput, projectFolder, onRefresh]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const folderName = projectFolder.replace(/\\/g, '/').split('/').pop() || 'Project';

  return (
    <aside className={`sidebar ${!isOpen ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__header">
        <span className="sidebar__title">{folderName}</span>
        <div style={{ display: 'flex', gap: '2px' }}>
          <button className="icon-btn" onClick={() => setShowNewInput('file')} title="New File">
            <Plus size={14} />
          </button>
          <button className="icon-btn" onClick={() => setShowNewInput('folder')} title="New Folder">
            <FolderPlus size={14} />
          </button>
          <button className="icon-btn" onClick={onRefresh} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="sidebar__content">
        {showNewInput && (
          <div style={{ padding: '4px 16px' }}>
            <input
              className="field__input"
              style={{ width: '100%', fontSize: '12px', padding: '4px 8px' }}
              placeholder={showNewInput === 'file' ? 'filename.ts' : 'folder-name'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setShowNewInput(null); setNewName(''); }
              }}
              onBlur={handleCreate}
              autoFocus
            />
          </div>
        )}
        {fileTree.length === 0 ? (
          <div className="empty-state">
            <FolderOpen size={32} className="empty-state__icon" />
            <span className="empty-state__text">No files found</span>
          </div>
        ) : (
          fileTree.map((node) => (
            <FileNodeComponent
              key={node.path}
              node={node}
              depth={0}
              activeFilePath={activeFilePath}
              onSelect={onFileSelect}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          projectFolder={projectFolder}
          onClose={() => setContextMenu(null)}
          onOpenInTerminal={onOpenInTerminal}
          onToast={onToast}
        />
      )}

      {/* Runs Section */}
      <div className="sidebar__header" onClick={() => setRunsExpanded(!runsExpanded)} style={{ marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer', padding: '12px 16px' }}>
        <span className="sidebar__title">Validation Runs</span>
        <ChevronRight style={{ transform: runsExpanded ? 'rotate(90deg)' : 'none', transition: 'all 0.2s', marginLeft: 'auto' }} size={14} />
      </div>
      
      {runsExpanded && (
        <div style={{ maxHeight: '30vh', overflowY: 'auto', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
          {loadingRuns ? (
            <div style={{ padding: '12px', fontSize: '11px', textAlign: 'center', color: 'var(--text-disabled)' }}>Loading...</div>
          ) : runs.length === 0 ? (
            <div style={{ padding: '12px', fontSize: '11px', textAlign: 'center', color: 'var(--text-disabled)' }}>No past runs found</div>
          ) : runs.map(run => (
            <div 
              key={run.id}
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-subtle)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                background: 'transparent'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              onClick={() => {
                // We pass a synthetic node to onFileSelect
                // @ts-ignore - injecting extra properties specifically for page.tsx handling
                onFileSelect({
                  path: `orbitcode://run/${run.id}`,
                  name: `Run: ${run.id.split('_')[1] || run.id}`,
                  isDirectory: false,
                  isReport: true,
                  runId: run.id
                });
              }}
            >
               <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{run.type === 'browser' ? 'Browser Test' : run.type === 'diagnosis' ? 'Diagnosis' : 'Task'}</span>
                  <span style={{ color: run.status === 'failed' ? '#EF4444' : run.status === 'complete' ? '#10B981' : 'var(--text-disabled)', fontSize: '10px' }}>
                     {run.status}
                  </span>
               </div>
               <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  {new Date(run.timestamp).toLocaleString()}
               </div>
            </div>
          ))}
        </div>
      )}

    </aside>
  );
}
