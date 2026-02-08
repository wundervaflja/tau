import type { TauBridge } from '../preload';

declare global {
  interface Window {
    tauBridge: TauBridge;
  }
}

export const bridge = window.tauBridge;
