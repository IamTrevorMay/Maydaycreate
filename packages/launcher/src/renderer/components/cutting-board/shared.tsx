import React from 'react';
import { c } from '../../styles.js';
export { INTENT_TAGS } from '@mayday/types';

export const EDIT_TYPE_COLORS: Record<string, string> = {
  cut: '#2680eb',
  'trim-head': '#a855f7',
  'trim-tail': '#ec4899',
  delete: '#f87171',
  move: '#fbbf24',
  add: '#4ade80',
};

export const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#4ade80',
  medium: '#fbbf24',
  low: '#f87171',
};

export function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div style={{
      background: c.bg.elevated,
      borderRadius: 8,
      padding: 14,
      border: `1px solid ${c.border.default}`,
      textAlign: 'center',
    }}>
      <div style={{ color: color || c.text.primary, fontSize: 22, fontWeight: 700, marginBottom: 2 }}>{value}</div>
      <div style={{ color: c.text.secondary, fontSize: 10 }}>{label}</div>
    </div>
  );
}

export function MiniStat({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: color || c.text.primary, fontSize: 14, fontWeight: 600 }}>{value}</div>
      <div style={{ color: c.text.secondary, fontSize: 10 }}>{label}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{
      background: c.bg.elevated,
      borderRadius: 8,
      border: `1px solid ${c.border.default}`,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ color: c.text.primary, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

export function TrainingProgress(): React.ReactElement {
  const [pct, setPct] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setPct(prev => {
        if (prev >= 95) return 95;
        const increment = prev < 50 ? 4 : prev < 80 ? 2 : 0.5;
        return Math.min(95, prev + increment);
      });
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: c.text.secondary }}>Training neural network...</span>
        <span style={{ fontSize: 10, color: c.text.secondary }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 6, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: c.accent.primary,
          borderRadius: 3,
          transition: 'width 0.2s',
        }} />
      </div>
    </div>
  );
}

export function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
