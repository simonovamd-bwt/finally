import { useEffect, useState } from 'react';
import type { HealthResponse } from '@finally/shared';
import { api } from '../lib/api.ts';

export type ConnState = 'connecting' | 'online' | 'offline';

/** Polls /api/health so the Status Bar can show a live connection indicator. */
export function useHealth(intervalMs = 5000): {
  state: ConnState;
  health: HealthResponse | null;
} {
  const [state, setState] = useState<ConnState>('connecting');
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let alive = true;

    const poll = async (): Promise<void> => {
      try {
        const h = await api.health();
        if (!alive) return;
        setHealth(h);
        setState('online');
      } catch {
        if (!alive) return;
        setState('offline');
      }
    };

    void poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { state, health };
}
