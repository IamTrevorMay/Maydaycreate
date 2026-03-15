import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  mtime: number;
  hash: string;
  size: number;
}

/** Files/dirs always ignored during sync */
const DEFAULT_IGNORE = [
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.mayday-build',
];

/** File extensions always ignored */
const IGNORED_EXTENSIONS = [
  '.log',
  '.tmp',
  '.bak',
  '.lock',
];

function matchesGlob(filename: string, pattern: string): boolean {
  // Simple glob: *.ext matches any file with that extension
  if (pattern.startsWith('*.')) {
    return filename.endsWith(pattern.slice(1));
  }
  return filename === pattern;
}

function shouldIgnore(
  name: string,
  exclude?: string[],
  include?: string[],
): boolean {
  // Always ignore these
  if (DEFAULT_IGNORE.includes(name)) return true;
  const ext = path.extname(name).toLowerCase();
  if (IGNORED_EXTENSIONS.includes(ext)) return true;

  // If include patterns are specified, only include files that match
  if (include && include.length > 0) {
    const matches = include.some(p => matchesGlob(name, p));
    if (!matches) return true;
  }

  // Check explicit exclude patterns
  if (exclude && exclude.length > 0) {
    if (exclude.some(p => matchesGlob(name, p))) return true;
  }

  return false;
}

/**
 * Compute SHA-256 hash of a file's contents.
 */
export function hashFile(filePath: string): string {
  const contents = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

export interface ScanOptions {
  include?: string[];
  exclude?: string[];
}

/**
 * Recursively walk a directory and return all files with their metadata.
 * @param rootDir   Absolute path to the root directory to scan
 * @param baseDir   The root used for computing relative paths (defaults to rootDir)
 * @param opts      Optional include/exclude glob patterns
 */
export function scanDirectory(
  rootDir: string,
  baseDir?: string,
  opts?: ScanOptions,
): ScannedFile[] {
  const base = baseDir ?? rootDir;
  const results: ScannedFile[] = [];

  if (!fs.existsSync(rootDir)) return results;

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (DEFAULT_IGNORE.includes(entry.name)) continue;

    const abs = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDirectory(abs, base, opts));
    } else if (entry.isFile()) {
      if (shouldIgnore(entry.name, opts?.exclude, opts?.include)) continue;
      const stat = fs.statSync(abs);
      results.push({
        relativePath: path.relative(base, abs),
        absolutePath: abs,
        mtime: stat.mtimeMs,
        hash: hashFile(abs),
        size: stat.size,
      });
    }
  }

  return results;
}

/**
 * Build a map from relativePath → ScannedFile for quick lookup.
 */
export function buildFileMap(files: ScannedFile[]): Map<string, ScannedFile> {
  const map = new Map<string, ScannedFile>();
  for (const f of files) {
    map.set(f.relativePath, f);
  }
  return map;
}
