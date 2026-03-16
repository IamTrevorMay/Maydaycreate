import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BridgeMessage } from '@mayday/types';

type MessageCallback = (payload: unknown) => void;

interface Props {
  connected: boolean;
  send: (message: BridgeMessage) => void;
  onMessage: (type: string, callback: MessageCallback) => () => void;
}

interface AggregateStats {
  totalEdits: number;
  totalSessions: number;
  approvalRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  boostedCount: number;
  undoRate: number;
  editsByType: Record<string, number>;
  recentSessions: Array<{
    id: number;
    sequenceName: string;
    startedAt: number;
    totalEdits: number;
    approvalRate: number | null;
  }>;
}

interface CloudStats {
  totalEdits: number;
  totalSessions: number;
  approvalRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  boostedCount: number;
  undoRate: number;
  editsByType: Record<string, number>;
  machineCount: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const EDIT_TYPES = ['cut', 'trim-head', 'trim-tail', 'delete', 'move', 'add'];
const STATS_REFRESH_MS = 10000;

const colors = {
  bg: { primary: '#1e1e1e', secondary: '#232323', tertiary: '#2a2a2a', elevated: '#303030' },
  text: { primary: '#e0e0e0', secondary: '#999999' },
  accent: '#2680eb',
  border: '#333333',
};

export function TrainingDashboard({ connected, send, onMessage }: Props) {
  const [stats, setStats] = useState<AggregateStats | null>(null);
  const [cloudStats, setCloudStats] = useState<CloudStats | null>(null);
  const [viewMode, setViewMode] = useState<'local' | 'cloud'>('local');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef('');

  // Fetch stats from server
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:9876/api/plugins/cutting-board/command/training-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setStats(data.result);
      }
    } catch {
      // Server not available
    }

    // Also fetch cloud stats
    try {
      const cloudRes = await fetch('http://localhost:9876/api/training/cloud-stats');
      const cloudData = await cloudRes.json();
      if (cloudData.success && cloudData.result) {
        setCloudStats(cloudData.result);
      }
    } catch {
      // Cloud sync not configured or unavailable
    }
  }, []);

  // Auto-refresh stats
  useEffect(() => {
    if (!connected) return;
    fetchStats();
    const interval = setInterval(fetchStats, STATS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [connected, fetchStats]);

  // Refresh stats when new edits arrive
  useEffect(() => {
    return onMessage('plugin:cutting-board:feedback-request', () => {
      fetchStats();
    });
  }, [onMessage, fetchStats]);

  // Chat streaming handlers
  useEffect(() => {
    const unsub1 = onMessage('training:chat-delta', (payload: unknown) => {
      const { delta } = payload as { delta: string };
      streamingContentRef.current += delta;
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: streamingContentRef.current };
        }
        return updated;
      });
    });

    const unsub2 = onMessage('training:chat-done', () => {
      setStreaming(false);
      streamingContentRef.current = '';
    });

    return () => { unsub1(); unsub2(); };
  }, [onMessage]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    streamingContentRef.current = '';

    send({
      id: crypto.randomUUID(),
      type: 'training:chat' as any,
      payload: {
        message: text,
        history: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
      },
      timestamp: Date.now(),
    });
  };

  // Use cloud stats when viewing "All Machines", local otherwise
  const activeStats = viewMode === 'cloud' && cloudStats ? cloudStats : stats;

  const maxEditCount = activeStats
    ? Math.max(1, ...EDIT_TYPES.map(t => activeStats.editsByType[t] || 0))
    : 1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Stats Section */}
      <div style={{ flex: '0 0 auto', maxHeight: '40%', overflow: 'auto', paddingBottom: 8, borderBottom: `1px solid ${colors.border}` }}>
        {/* View Toggle */}
        {cloudStats && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button
              onClick={() => setViewMode('local')}
              style={{
                flex: 1,
                padding: '3px 0',
                fontSize: 9,
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                background: viewMode === 'local' ? colors.accent : colors.bg.tertiary,
                color: viewMode === 'local' ? '#fff' : colors.text.secondary,
              }}
            >
              This Machine
            </button>
            <button
              onClick={() => setViewMode('cloud')}
              style={{
                flex: 1,
                padding: '3px 0',
                fontSize: 9,
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                background: viewMode === 'cloud' ? colors.accent : colors.bg.tertiary,
                color: viewMode === 'cloud' ? '#fff' : colors.text.secondary,
              }}
            >
              All Machines ({cloudStats.machineCount})
            </button>
          </div>
        )}

        {/* Stat Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <StatCard label="Total Edits" value={activeStats?.totalEdits ?? '\u2014'} />
          <StatCard label="Approval" value={activeStats?.approvalRate != null ? `${(activeStats.approvalRate * 100).toFixed(0)}%` : '\u2014'} />
          <StatCard label="Sessions" value={activeStats?.totalSessions ?? '\u2014'} />
          <StatCard label="Boosted" value={activeStats?.boostedCount ?? '\u2014'} />
        </div>

        {/* Edit Type Breakdown */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: colors.text.secondary, marginBottom: 4 }}>Edit Types</div>
          {EDIT_TYPES.map(type => {
            const count = activeStats?.editsByType[type] || 0;
            return (
              <div key={type} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 10, width: 60, color: colors.text.secondary }}>{type}</span>
                <div style={{ flex: 1, height: 10, background: colors.bg.primary, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(count / maxEditCount) * 100}%`,
                    background: colors.accent,
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }} />
                </div>
                <span style={{ fontSize: 10, width: 30, textAlign: 'right', color: colors.text.secondary }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Approval Bar */}
        <div>
          <div style={{ fontSize: 10, color: colors.text.secondary, marginBottom: 4 }}>Approval</div>
          {(() => {
            const up = activeStats?.thumbsUp ?? 0;
            const down = activeStats?.thumbsDown ?? 0;
            const total = up + down;
            const upPct = total > 0 ? (up / total) * 100 : 0;
            return (
              <>
                <div style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', background: colors.bg.primary }}>
                  {upPct > 0 && (
                    <div style={{ width: `${upPct}%`, background: '#22c55e', transition: 'width 0.3s' }} />
                  )}
                  {100 - upPct > 0 && total > 0 && (
                    <div style={{ width: `${100 - upPct}%`, background: '#ef4444', transition: 'width 0.3s' }} />
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                  <span style={{ fontSize: 9, color: '#22c55e' }}>{'\uD83D\uDC4D'} {up}</span>
                  <span style={{ fontSize: 9, color: '#ef4444' }}>{'\uD83D\uDC4E'} {down}</span>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Chat Section */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingTop: 8 }}>
        <div style={{ flex: 1, overflow: 'auto', marginBottom: 8 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: colors.text.secondary, fontSize: 11, padding: 20 }}>
              Ask questions about your editing patterns, get tips, or discuss your training data.
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 6,
            }}>
              <div style={{
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 11,
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: msg.role === 'user' ? colors.accent : colors.bg.elevated,
                color: colors.text.primary,
              }}>
                {msg.content || (streaming && i === messages.length - 1 ? '...' : '')}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={connected ? 'Ask about your edits...' : 'Disconnected'}
            disabled={!connected || streaming}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: colors.bg.primary,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              color: colors.text.primary,
              fontSize: 11,
              outline: 'none',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!connected || streaming || !input.trim()}
            style={{
              padding: '6px 12px',
              background: colors.accent,
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              fontSize: 11,
              cursor: 'pointer',
              opacity: (!connected || streaming || !input.trim()) ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      background: colors.bg.elevated,
      borderRadius: 4,
      padding: '6px 8px',
    }}>
      <div style={{ fontSize: 9, color: colors.text.secondary, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

