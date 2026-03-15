import { useEffect, useRef } from 'react';
import { getCSInterface } from '../bridge/cs-interface.js';

interface UseBoostKeyOptions {
  active: boolean;
  onBoost: () => void;
}

// B key (keyCode 66)
const BOOST_KEYS = [{ keyCode: 66 }];

export function useBoostKey({ active, onBoost }: UseBoostKeyOptions) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Register key interest with Premiere
  useEffect(() => {
    const csi = getCSInterface();
    if (!csi) return;

    if (active) {
      csi.registerKeyEventsInterest(JSON.stringify(BOOST_KEYS));
    } else {
      csi.registerKeyEventsInterest('[]');
    }
    return () => {
      try { csi.registerKeyEventsInterest('[]'); } catch {}
    };
  }, [active]);

  // Auto-focus the hidden input to capture keys
  useEffect(() => {
    if (!active || !inputRef.current) return;

    inputRef.current.focus();

    const interval = setInterval(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    }, 200);

    return () => clearInterval(interval);
  }, [active]);

  // Handle keydown on the input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      onBoost();
    }
    // Clear any typed text
    if (inputRef.current) inputRef.current.value = '';
  };

  return { inputRef, handleKeyDown };
}
