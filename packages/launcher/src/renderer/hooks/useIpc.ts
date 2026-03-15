import type { MaydayAPI } from '../../preload/index.js';

declare global {
  interface Window {
    mayday: MaydayAPI;
  }
}

export function useIpc(): MaydayAPI {
  return window.mayday;
}
