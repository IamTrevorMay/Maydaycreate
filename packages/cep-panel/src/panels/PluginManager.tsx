import React, { useEffect, useState } from 'react';

interface PluginInfo {
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    commands?: Array<{ id: string; name: string; description?: string }>;
  };
  status: string;
}

export function PluginManager() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Array<Record<string, unknown>> | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);

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
                {plugin.manifest.commands.map((cmd) => (
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
