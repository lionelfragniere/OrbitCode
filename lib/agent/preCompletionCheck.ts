/* OrbitCode — Pre-Completion Integrity Check
 *
 * Fast, deterministic filesystem scan that blocks task_complete
 * when imported modules, pages, or assets do not exist.
 *
 * Runs in <100ms — pure filesystem, no dev server required.
 */

import fs from 'fs/promises';
import path from 'path';

// ════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════
export interface PreCheckResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
  filesScanned: number;
  importsChecked: number;
}

interface ImportRef {
  file: string;       // source file containing the import
  line: number;       // line number (1-indexed)
  specifier: string;  // the raw import string (e.g. "./pages/Dashboard")
  type: 'static' | 'dynamic' | 'require' | 'asset';
}

// ════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════
const EXTENSIONS_TO_SCAN = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const RESOLVE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css'];
const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.mp3'];
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'coverage', '.orbitcode']);

// Known external packages that should not be resolved on disk
// (we only check relative/alias imports)
function isExternalImport(specifier: string): boolean {
  // npm packages: don't start with . or / or @/ (alias)
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
  if (specifier.startsWith('@/')) return false; // project alias
  return true;
}

// ════════════════════════════════════════════
//  File Discovery
// ════════════════════════════════════════════
async function findSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (EXTENSIONS_TO_SCAN.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

// ════════════════════════════════════════════
//  Import Extraction
// ════════════════════════════════════════════

// Static imports: import X from "Y", import "Y", import { X } from "Y"
const STATIC_IMPORT_RE = /(?:import\s+(?:[\w*{}\s,]+\s+from\s+)?|import\s+)['"]([^'"]+)['"]/g;

// Dynamic imports: import("Y"), import('Y')
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Require: require("Y"), require('Y')
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Asset references in JSX: src="./path" or src="/path"
const JSX_ASSET_RE = /(?:src|href)\s*=\s*['"](?:\.\/|\/)((?:public\/|src\/|assets\/)?[^'"]+\.(?:png|jpg|jpeg|gif|svg|webp|ico))['"] /g;

function extractImports(content: string, filePath: string): ImportRef[] {
  const imports: ImportRef[] = [];
  const lines = content.split('\n');

  // Helper: find line number for a match index
  function lineAt(idx: number): number {
    let line = 1;
    for (let i = 0; i < idx && i < content.length; i++) {
      if (content[i] === '\n') line++;
    }
    return line;
  }

  // Static imports
  let match;
  STATIC_IMPORT_RE.lastIndex = 0;
  while ((match = STATIC_IMPORT_RE.exec(content)) !== null) {
    imports.push({
      file: filePath,
      line: lineAt(match.index),
      specifier: match[1],
      type: 'static',
    });
  }

  // Dynamic imports
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((match = DYNAMIC_IMPORT_RE.exec(content)) !== null) {
    imports.push({
      file: filePath,
      line: lineAt(match.index),
      specifier: match[1],
      type: 'dynamic',
    });
  }

  // Require
  REQUIRE_RE.lastIndex = 0;
  while ((match = REQUIRE_RE.exec(content)) !== null) {
    imports.push({
      file: filePath,
      line: lineAt(match.index),
      specifier: match[1],
      type: 'require',
    });
  }

  // JSX asset references
  JSX_ASSET_RE.lastIndex = 0;
  while ((match = JSX_ASSET_RE.exec(content)) !== null) {
    imports.push({
      file: filePath,
      line: lineAt(match.index),
      specifier: match[1],
      type: 'asset',
    });
  }

  return imports;
}

// ════════════════════════════════════════════
//  Import Resolution
// ════════════════════════════════════════════

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a relative or alias import to a file on disk.
 * Returns the resolved path if found, null if broken.
 */
async function resolveImport(
  specifier: string,
  fromFile: string,
  projectRoot: string,
): Promise<string | null> {
  // Determine base directory for resolution
  let basePath: string;

  if (specifier.startsWith('@/')) {
    // Alias: @/ maps to src/ (Vite/Next.js convention)
    const aliasPath = specifier.replace(/^@\//, '');
    // Try src/ first, then project root
    const srcBase = path.join(projectRoot, 'src', aliasPath);
    const rootBase = path.join(projectRoot, aliasPath);
    
    const srcResolved = await tryResolveModule(srcBase);
    if (srcResolved) return srcResolved;
    return tryResolveModule(rootBase);
  } else if (specifier.startsWith('.')) {
    // Relative import
    basePath = path.resolve(path.dirname(fromFile), specifier);
  } else {
    // Should have been filtered as external already
    return null;
  }

  return tryResolveModule(basePath);
}

/**
 * Try to resolve a base path to an actual file, trying:
 * 1. Exact path (if it has an extension)
 * 2. basePath + each extension
 * 3. basePath/index + each extension (directory import)
 */
async function tryResolveModule(basePath: string): Promise<string | null> {
  // 1. Check exact path if it has an extension
  const ext = path.extname(basePath);
  if (ext && RESOLVE_EXTENSIONS.includes(ext.toLowerCase())) {
    if (await fileExists(basePath)) return basePath;
  }

  // Also check if the exact path exists (could be a CSS/JSON file)
  if (ext) {
    if (await fileExists(basePath)) return basePath;
    // Don't try adding extensions to paths that already have one
    return null;
  }

  // 2. Try each extension
  for (const tryExt of RESOLVE_EXTENSIONS) {
    const withExt = basePath + tryExt;
    if (await fileExists(withExt)) return withExt;
  }

  // 3. Try as directory with index file
  for (const tryExt of RESOLVE_EXTENSIONS) {
    const indexPath = path.join(basePath, `index${tryExt}`);
    if (await fileExists(indexPath)) return indexPath;
  }

  return null;
}

/**
 * Resolve an asset reference to a file on disk.
 * Checks both public/ and src/ directories.
 */
async function resolveAsset(
  specifier: string,
  projectRoot: string,
): Promise<string | null> {
  // Try exact path from project root
  const fromRoot = path.join(projectRoot, specifier);
  if (await fileExists(fromRoot)) return fromRoot;

  // Try in public/ directory
  const fromPublic = path.join(projectRoot, 'public', specifier);
  if (await fileExists(fromPublic)) return fromPublic;

  // Try in src/assets/
  const fromAssets = path.join(projectRoot, 'src', 'assets', path.basename(specifier));
  if (await fileExists(fromAssets)) return fromAssets;

  return null;
}

// ════════════════════════════════════════════
//  Find Project Root(s)
// ════════════════════════════════════════════

/**
 * Find the project root by looking for package.json.
 * The agent often creates apps inside a subdirectory.
 */
async function findProjectRoots(baseDir: string): Promise<string[]> {
  const roots: string[] = [];

  // Check base dir itself
  if (await fileExists(path.join(baseDir, 'package.json'))) {
    roots.push(baseDir);
  }

  // Check immediate subdirectories
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const subDir = path.join(baseDir, entry.name);
      if (await fileExists(path.join(subDir, 'package.json'))) {
        roots.push(subDir);
      }
    }
  } catch { /* empty dir is fine */ }

  return roots;
}

