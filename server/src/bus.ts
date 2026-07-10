// In-process event bus (plan §2). The simulator, trading engine, and SSE broker
// communicate through this single EventEmitter — no Redis, no queue. Typed so
// emitters and listeners share one contract.

import { EventEmitter } from 'node:events';
import type { Candle, Fill, Portfolio, Quote } from '@finally/shared';

export interface BusEvents {
  quote: (quotes: Quote[]) => void;
  candle: (candle: Candle) => void;
  fill: (fill: Fill) => void;
  portfolio: (portfolio: Portfolio) => void;
}

class TypedBus extends EventEmitter {
  emitTyped<K extends keyof BusEvents>(
    event: K,
    ...args: Parameters<BusEvents[K]>
  ): boolean {
    return this.emit(event, ...args);
  }

  onTyped<K extends keyof BusEvents>(event: K, listener: BusEvents[K]): this {
    return this.on(event, listener as (...args: unknown[]) => void);
  }

  offTyped<K extends keyof BusEvents>(event: K, listener: BusEvents[K]): this {
    return this.off(event, listener as (...args: unknown[]) => void);
  }
}

/** The shared bus for the process. */
export const bus = new TypedBus();
// SSE clients + engine listeners can exceed the default cap of 10.
bus.setMaxListeners(100);
