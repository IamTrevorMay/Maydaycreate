import React, { useEffect, useState } from 'react';

const API = 'http://localhost:9876/api/plugins/pathguard/command';

interface PathGuardStatus {
  scanning: boolean;
  projectPath: string | null;
  managedCount: number;
  brokenCount: number;
  daemonRunning: boolean;
  lastScan: string | null;
}

interface PathGuardPanelProps {
  onMessage: (type: string, callback: (payload: unknown) => void) => () => void;
  send: (type: string, payload?: unknown) => void;
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

export function PathGuardPanel({ onMessage, send }: PathGuardPanelProps) {
  const [status, setStatus] = useState<PathGuardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const result = await runCommand('get-status') as PathGuardStatus;
      setStatus(result);
      setError(null);
    } catch (err) {
      // Plugin may not be active yet
      setError('PathGuard plugin not active');
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div style={{
      marginTop: 12,
      padding: 10,
      background: '#1a1a2e',
      borderRadius: 6,
      border: '1px solid #333',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#e0e0e0' }}>
          PathGuard
        </span>
        <span style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 3,
          background: status ? '#1b4332' : '#333',
          color: status ? '#4ade80' : '#888',
        }}>
          {status ? 'Active' : 'Inactive'}
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>
          {error}
        </div>
      )}

      {status && (
        <div style={{ fontSize: 11, color: '#ccc' }}>
          <div>Managed files: {status.managedCount}</div>
          {status.brokenCount > 0 && (
            <div style={{ color: '#f87171' }}>
              Broken symlinks: {status.brokenCount}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => runCommand('scan-project').then(fetchStatus)}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                background: '#2680eb',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              Scan Project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
