import React, { useState, useEffect, useCallback, useRef } from 'react';

const BRIDGE_URL = 'http://127.0.0.1:7771';

interface BridgeStatus {
  bridge_online: boolean;
  ue5_connected: boolean;
  render_status: string;
  render_progress: number;
}

interface Archive {
  archived_at: string;
  preset_name: string;
  archive_path: string;
}

const PITCH_TYPES = ['FF', 'SI', 'FC', 'SL', 'CU', 'CH', 'FS', 'ST'];

export function RenderStudioPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  // Scene state
  const [scenes, setScenes] = useState<string[]>([]);
  const [cameras, setCameras] = useState<string[]>([]);
  const [selectedScene, setSelectedScene] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');

  // Overlay state
  const [overlayPresets, setOverlayPresets] = useState<string[]>([]);
  const [selectedOverlay, setSelectedOverlay] = useState('');

  // Pitch config
  const [pitchType, setPitchType] = useState('FF');
  const [velocity, setVelocity] = useState(95);
  const [spinRate, setSpinRate] = useState(2400);
  const [spinAxis, setSpinAxis] = useState(210);

  // Macros
  const [macros, setMacros] = useState<{ name: string; description: string }[]>([]);

  // Archives
  const [archives, setArchives] = useState<Archive[]>([]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);

  const bridgeFetch = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(`${BRIDGE_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
    });
    return res.json();
  }, []);

  // Poll status
  useEffect(() => {
    if (collapsed) return;
    let active = true;
    const poll = async () => {
      try {
        const data = await bridgeFetch('/status');
        if (active) setStatus(data);
      } catch {
        if (active) setStatus(null);
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { active = false; clearInterval(id); };
  }, [collapsed, bridgeFetch]);

  // Load scene + overlay state on connect
  useEffect(() => {
    if (!status?.bridge_online) return;
    bridgeFetch('/scene/state').then(data => {
      setScenes(data.available_scenes || []);
      setCameras(data.available_cameras || []);
      setSelectedScene(data.scene_name || '');
      setSelectedCamera(data.camera_preset || '');
    }).catch(() => {});
    bridgeFetch('/overlay/state').then(data => {
      setOverlayPresets(data.available_presets || []);
      setSelectedOverlay(data.overlay_preset || '');
    }).catch(() => {});
    bridgeFetch('/macros/list').then(data => {
      setMacros(data.macros || []);
    }).catch(() => {});
    bridgeFetch('/archive/list').then(data => {
      setArchives(data.archives || []);
    }).catch(() => {});
  }, [status?.bridge_online, bridgeFetch]);

  const applyScene = async (name: string) => {
    setSelectedScene(name);
    await bridgeFetch('/scene/configure', { method: 'POST', body: JSON.stringify({ scene_name: name }) });
    showToast(`Scene: ${name}`);
  };

  const applyCamera = async (name: string) => {
    setSelectedCamera(name);
    await bridgeFetch('/scene/camera', { method: 'POST', body: JSON.stringify({ camera_name: name }) });
    showToast(`Camera: ${name}`);
  };

  const applyOverlay = async (name: string) => {
    setSelectedOverlay(name);
    await bridgeFetch('/overlay/preset', { method: 'POST', body: JSON.stringify({ preset_name: name }) });
    showToast(`Overlay: ${name}`);
  };

  const sendPitchData = async () => {
    await bridgeFetch('/overlay/pitch_data', {
      method: 'POST',
      body: JSON.stringify({
        pitch_type: pitchType,
        velocity_mph: velocity,
        spin_rate_rpm: spinRate,
        spin_axis_degrees: spinAxis,
        spin_efficiency: 1.0,
        plate_x: 0, plate_z: 2.5,
        h_break_inches: 0, v_break_inches: 0,
      }),
    });
    showToast(`Pitch data sent: ${pitchType}`);
  };

  const startRender = async () => {
    await bridgeFetch('/render/start', { method: 'POST', body: '{}' });
    showToast('Render started');
  };

  const runMacro = async (name: string) => {
    const data = await bridgeFetch('/macros/run', {
      method: 'POST',
      body: JSON.stringify({ macro_name: name }),
    });
    showToast(`Macro "${name}" — ${data.steps_completed} steps`);
  };

  const importToPremiere = async (filePath: string) => {
    const data = await bridgeFetch('/premiere/import', {
      method: 'POST',
      body: JSON.stringify({ file_path: filePath }),
    });
    showToast(data.imported ? 'Imported to Premiere' : 'Import failed');
  };

  const online = status?.bridge_online ?? false;
  const dotColor = online ? '#4ade80' : '#f87171';
  const dotBg = online ? '#1b4332' : '#442222';

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '6px 0',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12 }}>
          {collapsed ? '\u25B6' : '\u25BC'} Render Studio
        </span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3,
          background: dotBg, color: dotColor,
        }}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: '4px 0', fontSize: 11 }}>
          {toast && (
            <div style={{
              background: '#1b4332', color: '#4ade80', padding: '4px 8px',
              borderRadius: 3, marginBottom: 6, fontSize: 10,
            }}>
              {toast}
            </div>
          )}

          {/* Scene */}
          <label style={labelStyle}>Scene</label>
          <select value={selectedScene} onChange={e => applyScene(e.target.value)} style={selectStyle}>
            <option value="">—</option>
            {scenes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Camera */}
          <label style={labelStyle}>Camera</label>
          <select value={selectedCamera} onChange={e => applyCamera(e.target.value)} style={selectStyle}>
            <option value="">—</option>
            {cameras.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Overlay */}
          <label style={labelStyle}>Overlay</label>
          <select value={selectedOverlay} onChange={e => applyOverlay(e.target.value)} style={selectStyle}>
            <option value="">—</option>
            {overlayPresets.map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          {/* Pitch Config */}
          <label style={labelStyle}>Pitch</label>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <select value={pitchType} onChange={e => setPitchType(e.target.value)} style={{ ...selectStyle, flex: 1, marginBottom: 0 }}>
              {PITCH_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
            </select>
            <input type="number" value={velocity} onChange={e => setVelocity(+e.target.value)} placeholder="mph" style={{ ...inputStyle, width: 50 }} />
            <input type="number" value={spinRate} onChange={e => setSpinRate(+e.target.value)} placeholder="rpm" style={{ ...inputStyle, width: 55 }} />
            <input type="number" value={spinAxis} onChange={e => setSpinAxis(+e.target.value)} placeholder="axis" style={{ ...inputStyle, width: 45 }} />
          </div>
          <button onClick={sendPitchData} style={btnStyle}>Send Pitch Data</button>

          {/* Render Controls */}
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button onClick={startRender} style={{ ...btnStyle, flex: 1, background: '#1b4332', color: '#4ade80' }}>
              Render
            </button>
            {macros.length > 0 && (
              <select
                onChange={e => { if (e.target.value) runMacro(e.target.value); e.target.value = ''; }}
                style={{ ...selectStyle, flex: 1, marginBottom: 0 }}
              >
                <option value="">Quick Macro...</option>
                {macros.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            )}
          </div>

          {/* Render status */}
          {status && status.render_status !== 'idle' && (
            <div style={{ marginTop: 4, fontSize: 10, color: '#999' }}>
              Status: {status.render_status}
              {status.render_progress > 0 && ` (${(status.render_progress * 100).toFixed(0)}%)`}
            </div>
          )}

          {/* Recent Renders */}
          {archives.length > 0 && (
            <>
              <label style={{ ...labelStyle, marginTop: 8 }}>Recent Renders</label>
              {archives.slice(0, 5).map((a, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '2px 0', borderBottom: '1px solid #333', fontSize: 10,
                }}>
                  <span style={{ color: '#ccc' }}>
                    {a.preset_name || 'render'} — {a.archived_at?.slice(11, 19) || ''}
                  </span>
                  <button
                    onClick={() => importToPremiere(a.archive_path)}
                    style={{ ...btnStyle, fontSize: 9, padding: '1px 4px' }}
                  >
                    Import
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#888', marginTop: 6, marginBottom: 2,
};

const selectStyle: React.CSSProperties = {
  width: '100%', background: '#333', color: '#eee', border: '1px solid #555',
  borderRadius: 3, padding: '3px 4px', fontSize: 11, marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  background: '#333', color: '#eee', border: '1px solid #555',
  borderRadius: 3, padding: '3px 4px', fontSize: 11,
};

const btnStyle: React.CSSProperties = {
  background: '#444', color: '#eee', border: '1px solid #555',
  borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
};
