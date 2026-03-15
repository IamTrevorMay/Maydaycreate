import React from 'react';
import type { ServerStatus } from '@mayday/types';
import { c } from '../styles.js';

interface Props {
  status: ServerStatus | null;
}

export function ServerStatusIndicator({ status }: Props): React.ReactElement {
  const running = status?.running ?? false;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 16px',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: running ? c.status.success : c.status.error,
        }}
      />
      <span style={{ fontSize: 11, color: c.text.secondary }}>
        {running ? `Server :${status!.port}` : 'Server offline'}
      </span>
      {running && status && (
        <span style={{ fontSize: 10, color: c.text.disabled }}>
          · {status.activePlugins} plugin{status.activePlugins !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
