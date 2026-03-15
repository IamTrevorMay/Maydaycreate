import React, { useEffect, useState, useCallback } from 'react';

const API = 'http://localhost:9876/api/plugins/preset-vault/command';

interface PresetEntry {
  id: string;
  name: string;
  tags: string[];
  folder: string;
  effectCount: number;
  sourceClipName: string;
  createdAt: string;
  updatedAt: string;
}

interface PresetVaultPanelProps {
  onMessage: (type: string, callback: (payload: unknown) => void) => () => void;
}

async function runCommand(cmd: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${API}/${cmd}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Command failed');
  return data.result;
}

export function PresetVaultPanel({ onMessage }: PresetVaultPanelProps) {
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [captureName, setCaptureName] = useState('');
  const [captureTags, setCaptureTags] = useState('');
  const [captureFolder, setCaptureFolder] = useState('');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchPresets = useCallback(async () => {
    try {
      const result = await runCommand('list', search ? { search } : {});
      setPresets(result as PresetEntry[]);
    } catch {
      // Plugin may not be active yet
    }
  }, [search]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  useEffect(() => {
    const unsub1 = onMessage('plugin:preset-vault:preset-saved', () => {
      fetchPresets();
    });
    const unsub2 = onMessage('plugin:preset-vault:preset-deleted', () => {
      fetchPresets();
    });
    return () => { unsub1(); unsub2(); };
  }, [onMessage, fetchPresets]);

  const handleCapture = async () => {
    if (!captureName.trim()) {
      showToast('Enter a preset name');
      return;
    }
    setBusy(true);
    try {
      const tags = captureTags.split(',').map(t => t.trim()).filter(Boolean);
      await runCommand('capture', {
        name: captureName.trim(),
        tags,
        folder: captureFolder.trim(),
      });
      showToast(`Captured "${captureName}"`);
      setCaptureName('');
      setCaptureTags('');
      setCaptureFolder('');
      await fetchPresets();
    } catch (err) {
      showToast(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async (presetId: string, presetName: string) => {
    setBusy(true);
    try {
      await runCommand('apply', { presetId });
      showToast(`Applied "${presetName}"`);
    } catch (err) {
      showToast(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (presetId: string, presetName: string) => {
    setBusy(true);
    try {
      await runCommand('delete-preset', { presetId });
      showToast(`Deleted "${presetName}"`);
      await fetchPresets();
    } catch (err) {
      showToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClearEffects = async () => {
    setBusy(true);
    try {
      await runCommand('clear-effects');
      showToast('Effects cleared');
    } catch (err) {
      showToast(`Clear failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (format: string) => {
    try {
      const result = await runCommand('export-excalibur', { format }) as { content: string };
      // Copy to clipboard via a textarea trick (CEP doesn't have navigator.clipboard)
      const ta = document.createElement('textarea');
      ta.value = result.content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(`${format} macros copied to clipboard`);
    } catch (err) {
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const styles = {
    container: { padding: 8, fontSize: 12 } as React.CSSProperties,
    section: { marginBottom: 12 } as React.CSSProperties,
    sectionTitle: { fontWeight: 600, fontSize: 11, color: '#aaa', textTransform: 'uppercase' as const, marginBottom: 6, letterSpacing: '0.5px' },
    input: { width: '100%', padding: '4px 6px', background: '#252525', border: '1px solid #444', borderRadius: 3, color: '#e0e0e0', fontSize: 12, marginBottom: 4, boxSizing: 'border-box' as const },
    row: { display: 'flex', gap: 4, marginBottom: 4 } as React.CSSProperties,
    btn: { padding: '4px 10px', background: '#2680eb', color: '#fff', border: 'none', borderRadius: 3, fontSize: 11, cursor: 'pointer' } as React.CSSProperties,
    btnDanger: { padding: '3px 6px', background: '#442222', color: '#f87171', border: '1px solid #553333', borderRadius: 3, fontSize: 10, cursor: 'pointer' } as React.CSSProperties,
    btnSecondary: { padding: '4px 10px', background: '#383838', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: 11, cursor: 'pointer' } as React.CSSProperties,
    card: { background: '#252525', border: '1px solid #383838', borderRadius: 4, padding: 8, marginBottom: 6 } as React.CSSProperties,
    cardName: { fontWeight: 600, fontSize: 12, color: '#e0e0e0' },
    cardMeta: { fontSize: 10, color: '#888', marginTop: 2 },
    tag: { display: 'inline-block', padding: '1px 5px', background: '#1b3a5c', color: '#6cb4ee', borderRadius: 2, fontSize: 9, marginRight: 3 } as React.CSSProperties,
    cardActions: { display: 'flex', gap: 4, marginTop: 6 } as React.CSSProperties,
    toast: { position: 'fixed' as const, bottom: 40, left: '50%', transform: 'translateX(-50%)', background: '#333', color: '#fff', padding: '6px 14px', borderRadius: 4, fontSize: 11, zIndex: 999 },
    exportRow: { display: 'flex', gap: 4, flexWrap: 'wrap' as const } as React.CSSProperties,
  };

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Preset Vault</div>

      {/* Capture Section */}
      <div style={styles.section}>
        <input
          style={styles.input}
          placeholder="Preset name"
          value={captureName}
          onChange={e => setCaptureName(e.target.value)}
        />
        <div style={styles.row}>
          <input
            style={{ ...styles.input, flex: 1, marginBottom: 0 }}
            placeholder="Tags (comma-separated)"
            value={captureTags}
            onChange={e => setCaptureTags(e.target.value)}
          />
          <input
            style={{ ...styles.input, flex: 1, marginBottom: 0 }}
            placeholder="Folder"
            value={captureFolder}
            onChange={e => setCaptureFolder(e.target.value)}
          />
        </div>
        <div style={styles.row}>
          <button style={styles.btn} onClick={handleCapture} disabled={busy}>
            Capture from Selected
          </button>
          <button style={styles.btnSecondary} onClick={handleClearEffects} disabled={busy}>
            Clear Effects
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={styles.section}>
        <input
          style={styles.input}
          placeholder="Search presets..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Preset Library */}
      <div style={styles.section}>
        {presets.length === 0 && (
          <div style={{ color: '#666', fontSize: 11, textAlign: 'center', padding: 16 }}>
            No presets yet. Capture effects from a clip to get started.
          </div>
        )}
        {presets.map(p => (
          <div key={p.id} style={styles.card}>
            <div style={styles.cardName}>{p.name}</div>
            <div style={styles.cardMeta}>
              {p.effectCount} effect{p.effectCount !== 1 ? 's' : ''} &middot; {p.sourceClipName}
              {p.folder && <> &middot; {p.folder}</>}
            </div>
            {p.tags.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {p.tags.map(t => <span key={t} style={styles.tag}>{t}</span>)}
              </div>
            )}
            <div style={styles.cardActions}>
              <button
                style={styles.btn}
                onClick={() => handleApply(p.id, p.name)}
                disabled={busy}
              >
                Apply
              </button>
              <button
                style={styles.btnDanger}
                onClick={() => handleDelete(p.id, p.name)}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Export */}
      {presets.length > 0 && (
        <div style={styles.section}>
          <div style={{ ...styles.sectionTitle, marginBottom: 4 }}>Export Macros</div>
          <div style={styles.exportRow}>
            <button style={styles.btnSecondary} onClick={() => handleExport('excalibur')}>
              Excalibur
            </button>
            <button style={styles.btnSecondary} onClick={() => handleExport('ahk')}>
              AHK
            </button>
            <button style={styles.btnSecondary} onClick={() => handleExport('keyboard-maestro')}>
              Keyboard Maestro
            </button>
          </div>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}
