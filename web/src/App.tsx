import { useEffect, useState } from 'react';
import type { Instrument, Portfolio } from '@finally/shared';
import { api } from './lib/api.ts';
import { useHealth } from './hooks/useHealth.ts';
import { StatusBar } from './components/StatusBar.tsx';

function Panel({
  title,
  children,
  className = '',
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`panel flex flex-col overflow-hidden ${className}`}>
      <div className="panel-header flex items-center justify-between">
        <span>{title}</span>
      </div>
      <div className="flex-1 overflow-auto p-3 text-sm">{children}</div>
    </section>
  );
}

function ComingSoon({ label }: { label: string }): JSX.Element {
  return (
    <div className="h-full grid place-items-center text-term-muted/60 text-xs uppercase tracking-widest">
      {label}
    </div>
  );
}

export function App(): JSX.Element {
  const { state, health } = useHealth();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.instruments(), api.portfolio()])
      .then(([inst, pf]) => {
        setInstruments(inst);
        setPortfolio(pf);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Masthead */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-term-border bg-term-panel">
        <div className="flex items-baseline gap-3">
          <h1 className="text-term-accent font-semibold tracking-widest text-sm">
            FINALLY
          </h1>
          <span className="text-term-muted text-[11px] tracking-wider">
            FINANCE ALLY · TRADING WORKSTATION
          </span>
        </div>
        <div className="text-[11px] text-term-muted tabular-nums">
          {portfolio ? (
            <>
              EQUITY{' '}
              <span className="text-term-text">
                ${portfolio.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>{' '}
              · CASH{' '}
              <span className="text-term-text">
                ${portfolio.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </>
          ) : (
            <span className="text-term-muted/60">loading…</span>
          )}
        </div>
      </header>

      {/* Terminal grid */}
      <main className="flex-1 grid grid-cols-12 grid-rows-6 gap-2 p-2 min-h-0">
        <Panel title="Watchlist" className="col-span-3 row-span-6">
          {error ? (
            <div className="text-term-down text-xs">{error}</div>
          ) : instruments.length === 0 ? (
            <ComingSoon label="loading instruments" />
          ) : (
            <ul className="space-y-1">
              {instruments.map((i) => (
                <li
                  key={i.symbol}
                  className="flex items-center justify-between px-1 py-1 border-b border-term-border/40"
                >
                  <span className="text-term-text">{i.symbol}</span>
                  <span className="text-term-muted tabular-nums">
                    {i.startPrice.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Chart" className="col-span-6 row-span-4">
          <ComingSoon label="price chart · M2" />
        </Panel>

        <Panel title="Order Ticket" className="col-span-3 row-span-3">
          <ComingSoon label="order ticket · M2" />
        </Panel>

        <Panel title="Positions" className="col-span-3 row-span-3">
          {portfolio && portfolio.positions.length === 0 ? (
            <div className="text-term-muted/60 text-xs">No open positions.</div>
          ) : (
            <ComingSoon label="positions · M2" />
          )}
        </Panel>

        <Panel title="Blotter" className="col-span-6 row-span-2">
          <ComingSoon label="order &amp; fill history · M2" />
        </Panel>

        <Panel title="AI Co-Pilot" className="col-span-3 row-span-3">
          <ComingSoon label="ai co-pilot · M3" />
        </Panel>
      </main>

      <StatusBar state={state} health={health} />
    </div>
  );
}
