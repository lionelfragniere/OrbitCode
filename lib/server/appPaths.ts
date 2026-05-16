import os from 'os';
import path from 'path';
import { APP_CONFIG_DIR, LEGACY_CONFIG_DIR, PROJECT_DATA_DIR, LEGACY_PROJECT_DATA_DIR } from '@/lib/orbitcode';

export function getAppConfigDir(): string {
  return path.join(os.homedir(), APP_CONFIG_DIR);
}

export function getLegacyConfigDir(): string {
  return path.join(os.homedir(), LEGACY_CONFIG_DIR);
}

export function getConfigFilePath(name: string): string {
  return path.join(getAppConfigDir(), name);
}

export function getLegacyConfigFilePath(name: string): string {
  return path.join(getLegacyConfigDir(), name);
}

export function getProjectDataDir(projectFolder: string): string {
  return path.join(projectFolder, PROJECT_DATA_DIR);
}

export function getLegacyProjectDataDir(projectFolder: string): string {
  return path.join(projectFolder, LEGACY_PROJECT_DATA_DIR);
}

export function getProjectRunsDir(projectFolder: string): string {
  return path.join(getProjectDataDir(projectFolder), 'runs');
}

export function getLegacyProjectRunsDir(projectFolder: string): string {
  return path.join(getLegacyProjectDataDir(projectFolder), 'runs');
}

export function projectDataRelative(...parts: string[]): string {
  return [PROJECT_DATA_DIR, ...parts].join('/');
}

export function legacyProjectDataRelative(...parts: string[]): string {
  return [LEGACY_PROJECT_DATA_DIR, ...parts].join('/');
}
