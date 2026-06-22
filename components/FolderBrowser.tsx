'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, Folder, ChevronRight, ArrowLeft, Home, HardDrive, 
  Monitor, Code, X, Check
} from 'lucide-react';

interface FolderBrowserProps {
  currentPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

interface LocationItem {
  name: string;
  path: string;
  type: string;
}

interface DirEntry {
  name: string;
  path: string;
}

export default function FolderBrowser({ currentPath, onSelect, onClose }: FolderBrowserProps) {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [directories, setDirectories] = useState<DirEntry[]>([]);
  const [browsePath, setBrowsePath] = useState(currentPath || '');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(currentPath || '');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'locations' | 'browse'>('locations');

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch('/api/browse');
      const data = await res.json();
      if (data.locations) setLocations(data.locations);
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  }, []);

  // Load initial locations
  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const browseTo = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (data.error) {
        console.error(data.error);
        setLoading(false);
        return;
      }
      setBrowsePath(data.current);
      setPathInput(data.current);
      setParentPath(data.parent);
      setDirectories(data.directories || []);
      setView('browse');
    } catch (err) {
      console.error('Failed to browse:', err);
    }
    setLoading(false);
  }, []);

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pathInput.trim()) browseTo(pathInput.trim());
  };

  const handleSelect = () => {
    onSelect(browsePath || pathInput);
  };

  const getLocationIcon = (type: string) => {
    switch (type) {
      case 'home': return <Home size={16} style={{ color: '#60a5fa' }} />;
      case 'desktop': return <Monitor size={16} style={{ color: '#a78bfa' }} />;
      case 'dev': return <Code size={16} style={{ color: '#34d399' }} />;
      case 'drive': return <HardDrive size={16} style={{ color: '#fbbf24' }} />;
      default: return <FolderOpen size={16} style={{ color: '#9aa0b0' }} />;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '600px' }}>
        <div className="modal__header">
          <h2 className="modal__title">
            <FolderOpen size={18} style={{ color: 'var(--accent-primary)' }} />
            Choose Project Folder
          </h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal__body" style={{ padding: 0, gap: 0 }}>
          {/* Path bar */}
          <form className="folder-browser__path-bar" onSubmit={handlePathSubmit}>
            {view === 'browse' && parentPath && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => browseTo(parentPath)}
                title="Go up"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            {view === 'browse' && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setView('locations')}
                title="Quick locations"
              >
                <Home size={14} />
              </button>
            )}
            <input
              className="folder-browser__path-input"
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="Enter path or browse below..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (pathInput.trim()) browseTo(pathInput.trim());
                }
              }}
            />
            <button type="submit" className="btn btn--ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>
              Go
            </button>
          </form>

          {/* Content */}
          <div className="folder-browser__content">
            {loading ? (
              <div className="empty-state" style={{ padding: '40px' }}>
                <div className="streaming-indicator">
                  <span className="streaming-indicator__dot" />
                  <span className="streaming-indicator__dot" />
                  <span className="streaming-indicator__dot" />
                </div>
              </div>
            ) : view === 'locations' ? (
              /* Quick locations */
              <div className="folder-browser__locations">
                {locations.map((loc, i) => (
                  <div
                    key={i}
                    className="folder-browser__location"
                    onClick={() => browseTo(loc.path)}
                  >
                    {getLocationIcon(loc.type)}
                    <div className="folder-browser__location-info">
                      <span className="folder-browser__location-name">{loc.name}</span>
                      <span className="folder-browser__location-path">{loc.path}</span>
                    </div>
                    <ChevronRight size={14} style={{ opacity: 0.3 }} />
                  </div>
                ))}
              </div>
            ) : (
              /* Directory listing */
              <div className="folder-browser__dirs">
                {directories.length === 0 ? (
                  <div className="empty-state" style={{ padding: '40px' }}>
                    <span className="empty-state__text">No subdirectories</span>
                  </div>
                ) : (
                  directories.map((dir) => (
                    <div
                      key={dir.path}
                      className="folder-browser__dir"
                      onDoubleClick={() => browseTo(dir.path)}
                      onClick={() => {
                        setBrowsePath(dir.path);
                        setPathInput(dir.path);
                      }}
                    >
                      <Folder size={15} style={{ color: '#fbbf24' }} />
                      <span>{dir.name}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="modal__footer">
          <div style={{ flex: 1, fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {browsePath || pathInput || 'No folder selected'}
          </div>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSelect}
            disabled={!browsePath && !pathInput}
          >
            <Check size={14} />
            Select Folder
          </button>
        </div>
      </div>
    </div>
  );
}
