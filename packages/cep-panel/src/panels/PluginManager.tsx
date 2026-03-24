import React, { useEffect, useState, useRef } from 'react';
import { INTENT_TAGS } from '@mayday/types';

interface PluginInfo {
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    commands?: Array<{ id: string; name: string; description?: string; hidden?: boolean }>;
  };
  status: string;
}

interface SessionEndResult {
  sessionId: number;
  totalEdits: number;
  editsByType: Record<string, number>;
  approvalRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  boostedCount: number;
  undoCount: number;
  tagCounts: Record<string, number>;
}

export function PluginManager() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Array<Record<string, unknown>> | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [sessionModal, setSessionModal] = useState<SessionEndResult | null>(null);
  const [sessionName, setSessionName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const fetchPlugins = async () => {
    try {
      const res = await fetch('http://localhost:9876/api/plugins');
      const data = await res.json();
      setPlugins(data);
    } catch {
      // Server not running
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlugins();
    const interval = setInterval(fetchPlugins, 5000);
    return () => clearInterval(interval);
  }, []);

  const togglePlugin = async (id: string, currentStatus: string) => {
    const action = currentStatus === 'activated' ? 'disable' : 'enable';
    try {
      await fetch(`http://localhost:9876/api/plugins/${id}/${action}`, { method: 'POST' });
      await fetchPlugins();
    } catch (err) {
      setToast(`Failed to ${action} plugin`);
    }
  };

  const runCommand = async (pluginId: string, commandId: string) => {
    try {
      // execute-autocut needs the edits from a prior scan
      let body = '{}';
      if (commandId === 'execute-autocut' && pendingEdits) {
        body = JSON.stringify({ edits: pendingEdits });
      }

      const res = await fetch(`http://localhost:9876/api/plugins/${pluginId}/command/${commandId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await res.json();
      if (data.success) {
        // Handle scan-autocut result specially
        if (commandId === 'scan-autocut' && data.result?.edits) {
          const r = data.result;
          setPendingEdits(r.edits);
          setScanSummary(`${r.plannedEdits} edits planned across ${r.totalClips} clips (avg confidence: ${(r.avgConfidence * 100).toFixed(0)}%)`);
          setToast(`Scan complete — ${r.plannedEdits} edits found. Click "Execute Autocut" to apply.`);
        } else if (commandId === 'stop-capture' && data.result?.sessionId) {
          setSessionModal(data.result as SessionEndResult);
          setSessionName('');
          setTimeout(() => nameInputRef.current?.focus(), 100);
        } else if (commandId === 'execute-autocut') {
          const r = data.result;
          setPendingEdits(null);
          setScanSummary(null);
          setToast(`Autocut done — ${r?.executed ?? 0} edits applied (backup: ${r?.backupName ?? 'created'})`);
        } else {
          setToast(`${commandId}: ${JSON.stringify(data.result)}`);
        }
      } else {
        setToast(`Error: ${data.error}`);
      }
    } catch (err) {
      setToast(`Failed to run command`);
    }
  };

  const saveSessionName = async () => {
    if (!sessionModal) return;
    const name = sessionName.trim();
    if (name) {
      try {
        await fetch('http://localhost:9876/api/plugins/cutting-board/command/name-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionModal.sessionId, sessionName: name }),
        });
      } catch { /* best effort */ }
    }
    setSessionModal(null);
    setSessionName('');
    setToast(name ? `Session saved as "${name}"` : 'Session ended');
  };

  if (loading) {
    return <div style={{ padding: 12, color: '#888' }}>Loading plugins...</div>;
  }

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 12, left: 12, right: 12,
          background: '#333', border: '1px solid #555', borderRadius: 4,
          padding: '8px 12px', fontSize: 11, zIndex: 100,
          cursor: 'pointer',
        }} onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      {/* Session naming modal */}
      {sessionModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 500,
        }}>
          <div style={{
            background: '#1e1e2e', border: '1px solid #444', borderRadius: 8,
            padding: 16, width: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 12 }}>
              Session Complete
            </div>

            {/* Stats summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              <div style={{ background: '#2a2a3e', borderRadius: 4, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{sessionModal.totalEdits}</div>
                <div style={{ fontSize: 9, color: '#888' }}>Edits</div>
              </div>
              <div style={{ background: '#2a2a3e', borderRadius: 4, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80' }}>
                  {sessionModal.approvalRate != null ? `${(sessionModal.approvalRate * 100).toFixed(0)}%` : '--'}
                </div>
                <div style={{ fontSize: 9, color: '#888' }}>Approval</div>
              </div>
            </div>

            {/* Edit type breakdown */}
            {Object.keys(sessionModal.editsByType).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: '#666', marginBottom: 4 }}>Edit Types</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Object.entries(sessionModal.editsByType).map(([type, count]) => (
                    <span key={type} style={{
                      background: '#1e3a5f', color: '#93c5fd', borderRadius: 3,
                      padding: '2px 6px', fontSize: 9, fontWeight: 500,
                    }}>
                      {count} {type}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tag breakdown */}
            {Object.keys(sessionModal.tagCounts).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: '#666', marginBottom: 4 }}>Tags Applied</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {INTENT_TAGS
                    .filter(t => (sessionModal.tagCounts[t.id] || 0) > 0)
                    .map(tag => (
                      <span key={tag.id} style={{
                        background: '#2d1b69', color: '#a855f7', borderRadius: 3,
                        padding: '2px 6px', fontSize: 9, fontWeight: 500,
                      }}>
                        {sessionModal.tagCounts[tag.id]} {tag.label}
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Name input */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#666', marginBottom: 4 }}>Session Name</div>
              <input
                ref={nameInputRef}
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveSessionName(); }}
                placeholder="e.g. Episode 47 rough cut"
                style={{
                  width: '100%', background: '#111', border: '1px solid #444',
                  borderRadius: 4, padding: '6px 8px', fontSize: 11,
                  color: '#e2e8f0', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={saveSessionName}
                style={{
                  flex: 1, background: '#2680eb', color: '#fff', border: 'none',
                  borderRadius: 4, padding: '6px 0', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {sessionName.trim() ? 'Save' : 'Skip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {plugins.length === 0 ? (
        <div style={{ padding: 12, color: '#888' }}>No plugins found</div>
      ) : (
        plugins.map((plugin) => (
          <div key={plugin.manifest.id} style={{
            background: '#2a2a2a',
            borderRadius: 4,
            padding: 10,
            marginBottom: 6,
            border: '1px solid #333',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{plugin.manifest.name}</span>
                <span style={{ color: '#888', fontSize: 10, marginLeft: 6 }}>v{plugin.manifest.version}</span>
              </div>
              <button
                onClick={() => togglePlugin(plugin.manifest.id, plugin.status)}
                style={{
                  background: plugin.status === 'activated' ? '#1b4332' : '#333',
                  color: plugin.status === 'activated' ? '#4ade80' : '#888',
                  border: '1px solid #444',
                  borderRadius: 3,
                  padding: '2px 8px',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                {plugin.status === 'activated' ? 'ON' : 'OFF'}
              </button>
            </div>
            <div style={{ color: '#999', fontSize: 10, marginTop: 4 }}>
              {plugin.manifest.description}
            </div>
            {plugin.manifest.id === 'cutting-board' && scanSummary && (
              <div style={{
                marginTop: 6, padding: '6px 8px', background: '#1b4332',
                borderRadius: 3, color: '#4ade80', fontSize: 10,
              }}>
                {scanSummary}
              </div>
            )}
            {plugin.manifest.commands && plugin.status === 'activated' && (
              <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {plugin.manifest.commands.filter(cmd => !cmd.hidden).map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => runCommand(plugin.manifest.id, cmd.id)}
                    style={{
                      background: '#2680eb',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 3,
                      padding: '3px 8px',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    {cmd.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
