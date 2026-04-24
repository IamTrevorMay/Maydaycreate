import React, { useState, useCallback } from 'react';
import type { BridgeMessage } from '@mayday/types';

interface VideoIdBarProps {
  send: (message: BridgeMessage) => void;
}

/**
 * Parse a YouTube URL into a video ID, or return the input as-is for manual IDs.
 */
function parseVideoId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtube-nocookie.com')) {
      return url.searchParams.get('v') || trimmed;
    }
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return id || '';
    }
  } catch {
    // Not a URL — treat as manual ID
  }
  return trimmed;
}

export function VideoIdBar({ send }: VideoIdBarProps) {
  const [videoId, setVideoId] = useState('');
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);

  const submit = useCallback(() => {
    const parsed = parseVideoId(input);
    if (!parsed) return;
    setVideoId(parsed);
    setEditing(false);
    send({
      id: crypto.randomUUID(),
      type: 'plugin:cutting-board:set-video-id',
      payload: { videoId: parsed },
      timestamp: Date.now(),
    });
  }, [input, send]);

  const clear = useCallback(() => {
    setVideoId('');
    setInput('');
    setEditing(false);
    send({
      id: crypto.randomUUID(),
      type: 'plugin:cutting-board:set-video-id',
      payload: { videoId: '' },
      timestamp: Date.now(),
    });
  }, [send]);

  // Collapsed: show current video ID
  if (videoId && !editing) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: '#1e3a5f',
        borderRadius: 3,
        marginBottom: 2,
        fontSize: 10,
      }}>
        <span style={{ color: '#64748b' }}>Video:</span>
        <span style={{ color: '#93c5fd', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {videoId}
        </span>
        <button
          onClick={() => { setInput(videoId); setEditing(true); }}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 10, padding: 0 }}
        >
          edit
        </button>
        <button
          onClick={clear}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}
        >
          x
        </button>
      </div>
    );
  }

  // Expanded: input field
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 0',
      marginBottom: 2,
    }}>
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="YouTube URL or video ID (e.g. ep047)"
        autoFocus={editing}
        style={{
          flex: 1,
          padding: '4px 6px',
          background: '#1a1a2e',
          border: '1px solid #333',
          borderRadius: 3,
          color: '#e2e8f0',
          fontSize: 10,
          outline: 'none',
        }}
      />
      <button
        onClick={submit}
        disabled={!input.trim()}
        style={{
          padding: '4px 8px',
          background: input.trim() ? '#2680eb' : '#333',
          border: 'none',
          borderRadius: 3,
          color: input.trim() ? '#fff' : '#666',
          fontSize: 10,
          fontWeight: 600,
          cursor: input.trim() ? 'pointer' : 'default',
        }}
      >
        Set
      </button>
      {editing && (
        <button
          onClick={() => setEditing(false)}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 10, padding: 0 }}
        >
          cancel
        </button>
      )}
    </div>
  );
}
