/* OrbitCode — Policy / Compliance Layer (enforcement, not advisory)
 *
 * Companion to `policy.ts` (which is a prompt-level description of rules).
 * This module does actual runtime pattern detection for:
 *
 *   - hard-coded secrets / API keys in generated code or commands
 *   - PII exfiltration patterns
 *   - production-destructive SQL
 *   - known-malicious or clearly-illegal intents in free-text user requests
 *
 * Consumed by:
 *   - app/api/terminal/route.ts       (command-level checks)
 *   - lib/agent/orchestrator.ts       (intent-level checks before stages run)
 *   - lib/agent/stages.ts critic      (generated-content checks)
 */

export type ComplianceStatus = 'ok' | 'warn' | 'blocked';

export interface ComplianceResult {
  status: ComplianceStatus;
  reason: string;
  category?: 'secret' | 'pii' | 'sql' | 'malicious' | 'destructive_prod';
  evidence?: string;
}

const ok = (): ComplianceResult => ({ status: 'ok', reason: '' });

// ── Secrets in plain text ────────────────────────────────────────────
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { re: /ASIA[0-9A-Z]{16}/, label: 'AWS session key' },
  { re: /AIza[0-9A-Za-z_-]{35}/, label: 'Google API key' },
  { re: /ya29\.[0-9A-Za-z_-]+/, label: 'Google OAuth token' },
  { re: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI / generic sk- key' },
  { re: /xox[abpr]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /ghp_[A-Za-z0-9]{30,}/, label: 'GitHub personal access token' },
  { re: /github_pat_[A-Za-z0-9_]{40,}/, label: 'GitHub fine-grained PAT' },
  { re: /-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/, label: 'private key' },
];

// ── PII exfiltration signals ─────────────────────────────────────────
// We look for obviously-identifying fields being sent to an external host.
const PII_EXFIL_RE = /\b(ssn|social[-_ ]?security|credit[-_ ]?card|passport|national[-_ ]?id|date[-_ ]?of[-_ ]?birth)\b[^\n]{0,80}\b(fetch|axios|POST|send|upload|email)\b/i;

// ── Production-destructive SQL ───────────────────────────────────────
const PROD_SQL_RE = /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b|\bDELETE\s+FROM\s+\w+\s*(;|$)/i; // DELETE FROM x with no WHERE

// ── Clearly-malicious free-text intents ──────────────────────────────
// These are deliberately narrow. We do NOT want to block legitimate dev work
// (e.g. "write a pen-test script for MY server") — we only block requests
// whose plain reading is to attack third parties.
const MALICIOUS_INTENT_RE = /\b(build|write|create|generate)\b[^\n]{0,80}\b(ransomware|keylogger|credential\s*stealer|phishing\s*kit|ddos\s*tool|botnet|exploit\s+kit)\b/i;

/**
 * Scan a block of text (generated code, file content, or free-text intent)
 * for things we should refuse or escalate.
 */
export function checkTextCompliance(text: string): ComplianceResult {
  if (!text) return ok();

  for (const { re, label } of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return {
        status: 'blocked',
        category: 'secret',
        reason: `Hard-coded ${label} detected. Remove or move to environment variable before continuing.`,
        evidence: m[0].slice(0, 6) + '…',
      };
    }
  }

  if (PII_EXFIL_RE.test(text)) {
    return {
      status: 'warn',
      category: 'pii',
      reason: 'PII-looking field is being sent to an external endpoint. Confirm consent / masking before running.',
    };
  }

  if (MALICIOUS_INTENT_RE.test(text)) {
    return {
      status: 'blocked',
      category: 'malicious',
      reason: 'Request appears to ask for clearly-malicious software (e.g. ransomware, botnet, phishing kit). Refused.',
    };
  }

  return ok();
}

/**
 * Command-level compliance: catches `DROP DATABASE prod`, curl-piping secrets
 * to external hosts, etc. Called by the terminal route.
 */
export function checkCommandCompliance(command: string): ComplianceResult {
  if (!command) return ok();

  // Secrets embedded directly in the command
  const t = checkTextCompliance(command);
  if (t.status !== 'ok') return t;

  if (PROD_SQL_RE.test(command)) {
    return {
      status: 'blocked',
      category: 'sql',
      reason: 'Production-destructive SQL detected (DROP/TRUNCATE or unfiltered DELETE).',
    };
  }

  // Pushing env/config files over the network
  if (/\b(curl|wget|scp|rsync)\b[^\n]*\.(env|pem|key|credentials)\b/i.test(command)) {
    return {
      status: 'blocked',
      category: 'secret',
      reason: 'Command attempts to transfer a credentials/.env/key file over the network.',
    };
  }

  return ok();
}

/**
 * Intent-level compliance: called by the orchestrator BEFORE any stage runs.
 * Returns `blocked` → orchestrator refuses the request and surfaces `reason`.
 */
export function checkIntentCompliance(intent: string): ComplianceResult {
  return checkTextCompliance(intent);
}

/**
 * Content-level compliance for critic stage: called against the concatenation
 * of all files the agent produced. Returns the FIRST violation found.
 */
export function checkGeneratedContentCompliance(content: string): ComplianceResult {
  return checkTextCompliance(content);
}
