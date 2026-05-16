/* OrbitCode - MemPalace-backed project memory hook */
import { useCallback, useEffect, useState } from 'react';

export interface BrainEntry {
  id: string;
  type: 'architecture' | 'pattern' | 'decision' | 'context' | 'issue' | 'todo';
  title: string;
  content: string;
  source: 'user' | 'agent' | 'auto';
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  confidence?: number;
}

export interface ProjectBrain {
  projectPath: string;
  projectName: string;
  entries: BrainEntry[];
  lastUpdated: number;
  version: number;
  available?: boolean;
  installCommand?: string;
}

export function useProjectBrain(projectPath: string) {
  const [brain, setBrain] = useState<ProjectBrain | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadBrain = useCallback(async () => {
    if (!projectPath) return;
    setIsLoading(true);
    try {
      const statusRes = await fetch(`/api/memory?action=status&projectFolder=${encodeURIComponent(projectPath)}`);
      const status = statusRes.ok ? await statusRes.json() : { available: false };
      setBrain({
        projectPath,
        projectName: projectPath.split(/[\\/]/).pop() || projectPath,
        entries: status.available ? [{
          id: 'mempalace-status',
          type: 'context',
          title: 'MemPalace',
          content: 'MemPalace memory is available for this project.',
          source: 'auto',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }] : [],
        lastUpdated: Date.now(),
        version: 1,
        available: Boolean(status.available),
        installCommand: status.installCommand,
      });
    } catch {
      setBrain(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  const addEntry = useCallback(async (entry: Omit<BrainEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!projectPath) return undefined;
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'note',
        projectFolder: projectPath,
        title: entry.title,
        content: entry.content,
        room: entry.type,
      }),
    }).catch(() => undefined);
    const newEntry: BrainEntry = {
      ...entry,
      id: `memory-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setBrain((prev) => prev ? {
      ...prev,
      entries: [...prev.entries, newEntry],
      lastUpdated: Date.now(),
    } : prev);
    return newEntry;
  }, [projectPath]);

  const removeEntry = useCallback(async () => {
    // MemPalace drawer deletion requires a drawer id; OrbitCode does not expose destructive memory deletes in v1.
  }, []);

  const buildBrainContext = useCallback(async (): Promise<string> => {
    if (!projectPath) return '';
    try {
      const res = await fetch(`/api/memory?action=wake-up&projectFolder=${encodeURIComponent(projectPath)}`);
      if (!res.ok) return '';
      const data = await res.json();
      return data.context ? `## MemPalace Wake-Up Context\n${data.context}` : '';
    } catch {
      return '';
    }
  }, [projectPath]);

  useEffect(() => { loadBrain(); }, [loadBrain]);

  return {
    brain,
    isLoading,
    addEntry,
    removeEntry,
    buildBrainContext,
    loadBrain,
  };
}
