import React, { useState, useEffect, useRef } from 'react';
import { useIpc } from '../hooks/useIpc.js';
import { c } from '../styles.js';

interface Props {
  onDone: () => void;
  onCancel: () => void;
}

type Step = 'confirm' | 'progress' | 'done' | 'error';

interface ProgressEvent {
  phase: string;
  message: string;
  pct: number;
  done: boolean;
  error?: string;
}

export function PushWizard({ onDone, onCancel }: Props): React.ReactElement {
  const ipc = useIpc();
  const [step, setStep] = useState<Step>('confirm');
  const [phase, setPhase] = useState('');
  const [pct, setPct] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [commitHash, setCommitHash] = useState('');
  const [publishedVersion, setPublishedVersion] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = ipc.app.onUpdateProgress((p: ProgressEvent) => {
      setPhase(p.phase);
      if (p.pct >= 0) setPct(p.pct);
      setLog((prev) => [...prev, p.message]);

      if (p.done && p.error) {
        setErrorMsg(p.error);
        setStep('error');
      } else if (p.done) {
        // Extract version and commit from completion message
        const versionMatch = p.message.match(/Published v([\d.]+)/);
        if (versionMatch) setPublishedVersion(versionMatch[1]);
        const commitMatch = p.message.match(/Commit: (\w+)/);
        if (commitMatch) setCommitHash(commitMatch[1]);
        setPct(100);
        setStep('done');
      }
    });
    return unsub;
  }, [ipc]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const startPush = async () => {
    setStep('progress');
    setLog([]);
    setErrorMsg('');
    setPct(0);
    try {
      await ipc.app.pushVersion();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (step !== 'error') {
        setErrorMsg(msg);
        setStep('error');
      }
    }
  };

  const retry = () => {
    setStep('confirm');
    setLog([]);
    setErrorMsg('');
    setPct(0);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0009', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: c.bg.elevated, border: `1px solid ${c.border.default}`, borderRadius: 8, padding: 28, width: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ color: c.text.primary, fontSize: 15, fontWeight: 600 }}>Push &amp; Publish</h3>

        {step === 'confirm' && (
          <>
            <p style={{ color: c.text.secondary, fontSize: 12 }}>
              Commits changes, bumps version, pushes to GitHub, builds and publishes a release. May take several minutes.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
              <button onClick={startPush} style={primaryBtn}>Push &amp; Publish</button>
            </div>
          </>
        )}

        {step === 'progress' && (
          <>
            <p style={{ color: c.accent.primary, fontSize: 13, fontWeight: 500 }}>{phase || 'Starting…'}</p>
            <div style={{ height: 8, background: c.bg.secondary, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: c.accent.primary, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <div ref={logRef} style={{ height: 160, overflow: 'auto', background: c.bg.primary, border: `1px solid ${c.border.default}`, borderRadius: 4, padding: 8, fontFamily: 'monospace', fontSize: 10, color: c.text.disabled, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {log.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p style={{ color: c.status.success, fontSize: 13 }}>Published!</p>
            {(commitHash || publishedVersion) && (
              <p style={{ color: c.text.secondary, fontSize: 12 }}>
                {publishedVersion && <>Published v{publishedVersion}! </>}
                {commitHash && <>Commit: <span style={{ fontFamily: 'monospace' }}>{commitHash}</span></>}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onDone} style={primaryBtn}>Done</button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <p style={{ color: c.status.error, fontSize: 13 }}>Push failed</p>
            <div style={{ background: c.bg.primary, border: `1px solid ${c.border.default}`, borderRadius: 4, padding: 10, fontFamily: 'monospace', fontSize: 10, color: c.status.error, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {errorMsg}
            </div>
            {log.length > 0 && (
              <div ref={logRef} style={{ height: 100, overflow: 'auto', background: c.bg.primary, border: `1px solid ${c.border.default}`, borderRadius: 4, padding: 8, fontFamily: 'monospace', fontSize: 10, color: c.text.disabled, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {log.slice(-20).map((line, i) => <div key={i}>{line}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onCancel} style={secondaryBtn}>Close</button>
              <button onClick={retry} style={primaryBtn}>Retry</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 16px',
  borderRadius: 4,
  border: 'none',
  background: '#2680eb',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '6px 16px',
  borderRadius: 4,
  border: '1px solid #444',
  background: 'transparent',
  color: '#999',
  fontSize: 12,
  cursor: 'pointer',
};
