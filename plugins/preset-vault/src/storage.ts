import fs from 'fs';
import path from 'path';
import type { EffectPreset, PresetIndexEntry, PresetLibraryIndex, PresetFolder } from '@mayday/types';

const INDEX_FILE = 'index.json';
const PRESETS_DIR = 'presets';
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function ensureDirs(baseDir: string) {
  const presetsDir = path.join(baseDir, PRESETS_DIR);
  if (!fs.existsSync(presetsDir)) {
    fs.mkdirSync(presetsDir, { recursive: true });
  }
}

function emptyIndex(): PresetLibraryIndex {
  return { version: 1, presets: [], folders: [], lastUpdated: new Date().toISOString() };
}

export function loadIndex(baseDir: string): PresetLibraryIndex {
  const indexPath = path.join(baseDir, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return emptyIndex();
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch {
    return emptyIndex();
  }
}

function saveIndex(baseDir: string, index: PresetLibraryIndex) {
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(path.join(baseDir, INDEX_FILE), JSON.stringify(index, null, 2));
}

function buildFolders(presets: PresetIndexEntry[]): PresetFolder[] {
  const folderMap = new Map<string, PresetFolder>();

  for (const p of presets) {
    const folderPath = p.folder || '';
    if (!folderPath) continue;

    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, {
        name: folderPath.split('/').pop() || folderPath,
        path: folderPath,
        children: [],
        presetCount: 0,
      });
    }
    folderMap.get(folderPath)!.presetCount++;
  }

  return Array.from(folderMap.values());
}

export function savePreset(baseDir: string, preset: EffectPreset): PresetIndexEntry {
  ensureDirs(baseDir);

  // Write preset file atomically (write to temp, then rename)
  const presetPath = path.join(baseDir, PRESETS_DIR, `${preset.id}.json`);
  const tmpPath = presetPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(preset, null, 2));
  fs.renameSync(tmpPath, presetPath);

  // Update index
  const index = loadIndex(baseDir);
  const entry: PresetIndexEntry = {
    id: preset.id,
    name: preset.name,
    tags: preset.tags,
    folder: preset.folder,
    effectCount: preset.effects.filter(e => !e.isIntrinsic || preset.includeIntrinsics).length,
    sourceClipName: preset.sourceClipName,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };

  const existingIdx = index.presets.findIndex(p => p.id === preset.id);
  if (existingIdx >= 0) {
    index.presets[existingIdx] = entry;
  } else {
    index.presets.push(entry);
  }

  index.folders = buildFolders(index.presets);
  saveIndex(baseDir, index);

  return entry;
}

export function loadPreset(baseDir: string, presetId: string): EffectPreset | null {
  if (!SAFE_ID_RE.test(presetId)) throw new Error(`Invalid presetId: ${presetId}`);
  const presetPath = path.join(baseDir, PRESETS_DIR, `${presetId}.json`);
  if (!fs.existsSync(presetPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function deletePreset(baseDir: string, presetId: string): boolean {
  if (!SAFE_ID_RE.test(presetId)) throw new Error(`Invalid presetId: ${presetId}`);
  const presetPath = path.join(baseDir, PRESETS_DIR, `${presetId}.json`);
  if (!fs.existsSync(presetPath)) return false;

  fs.unlinkSync(presetPath);

  const index = loadIndex(baseDir);
  index.presets = index.presets.filter(p => p.id !== presetId);
  index.folders = buildFolders(index.presets);
  saveIndex(baseDir, index);

  return true;
}

export function listPresets(
  baseDir: string,
  filter?: { folder?: string; tag?: string; search?: string },
): PresetIndexEntry[] {
  const index = loadIndex(baseDir);
  let results = index.presets;

  if (filter?.folder) {
    results = results.filter(p => p.folder === filter.folder || p.folder.startsWith(filter.folder + '/'));
  }

  if (filter?.tag) {
    const tag = filter.tag.toLowerCase();
    results = results.filter(p => p.tags.some(t => t.toLowerCase() === tag));
  }

  if (filter?.search) {
    const q = filter.search.toLowerCase();
    results = results.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sourceClipName.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q)),
    );
  }

  return results;
}
