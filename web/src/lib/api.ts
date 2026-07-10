// Typed REST client. Shapes come from @finally/shared so the frontend and
// backend can never drift.

import type { HealthResponse, Instrument, Portfolio } from '@finally/shared';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => getJson<HealthResponse>('/api/health'),
  instruments: () => getJson<Instrument[]>('/api/instruments'),
  portfolio: () => getJson<Portfolio>('/api/portfolio'),
};
