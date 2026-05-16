'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, FolderOpen, Plus, GitBranch, Clock, Folder,
  Search, Shield, ExternalLink, ChevronRight, Settings, Trash2, RefreshCw
} from 'lucide-react';

interface UserConfig {
  gcpProject: string;
  gcpRegion: string;
  providerId?: string;
  selectedProviderId?: string;
  beginnerMode?: boolean;
  workspacePath: string;
  recentProjects: Array<{ name: string; path: string; lastOpened: number }>;
}

interface ProjectInfo {
  name: string;
  path: string;
  isGitRepo: boolean;
  branch?: string;
  remote?: string;
  lastModified: number;
  fileCount: number;
}

interface DashboardProps {
  config: UserConfig;
  onOpenProject: (projectPath: string, projectName: string) => void;
  onUpdateConfig: (updates: Partial<UserConfig>) => void;
  onBrowseWorkspace: () => void;
  onOpenSettings: () => void;
}

function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60000) return 'just now';
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
  if (delta < 604800000) return `${Math.floor(delta / 86400000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export default function Dashboard({
  config,
  onOpenProject,
  onUpdateConfig,
  onBrowseWorkspace,
  onOpenSettings,
}: DashboardProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newGitRemote, setNewGitRemote] = useState('');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  // Load projects from workspace
  const loadProjects = useCallback(async () => {
    if (!config.workspacePath) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects?workspace=${encodeURIComponent(config.workspacePath)}`);
      const data = await res.json();
      if (data.projects) setProjects(data.projects);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
    setLoading(false);
  }, [config.workspacePath]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Create new project
  const handleCreate = async () => {
    if (!newProjectName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: config.workspacePath,
          name: newProjectName.trim(),
          initGit: true,
          gitRemote: newGitRemote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateNew(false);
        setNewProjectName('');
        setNewGitRemote('');
        await loadProjects();
        onOpenProject(data.project.path, data.project.name);
      } else {
        alert(data.error || 'Failed to create project');
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    }
    setCreating(false);
  };

  // Remove from recent
  const removeRecent = async (path: string) => {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-recent', path }),
      });
      onUpdateConfig({
        recentProjects: config.recentProjects.filter((p) => p.path !== path),
      });
    } catch { /* ignore */ }
  };

  const filteredProjects = projects.filter(
    (p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())
  );

  const needsWorkspace = !config.workspacePath;

  return (
    <div className="setup-screen">
      <div style={{ width: '800px', maxWidth: '95vw', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 52,
            height: 52,
            margin: '0 auto 12px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 12,
            background: 'rgba(96, 165, 250, 0.12)',
            border: '1px solid rgba(96, 165, 250, 0.24)',
            color: 'var(--accent-primary)',
          }}>
            <Zap size={24} />
          </div>
          <div className="setup-card__logo" style={{ fontSize: '32px', marginBottom: '4px' }}>
            OrbitCode
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
            Local AI coding workspace for your own models and APIs
          </p>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '8px',
            padding: '4px 12px',
            background: 'rgba(0, 169, 151, 0.08)',
            border: '1px solid rgba(0, 169, 151, 0.2)',
            borderRadius: '20px',
            fontSize: '10px',
            color: 'var(--teal)',
          }}>
            <Shield size={10} />
            Local-first by default. API keys stay encrypted on this machine.
          </div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'flex-start',
            gap: '8px',
            marginTop: '10px',
            padding: '10px 16px',
            background: 'rgba(255, 203, 56, 0.06)',
            border: '1px solid rgba(255, 203, 56, 0.18)',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#FFCB38',
            lineHeight: '1.5',
            maxWidth: '480px',
            textAlign: 'left',
          }}>
            <Shield size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              <strong>Heads up</strong> — OrbitCode can run commands on your real machine.
              Terminal execution is not sandboxed.
              Always review actions before approving them.
            </span>
          </div>
        </div>

        {/* Needs initial setup */}
        {needsWorkspace && (
          <div className="setup-card" style={{ margin: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              First-Time Setup
            </div>
            <div className="field">
              <label className="field__label">
                <Shield size={13} />
                Beginner Mode
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '10px 12px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={config.beginnerMode ?? true}
                  onChange={(e) => onUpdateConfig({ beginnerMode: e.target.checked })}
                  style={{ marginTop: 2 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Recommended: start with the chat workspace and keep code-heavy tools tucked away.
                </span>
              </label>
            </div>
            {needsWorkspace && (
              <div className="field">
                <label className="field__label">
                  <FolderOpen size={13} />
                  Workspace Folder
                  <span className="field__hint">(root folder for all your projects)</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    className="field__input"
                    style={{ flex: 1 }}
                    type="text"
                    placeholder="D:\Projects"
                    value={config.workspacePath}
                    onChange={(e) => onUpdateConfig({ workspacePath: e.target.value })}
                  />
                  <button className="btn btn--ghost" onClick={onBrowseWorkspace} style={{ gap: '6px' }}>
                    <Search size={13} /> Browse
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main content — only if workspace is set */}
        {!needsWorkspace && (
          <>
            {/* Actions bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn btn--primary"
                onClick={() => setShowCreateNew(true)}
                style={{ gap: '6px' }}
              >
                <Plus size={14} /> New Project
              </button>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  className="field__input"
                  style={{ width: '100%', paddingLeft: '32px' }}
                  type="text"
                  placeholder="Filter projects..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-disabled)',
                  }}
                />
              </div>
              <button className="icon-btn" onClick={loadProjects} title="Refresh">
                <RefreshCw size={14} />
              </button>
              <button className="icon-btn" onClick={onOpenSettings} title="Settings">
                <Settings size={14} />
              </button>
            </div>

            {/* Create new project form */}
            {showCreateNew && (
              <div className="setup-card" style={{ margin: 0, animation: 'modalSlideIn 0.2s ease-out' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Create New Project
                  </span>
                  <button className="icon-btn" onClick={() => setShowCreateNew(false)}>
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="field">
                  <label className="field__label">Project Name</label>
                  <input
                    className="field__input"
                    type="text"
                    placeholder="my-awesome-app"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    autoFocus
                  />
                  <span className="field__hint">
                    Will create: {config.workspacePath.replace(/\\/g, '/')}/{newProjectName || '...'}
                  </span>
                </div>
                <div className="field">
                  <label className="field__label">
                    <GitBranch size={13} />
                    GitHub Remote
                    <span className="field__hint">(optional — connect to GitHub)</span>
                  </label>
                  <input
                    className="field__input"
                    type="text"
                    placeholder="https://github.com/your-org/repo.git"
                    value={newGitRemote}
                    onChange={(e) => setNewGitRemote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button className="btn btn--ghost" onClick={() => setShowCreateNew(false)}>Cancel</button>
                  <button
                    className="btn btn--primary"
                    onClick={handleCreate}
                    disabled={!newProjectName.trim() || creating}
                  >
                    {creating ? 'Creating...' : 'Create & Open'}
                  </button>
                </div>
              </div>
            )}

            {/* Recent projects */}
            {config.recentProjects.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  <Clock size={11} style={{ verticalAlign: '-1px' }} /> Recent Projects
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {config.recentProjects.slice(0, 5).map((rp) => (
                    <div
                      key={rp.path}
                      className="folder-browser__location"
                      onClick={() => onOpenProject(rp.path, rp.name)}
                      style={{ borderRadius: '8px', padding: '10px 16px' }}
                    >
                      <Folder size={16} style={{ color: '#F8EA44', flexShrink: 0 }} />
                      <div className="folder-browser__location-info">
                        <span className="folder-browser__location-name">{rp.name}</span>
                        <span className="folder-browser__location-path">{rp.path}</span>
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>
                        {timeAgo(rp.lastOpened)}
                      </span>
                      <button
                        className="icon-btn"
                        style={{ width: '20px', height: '20px' }}
                        onClick={(e) => { e.stopPropagation(); removeRecent(rp.path); }}
                        title="Remove from recent"
                      >
                        <Trash2 size={10} />
                      </button>
                      <ChevronRight size={14} style={{ opacity: 0.3, flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workspace projects */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                <FolderOpen size={11} style={{ verticalAlign: '-1px' }} /> Workspace: {config.workspacePath.replace(/\\/g, '/')}
              </div>

              {loading ? (
                <div className="empty-state" style={{ padding: '40px' }}>
                  <div className="streaming-indicator">
                    <span className="streaming-indicator__dot" />
                    <span className="streaming-indicator__dot" />
                    <span className="streaming-indicator__dot" />
                  </div>
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                  <FolderOpen size={28} className="empty-state__icon" />
                  <span className="empty-state__text">
                    {filter ? 'No matching projects' : 'No projects yet — create one above!'}
                  </span>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                  gap: '12px',
                }}>
                  {filteredProjects.map((project) => (
                    <div
                      key={project.path}
                      className="setup-card"
                      onClick={() => onOpenProject(project.path, project.name)}
                      style={{
                        margin: 0,
                        padding: '16px',
                        gap: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        border: '1px solid var(--border-subtle)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-accent)';
                        e.currentTarget.style.boxShadow = '0 0 0 1px var(--accent-glow)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Folder size={18} style={{ color: '#F8EA44', flexShrink: 0 }} />
                        <span style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}>
                          {project.name}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {project.isGitRepo && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--color-info)' }}>
                            <GitBranch size={10} /> {project.branch}
                          </span>
                        )}
                        <span>{project.fileCount} items</span>
                        <span>{timeAgo(project.lastModified)}</span>
                      </div>
                      {project.remote && (
                        <div style={{
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-disabled)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}>
                          <ExternalLink size={9} />
                          {project.remote.replace('https://github.com/', '').replace('.git', '')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
