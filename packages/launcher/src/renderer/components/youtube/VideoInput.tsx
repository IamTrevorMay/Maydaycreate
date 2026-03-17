import React, { useState } from 'react';
import { c } from '../../styles.js';
import { useIpc } from '../../hooks/useIpc.js';
import type { YouTubeVideoInfo, AnalysisOptions } from '@mayday/types';

const YT_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/;

interface VideoInputProps {
  onAnalyze: (url: string, options?: AnalysisOptions) => void;
  onAddToQueue: (url: string, title?: string) => void;
  loading: boolean;
}

export function VideoInput({ onAnalyze, onAddToQueue, loading }: VideoInputProps): React.ReactElement {
  const ipc = useIpc();
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState<YouTubeVideoInfo | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [skipCuts, setSkipCuts] = useState(true);

  const isValid = YT_REGEX.test(url.trim());

  const fetchInfo = async () => {
    if (!isValid) return;
    setFetching(true);
    setError('');
    try {
      const videoInfo = await ipc.youtube.getVideoInfo(url.trim());
      setInfo(videoInfo);
    } catch (err) {
      setError((err as Error).message || 'Failed to fetch video info');
      setInfo(null);
    } finally {
      setFetching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isValid && !fetching) fetchInfo();
  };

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setInfo(null); setError(''); }}
          onKeyDown={handleKeyDown}
          placeholder="Paste YouTube URL..."
          style={{
            flex: 1,
            padding: '10px 14px',
            background: c.bg.elevated,
            border: `1px solid ${c.border.default}`,
            borderRadius: 6,
            color: c.text.primary,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          onClick={fetchInfo}
          disabled={!isValid || fetching}
          style={{
            padding: '10px 18px',
            background: c.accent.primary,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: isValid && !fetching ? 'pointer' : 'not-allowed',
            opacity: isValid && !fetching ? 1 : 0.5,
          }}
        >
          {fetching ? 'Fetching...' : 'Preview'}
        </button>
      </div>

      {error && (
        <div style={{ color: c.status.error, fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      {info && (
        <div style={{
          display: 'flex',
          gap: 16,
          padding: 16,
          background: c.bg.elevated,
          borderRadius: 8,
          border: `1px solid ${c.border.default}`,
        }}>
          {info.thumbnailUrl && (
            <img
              src={info.thumbnailUrl}
              alt=""
              style={{ width: 200, height: 112, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: c.text.primary, fontSize: 14, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {info.title}
            </div>
            <div style={{ color: c.text.secondary, fontSize: 12, marginBottom: 8 }}>
              {info.channel} &middot; {formatDuration(info.duration)} &middot; {info.resolution}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => onAnalyze(url.trim(), { skipCuts })}
                disabled={loading}
                style={{
                  padding: '8px 20px',
                  background: c.accent.primary,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? 'Starting...' : 'Analyze'}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={skipCuts}
                  onChange={(e) => setSkipCuts(e.target.checked)}
                  style={{ accentColor: c.accent.primary }}
                />
                <span style={{ color: c.text.secondary, fontSize: 11 }}>Skip Cuts</span>
              </label>
              <button
                onClick={() => onAddToQueue(url.trim(), info.title)}
                style={{
                  padding: '8px 20px',
                  background: c.bg.tertiary,
                  color: c.text.primary,
                  border: `1px solid ${c.border.default}`,
                  borderRadius: 5,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Add to Queue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
