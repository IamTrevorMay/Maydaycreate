import React, { useState, useEffect, useCallback } from 'react';
import type { BridgeMessage } from '@mayday/types';

interface ProposalView {
  id: number;
  editType: string;
  description: string;
  confidence: number;
  reasoning: string;
  status: string;
}

interface AgentPanelProps {
  onMessage: (type: string, callback: (payload: unknown) => void) => () => void;
  send: (message: BridgeMessage) => void;
}

const editTypeColors: Record<string, string> = {
  'split': '#8b5cf6',
  'trim-head': '#06b6d4',
  'trim-tail': '#0ea5e9',
  'delete': '#ef4444',
  'insert': '#22c55e',
  'move': '#f59e0b',
  'enable': '#10b981',
  'disable': '#6b7280',
};

const modeDescriptions: Record<string, string> = {
  suggest: 'Propose edits only',
  preview: 'Propose + add markers',
  auto: 'Auto-execute above threshold',
};

export function AgentPanel({ onMessage, send }: AgentPanelProps) {
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [mode, setMode] = useState<string>('suggest');
  const [running, setRunning] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [instruction, setInstruction] = useState('');
  const [stats, setStats] = useState<{ cycleCount: number; lastAnalysis: string } | null>(null);

  // Subscribe to proposals updates
  useEffect(() => {
    const unsub1 = onMessage('plugin:edit-agent:proposals', (payload) => {
      setProposals(payload as ProposalView[]);
    });
    const unsub2 = onMessage('plugin:edit-agent:proposal-update', (payload) => {
      const update = payload as { id: number; status: string };
      setProposals(prev => prev.map(p => p.id === update.id ? { ...p, status: update.status } : p));
    });
    const unsub3 = onMessage('plugin:edit-agent:mode-change', (payload) => {
      const { mode: newMode } = payload as { mode: string };
      setMode(newMode);
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [onMessage]);

  const sendCommand = useCallback(async (command: string, args?: Record<string, unknown>) => {
    try {
      const res = await fetch(`http://localhost:9876/api/plugins/edit-agent/command/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      });
      const data = await res.json();
      return data;
    } catch {
      // Server not reachable
      return null;
    }
  }, []);

  const handleStartStop = useCallback(async () => {
    const result = await sendCommand(running ? 'stop-agent' : 'start-agent');
    if (result?.success) setRunning(!running);
  }, [running, sendCommand]);

  const handleAnalyze = useCallback(async () => {
    const result = await sendCommand('analyze', instruction ? { instruction } : undefined);
    if (result?.success && Array.isArray(result.result)) {
      setProposals(result.result);
    }
  }, [sendCommand, instruction]);

  const handleAccept = useCallback(async (proposalId: number) => {
    send({
      id: crypto.randomUUID(),
      type: 'plugin:edit-agent:accept',
      payload: { proposalId },
      timestamp: Date.now(),
    });
    // Optimistic update
    setProposals(prev => prev.map(p => p.id === proposalId ? { ...p, status: 'executed' } : p));
  }, [send]);

  const handleReject = useCallback(async (proposalId: number) => {
    send({
      id: crypto.randomUUID(),
      type: 'plugin:edit-agent:reject',
      payload: { proposalId },
      timestamp: Date.now(),
    });
    // Optimistic update
    setProposals(prev => prev.map(p => p.id === proposalId ? { ...p, status: 'rejected' } : p));
  }, [send]);

  const handleModeChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value;
    await sendCommand('set-mode', { mode: newMode });
    setMode(newMode);
  }, [sendCommand]);

  const pendingCount = proposals.filter(p => p.status === 'pending').length;
  const executedCount = proposals.filter(p => p.status === 'executed').length;

  return (
    <div style={{
      border: '1px solid #333',
      borderRadius: 6,
      marginTop: 8,
      background: '#111',
      fontSize: 11,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: '1px solid #333',
        background: '#1a1a2e',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 12 }}>AI Agent</span>
          <span style={{
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 3,
            background: running ? '#1b4332' : '#2a2a2a',
            color: running ? '#4ade80' : '#888',
          }}>
            {running ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={mode}
            onChange={handleModeChange}
            style={{
              background: '#222',
              border: '1px solid #444',
              borderRadius: 3,
              color: '#ccc',
              fontSize: 10,
              padding: '2px 4px',
            }}
          >
            <option value="suggest">Suggest</option>
            <option value="preview">Preview</option>
            <option value="auto">Auto</option>
          </select>
          <button
            onClick={handleStartStop}
            style={{
              background: running ? '#7f1d1d' : '#1e3a5f',
              border: `1px solid ${running ? '#dc2626' : '#2680eb'}`,
              borderRadius: 3,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 10,
              color: running ? '#fca5a5' : '#93c5fd',
              fontWeight: 600,
            }}
          >
            {running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      {/* Analysis trigger */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #2a2a2a' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Optional instruction..."
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            style={{
              flex: 1,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 3,
              color: '#ccc',
              fontSize: 10,
              padding: '3px 6px',
            }}
          />
          <button
            onClick={handleAnalyze}
            style={{
              background: '#1e3a5f',
              border: '1px solid #2680eb',
              borderRadius: 3,
              padding: '3px 8px',
              cursor: 'pointer',
              fontSize: 10,
              color: '#93c5fd',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            Analyze
          </button>
        </div>
      </div>

      {/* Proposal list */}
      {proposals.length > 0 && (
        <div style={{ maxHeight: 200, overflow: 'auto' }}>
          {proposals.map(proposal => (
            <div
              key={proposal.id}
              style={{
                padding: '5px 10px',
                borderBottom: '1px solid #222',
                opacity: proposal.status === 'rejected' ? 0.4 : proposal.status === 'executed' ? 0.7 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Edit type badge */}
                <span style={{
                  background: editTypeColors[proposal.editType] || '#555',
                  color: '#fff',
                  padding: '1px 5px',
                  borderRadius: 3,
                  fontSize: 9,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  {proposal.editType}
                </span>

                {/* Description */}
                <span
                  style={{ flex: 1, color: '#ddd', cursor: 'pointer', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
                >
                  {proposal.description}
                </span>

                {/* Confidence */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                  <div style={{
                    width: 30,
                    height: 4,
                    background: '#333',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${proposal.confidence * 100}%`,
                      height: '100%',
                      background: proposal.confidence >= 0.7 ? '#22c55e' : proposal.confidence >= 0.4 ? '#f59e0b' : '#ef4444',
                      borderRadius: 2,
                    }} />
                  </div>
                  <span style={{ fontSize: 9, color: '#888' }}>
                    {(proposal.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Action buttons */}
                {proposal.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 3 }}>
                    <button
                      onClick={() => handleAccept(proposal.id)}
                      style={{
                        background: '#14532d',
                        border: '1px solid #22c55e',
                        borderRadius: 3,
                        padding: '1px 5px',
                        cursor: 'pointer',
                        fontSize: 9,
                        color: '#86efac',
                      }}
                    >
                      {'\u2713'}
                    </button>
                    <button
                      onClick={() => handleReject(proposal.id)}
                      style={{
                        background: '#450a0a',
                        border: '1px solid #dc2626',
                        borderRadius: 3,
                        padding: '1px 5px',
                        cursor: 'pointer',
                        fontSize: 9,
                        color: '#fca5a5',
                      }}
                    >
                      {'\u2717'}
                    </button>
                  </div>
                )}

                {/* Status badge for non-pending */}
                {proposal.status !== 'pending' && (
                  <span style={{
                    fontSize: 8,
                    padding: '1px 4px',
                    borderRadius: 2,
                    background: proposal.status === 'executed' ? '#14532d' : proposal.status === 'failed' ? '#450a0a' : '#333',
                    color: proposal.status === 'executed' ? '#86efac' : proposal.status === 'failed' ? '#fca5a5' : '#888',
                  }}>
                    {proposal.status}
                  </span>
                )}
              </div>

              {/* Expanded reasoning */}
              {expandedId === proposal.id && proposal.reasoning && (
                <div style={{
                  marginTop: 4,
                  padding: '4px 6px',
                  background: '#1a1a2e',
                  borderRadius: 3,
                  color: '#94a3b8',
                  fontSize: 10,
                  lineHeight: 1.4,
                }}>
                  {proposal.reasoning}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Batch controls + stats */}
      {proposals.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          borderTop: '1px solid #333',
          background: '#0a0a15',
        }}>
          <span style={{ fontSize: 9, color: '#666' }}>
            {pendingCount} pending / {executedCount} executed
          </span>
          {pendingCount > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => sendCommand('accept-all')}
                style={{
                  background: '#14532d',
                  border: '1px solid #22c55e',
                  borderRadius: 3,
                  padding: '1px 6px',
                  cursor: 'pointer',
                  fontSize: 9,
                  color: '#86efac',
                }}
              >
                Accept All
              </button>
              <button
                onClick={() => sendCommand('reject-all')}
                style={{
                  background: '#450a0a',
                  border: '1px solid #dc2626',
                  borderRadius: 3,
                  padding: '1px 6px',
                  cursor: 'pointer',
                  fontSize: 9,
                  color: '#fca5a5',
                }}
              >
                Reject All
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {proposals.length === 0 && (
        <div style={{ padding: '12px 10px', textAlign: 'center', color: '#555', fontSize: 10 }}>
          Click "Analyze" or start the agent to get edit suggestions
        </div>
      )}
    </div>
  );
}
