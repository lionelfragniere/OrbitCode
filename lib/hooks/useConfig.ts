/* OrbitCode — Config hook
 * Manages persistent user configuration via /api/config
 */

import { useState, useCallback, useEffect } from 'react';

export interface UserConfig {
  gcpProject: string;
  gcpRegion: string;
  providerId: string;
  selectedProviderId: string;
  providerKind?: string;
  workspacePath: string;
  temperature: number;
  maxTokens: number;
  systemInstruction: string;
  selectedModel: string;
  beginnerMode: boolean;
  recentProjects: Array<{ name: string; path: string; lastOpened: number }>;
}

const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_PROVIDER = 'local-ollama';

export function useConfig() {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      // Ensure selectedModel has a default
      if (!data.selectedModel) data.selectedModel = DEFAULT_MODEL;
      if (!data.selectedProviderId) data.selectedProviderId = data.providerId || DEFAULT_PROVIDER;
      if (!data.providerId) data.providerId = data.selectedProviderId;
      if (typeof data.beginnerMode !== 'boolean') data.beginnerMode = true;
      setConfig(data);
      return data as UserConfig;
    } catch (err) {
      console.error('Failed to load config:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (updates: Partial<UserConfig>) => {
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!data.selectedModel) data.selectedModel = DEFAULT_MODEL;
      if (!data.selectedProviderId) data.selectedProviderId = data.providerId || DEFAULT_PROVIDER;
      if (!data.providerId) data.providerId = data.selectedProviderId;
      if (typeof data.beginnerMode !== 'boolean') data.beginnerMode = true;
      setConfig(data);
      return data as UserConfig;
    } catch (err) {
      console.error('Failed to update config:', err);
      return null;
    }
  }, []);

  const addRecentProject = useCallback(async (name: string, path: string) => {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-recent', name, path }),
    });
    await loadConfig();
  }, [loadConfig]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  return {
    config,
    isLoading,
    loadConfig,
    updateConfig,
    addRecentProject,
  };
}
