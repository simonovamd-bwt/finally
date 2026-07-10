import type { HealthResponse } from '@finally/shared';
import type { ConnState } from '../hooks/useHealth.ts';
import { useClock } from '../hooks/useClock.ts';

const DOT: Record<ConnState, string> = {
  connecting: 'bg-term-accent',
  online: 'bg-term-live animate-pulse',
  offline: 'bg-term-down',
};

const LABEL: Record<ConnState, string> = {
  connecting: 'CONNECTING',
  online: 'LIVE',
  offline: 'OFFLINE',
};

export function StatusBar({
  state,
  health,
}: {
  state: ConnState;
  health: HealthResponse | null;
}): JSX.Element {
  const clock = useClock();
  return (
    <footer className="flex items-center justify-between px-3 py-1.5 text-[11px] text-term-muted border-t border-term-border bg-term-panel">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${DOT[state]}`} />
        <span className="tracking-wider">{LABEL[state]}</span>
        {health && (
          <span className="text-term-muted/70">
            · v{health.version} · up {Math.floor(health.uptimeMs / 1000)}s
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span>SIMULATED · NO REAL MONEY</span>
        <span className="tabular-nums text-term-text">{clock}</span>
      </div>
    </footer>
  );
}
