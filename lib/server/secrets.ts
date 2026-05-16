import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { getConfigFilePath } from './appPaths';

interface SecretRecord {
  id: string;
  name: string;
  encrypted: string;
  method: 'windows-dpapi' | 'local-aes-256-gcm';
  createdAt: number;
  updatedAt: number;
}

interface SecretStore {
  version: number;
  secrets: SecretRecord[];
}

const SECRET_FILE = getConfigFilePath('secrets.json');
const KEY_FILE = getConfigFilePath('secrets.key');

async function ensureDir() {
  await fs.mkdir(path.dirname(SECRET_FILE), { recursive: true });
}

async function readStore(): Promise<SecretStore> {
  try {
    const raw = await fs.readFile(SECRET_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as SecretStore;
    return {
      ...parsed,
      version: parsed.version || 1,
      secrets: Array.isArray(parsed.secrets) ? parsed.secrets : [],
    };
  } catch {
    return { version: 1, secrets: [] };
  }
}

async function writeStore(store: SecretStore) {
  await ensureDir();
  await fs.writeFile(SECRET_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function runPowerShell(command: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    ps.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });
    ps.stdin.write(input);
    ps.stdin.end();
  });
}

async function encryptWindowsDpapi(value: string): Promise<string> {
  return runPowerShell(
    '$plain=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString $plain -AsPlainText -Force; ConvertFrom-SecureString $secure',
    value,
  );
}

async function decryptWindowsDpapi(value: string): Promise<string> {
  return runPowerShell(
    "$encrypted=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString $encrypted; $cred=New-Object System.Net.NetworkCredential('', $secure); $cred.Password",
    value,
  );
}

async function getLocalKey(): Promise<Buffer> {
  try {
    return Buffer.from(await fs.readFile(KEY_FILE, 'utf-8'), 'base64');
  } catch {
    await ensureDir();
    const key = crypto.randomBytes(32);
    await fs.writeFile(KEY_FILE, key.toString('base64'), { encoding: 'utf-8', mode: 0o600 });
    return key;
  }
}

async function encryptLocal(value: string): Promise<string> {
  const key = await getLocalKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

async function decryptLocal(value: string): Promise<string> {
  const key = await getLocalKey();
  const data = Buffer.from(value, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

export async function saveSecret(name: string, value: string, existingId?: string): Promise<string> {
  const id = existingId || `secret_${crypto.randomUUID()}`;
  const method: SecretRecord['method'] = process.platform === 'win32' ? 'windows-dpapi' : 'local-aes-256-gcm';
  const encrypted = method === 'windows-dpapi'
    ? await encryptWindowsDpapi(value)
    : await encryptLocal(value);

  const store = await readStore();
  const now = Date.now();
  const existing = store.secrets.find((secret) => secret.id === id);
  if (existing) {
    existing.name = name;
    existing.encrypted = encrypted;
    existing.method = method;
    existing.updatedAt = now;
  } else {
    store.secrets.push({ id, name, encrypted, method, createdAt: now, updatedAt: now });
  }
  await writeStore(store);
  return id;
}

export async function readSecret(id?: string): Promise<string | undefined> {
  if (!id) return undefined;
  const store = await readStore();
  const record = store.secrets.find((secret) => secret.id === id);
  if (!record) return undefined;
  return record.method === 'windows-dpapi'
    ? decryptWindowsDpapi(record.encrypted)
    : decryptLocal(record.encrypted);
}

export async function deleteSecret(id?: string): Promise<void> {
  if (!id) return;
  const store = await readStore();
  const next = { ...store, secrets: store.secrets.filter((secret) => secret.id !== id) };
  await writeStore(next);
}
