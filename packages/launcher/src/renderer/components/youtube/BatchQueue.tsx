import React from 'react';
import { c } from '../../styles.js';
import type { BatchQueueItem } from '@mayday/types';

const STATUS_COLORS: Record<string, string> = {
  queued: c.text.secondary,
  processing: c.accent.primary,
  complete: c.status.success,
  error: c.status.error,
};

interface BatchQueueProps {
  queue: BatchQueueItem[];
  onRemove: (id: string) => void;
  onProcess: () => void;
}

export function BatchQueue({ queue, onRemove, onProcess }: BatchQueueProps): React.ReactElement {
  const hasQueued = queue.some(q => q.status === 'queued');

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: c.text.primary, fontSize: 14, fontWeight: 600, margin: 0 }}>
          Batch Queue ({queue.length})
        </h3>
        {hasQueued && (
          <button
            onClick={onProcess}
            style={{
              padding: '6px 14px',
              background: c.accent.primary,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Process Queue
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <div style={{ color: c.text.secondary, fontSize: 12, textAlign: 'center', padding: 40 }}>
          No videos in queue. Add URLs from the Analyze tab.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {queue.map(item => (
            <div key={item.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              background: c.bg.elevated,
              borderRadius: 6,
              border: `1px solid ${c.border.default}`,
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: STATUS_COLORS[item.status] || c.text.disabled,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: c.text.primary,
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {item.title || item.url}
                </div>
                {item.title && (
                  <div style={{ color: c.text.disabled, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.url}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 10, color: c.text.secondary, flexShrink: 0 }}>
                {item.status}
              </span>
              {item.status === 'queued' && (
                <button
                  onClick={() => onRemove(item.id)}
                  style={{
                    padding: '2px 8px',
                    background: 'transparent',
                    border: `1px solid ${c.border.default}`,
                    color: c.text.secondary,
                    borderRadius: 3,
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