// ════════════════════════════════════════════
//  Main Check
// ════════════════════════════════════════════
export async function runPreCompletionCheck(projectFolder: string): Promise<PreCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let filesScanned = 0;
  let importsChecked = 0;

  // Resolve the absolute project folder
  const absProjectFolder = path.resolve(projectFolder);

  // Find project roots (may be in subdirectory)
  const projectRoots = await findProjectRoots(absProjectFolder);
  if (projectRoots.length === 0) {
    // No package.json found — might be a Python project or empty project
    return { pass: true, errors: [], warnings: ['No package.json found — skipping JS/TS import checks'], filesScanned: 0, importsChecked: 0 };
  }

  for (const projectRoot of projectRoots) {
    // Find all source files
    const sourceFiles = await findSourceFiles(projectRoot);
    filesScanned += sourceFiles.length;

    for (const filePath of sourceFiles) {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        warnings.push(`Could not read: ${path.relative(absProjectFolder, filePath)}`);
        continue;
      }

      const imports = extractImports(content, filePath);
      const relFile = path.relative(absProjectFolder, filePath);

      for (const imp of imports) {
        // Skip external/npm imports
        if (isExternalImport(imp.specifier)) continue;

        // Skip CSS-only imports (they're fine if they exist or not in some setups)
        if (imp.specifier.endsWith('.css') && imp.type === 'static') {
          importsChecked++;
          const resolved = await resolveImport(imp.specifier, filePath, projectRoot);
          if (!resolved) {
            warnings.push(`${relFile}:${imp.line} — CSS import not found: ${imp.specifier}`);
          }
          continue;
        }

        importsChecked++;

        if (imp.type === 'asset') {
          // Asset reference
          const resolved = await resolveAsset(imp.specifier, projectRoot);
          if (!resolved) {
            errors.push(`${relFile}:${imp.line} — Asset not found: ${imp.specifier}`);
          }
        } else {
          // Module import
          const resolved = await resolveImport(imp.specifier, filePath, projectRoot);
          if (!resolved) {
            errors.push(`${relFile}:${imp.line} — Import not found: "${imp.specifier}" (${imp.type})`);
          }
        }
      }
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
    filesScanned,
    importsChecked,
  };
}

/**
 * Format check results into a human-readable report.
 */
export function formatPreCheckReport(result: PreCheckResult): string {
  const lines: string[] = [
    `## Pre-Completion Integrity Check`,
    `Verdict: **${result.pass ? 'PASS' : 'FAIL'}**`,
    `Files scanned: ${result.filesScanned}`,
    `Imports checked: ${result.importsChecked}`,
  ];

  if (result.errors.length > 0) {
    lines.push('', '### ❌ Broken Imports/Assets:');
    for (const err of result.errors) {
      lines.push(`- ${err}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('', '### ⚠️ Warnings:');
    for (const w of result.warnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join('\n');
}
