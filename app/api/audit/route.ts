/* OrbitCode — Audit Log API
 * GET: Retrieve recent audit entries
 * POST: Append new audit entry
 * Storage: ~/.orbitcode/audit/audit.jsonl (append-only)
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const AUDIT_DIR = path.join(os.homedir(), '.orbitcode', 'audit');
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl');

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  category: 'tool_call' | 'file_op' | 'command' | 'git' | 'config' | 'auth' | 'model';
  user: string;
  project?: string;
  details: Record<string, unknown>;
  safetyLevel?: 'safe' | 'write' | 'destructive' | 'blocked';
  result?: 'success' | 'error' | 'blocked';
}

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');
  const category = req.nextUrl.searchParams.get('category');
  const project = req.nextUrl.searchParams.get('project');

  try {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
    const data = await fs.readFile(AUDIT_FILE, 'utf-8').catch(() => '');
    
    let entries: AuditEntry[] = data
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean) as AuditEntry[];

    // Filter
    if (category) entries = entries.filter((e) => e.category === category);
    if (project) entries = entries.filter((e) => e.project === project);

    // Return most recent
    entries = entries.slice(-limit).reverse();

    return NextResponse.json({ entries, total: entries.length });
  } catch (err) {
    return NextResponse.json({ entries: [], error: String(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const entry: AuditEntry = await req.json();
    entry.id = entry.id || `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    entry.timestamp = entry.timestamp || Date.now();

    await fs.mkdir(AUDIT_DIR, { recursive: true });
    await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n');

    return NextResponse.json({ success: true, id: entry.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
