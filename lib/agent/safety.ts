/* OrbitCode — Safety Gate
 * Classifies tool calls and commands by risk level.
 * Destructive operations require explicit user approval.
 */

export type SafetyLevel = 'safe' | 'write' | 'destructive' | 'blocked';

export interface SafetyCheck {
  level: SafetyLevel;
  reason: string;
  requiresApproval: boolean;
}

// Patterns that indicate destructive commands
const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*\s+|-r\s+|-rf?\s+|-fr\s+)/i, // rm -r / -rf / -fr / -Rf etc.
  /\brm\s+.*\*/i,                                      // rm with a glob (rm *, rm foo/*)
  /\brmdir\b/i,
  /\bdel\s+\/[sqdfa]/i,                                // Windows delete with flags
  /\bRemove-Item\b.*\s-Recurse/i,                      // PowerShell recursive remove
  /\bformat\b/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\b/i,
  /\bgit\s+push\s+.*(-f\b|--force\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*[fd][a-z]*/i,
  /\bgit\s+checkout\s+--\s+\./i,                       // discards all local changes
  /\bnpm\s+unpublish\b/i,
  /\bcurl\b[^|]*\b(DELETE|PUT)\b/i,
  /\bsudo\b/i,
  /\bchmod\s+(-R\s+)?[0-7]*777/i,
  /\bchown\b/i,
  /\bmkfs(\.|\b)/i,
  /\bdd\s+if=/i,
  /\b>\s*\/dev\//i,
  /\bkill\s+-9\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /:\s*\(\s*\)\s*\{\s*:/,                              // classic forkbomb pattern
  /\bgcloud\b.*\b(delete|destroy)\b/i,                 // gcloud ... delete
  /\bdocker\s+(rm|rmi|system\s+prune|volume\s+prune)\b/i,
  /\bkubectl\s+delete\b/i,
];

// Patterns that indicate write/side-effect commands (safe but notable)
const WRITE_COMMAND_PATTERNS = [
  /\bnpm\s+install\b/i,
  /\byarn\s+add\b/i,
  /\bpip\s+install\b/i,
  /\bgit\s+commit\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+merge\b/i,
  /\bgit\s+checkout\b/i,
  /\bgit\s+branch\b/i,
  /\bnpx\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bcp\b/i,
  /\bmv\b/i,
  /\bcopy\b/i,
  /\bmove\b/i,
  /\bgcloud\b/i,
  /\bdocker\s+build\b/i,
  /\bdocker\s+push\b/i,
  /\bdocker\s+run\b/i,
];

// Blocked patterns (never allow — no confirmation path)
const BLOCKED_COMMAND_PATTERNS = [
  /\bcurl\b[^\n]*\|\s*(bash|sh|zsh|pwsh|powershell)\b/i,  // curl | sh
  /\bwget\b[^\n]*\|\s*(bash|sh|zsh|pwsh|powershell)\b/i,  // wget | sh
  /\biwr\b[^\n]*\|\s*iex\b/i,                             // PS Invoke-WebRequest | iex
  /\b(iex|Invoke-Expression)\b[^\n]*\b(curl|wget|New-Object\s+Net\.WebClient)\b/i,
  /\beval\s*\$\(/i,                                       // eval $(...)
  /\beval\s+"\$\(/i,
  /\bexec\b.*<\(/i,                                       // exec <(...)
  /\bpowershell(\.exe)?\s+-(enc|encodedcommand)\b/i,      // encoded powershell
  /\bbase64\b.*\|\s*(bash|sh)\b/i,                        // pipe decoded base64 to sh
  /\brm\s+-rf?\s+(\/|~|\$HOME|C:\\\\?|C:\/)\s*$/i,        // rm -rf / or ~
  /\brm\s+-rf?\s+(\/|~|\$HOME|C:\\\\?|C:\/)\s+/i,         // rm -rf / <args>
  /(^|\s|;):\s*\(\s*\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;\s*:/,  // forkbomb
  /\bformat\s+c:/i,                                       // format C:
];

/**
 * Classify a shell command by safety level
 */
export function classifyCommand(command: string): SafetyCheck {
  // Check blocked first
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: 'blocked',
        reason: `Blocked: Command matches dangerous pattern (${pattern.source})`,
        requiresApproval: true,
      };
    }
  }

  // Check destructive
  for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: 'destructive',
        reason: `Destructive: Command may cause data loss or irreversible changes`,
        requiresApproval: true,
      };
    }
  }

  // Check write
  for (const pattern of WRITE_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: 'write',
        reason: `Write: Command modifies project state`,
        requiresApproval: false,
      };
    }
  }

  // Default: safe read-only commands
  return {
    level: 'safe',
    reason: 'Read-only or informational command',
    requiresApproval: false,
  };
}

/**
 * Classify a tool call by safety level
 */
export function classifyToolCall(toolName: string, args: Record<string, unknown>): SafetyCheck {
  switch (toolName) {
    case 'read_file':
    case 'list_files':
    case 'search_files':
    case 'task_complete':
      return {
        level: 'safe',
        reason: 'Read-only operation',
        requiresApproval: false,
      };

    case 'create_file':
    case 'edit_file':
      return {
        level: 'write',
        reason: `File write: ${args.path}`,
        requiresApproval: false,
      };

    case 'delete_file':
      return {
        level: 'destructive',
        reason: `File deletion: ${args.path}`,
        requiresApproval: true,
      };

    case 'run_command': {
      const cmd = (args.command as string) || '';
      return classifyCommand(cmd);
    }

    default:
      return {
        level: 'write',
        reason: `Unknown tool: ${toolName}`,
        requiresApproval: true,
      };
  }
}

// ════════════════════════════════════════════
//  Audit Log
// ════════════════════════════════════════════
export interface AuditEntry {
  timestamp: number;
  action: string;
  toolName?: string;
  args?: Record<string, unknown>;
  safetyLevel: SafetyLevel;
  result: 'success' | 'error' | 'blocked' | 'pending_approval';
  detail?: string;
}

// In-memory audit log (will be persisted by the executor)
const auditLog: AuditEntry[] = [];

export function logAudit(entry: AuditEntry): void {
  auditLog.push(entry);
  // Keep last 1000 entries in memory
  if (auditLog.length > 1000) {
    auditLog.splice(0, auditLog.length - 1000);
  }
}

export function getAuditLog(): AuditEntry[] {
  return [...auditLog];
}

export function getRecentAudit(count: number = 50): AuditEntry[] {
  return auditLog.slice(-count);
}
