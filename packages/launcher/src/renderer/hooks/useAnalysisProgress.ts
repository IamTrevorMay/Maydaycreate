import { useState, useEffect } from 'react';
import { useIpc } from './useIpc.js';
import type { AnalysisProgress } from '@mayday/types';

export function useAnalysisProgress(): AnalysisProgress | null {
  const ipc = useIpc();
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  useEffect(() => {
    const unsub = ipc.youtube.onProgress((p: AnalysisProgress) => {
      setProgress(p);
      if (p.status === 'complete' || p.status === 'error' || p.status === 'cancelled') {
        // Clear after a short delay so the user sees the final state
        setTimeout(() => setProgress(null), 3000);
      }
    });
    return unsub;
  }, [ipc]);

  return progress;
}
