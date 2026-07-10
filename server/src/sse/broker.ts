// SSE broker (plan §9). Tracks connected clients and fans out bus events as
// Server-Sent Events. Quotes are already coalesced per tick by the simulator.
// The DB is the source of truth; SSE is a best-effort notification channel.

import type { FastifyReply } from 'fastify';
import { SSE_HEARTBEAT_MS } from '@finally/shared';
import { bus } from '../bus.js';

interface Client {
  id: number;
  reply: FastifyReply;
}

let nextId = 1;
const clients = new Set<Client>();
let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Serialize an event in SSE wire format. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Write to one client; on any error (e.g. socket torn down mid-tick), drop it. */
function safeWrite(client: Client, payload: string): void {
  try {
    client.reply.raw.write(payload);
  } catch {
    // The socket is gone or erroring — remove the client so a synchronous
    // throw can never unwind out of a bus emit (e.g. the tick loop).
    clients.delete(client);
  }
}

function broadcast(event: string, data: unknown): void {
  const payload = frame(event, data);
  // Snapshot the set: safeWrite may delete during iteration.
  for (const c of [...clients]) {
    safeWrite(c, payload);
  }
}

// Wire the bus → SSE fan-out once at module load.
bus.onTyped('quote', (quotes) => broadcast('quote', quotes));
bus.onTyped('candle', (candle) => broadcast('candle', candle));
bus.onTyped('fill', (fill) => broadcast('fill', fill));
bus.onTyped('portfolio', (portfolio) => broadcast('portfolio', portfolio));

/** Register a new SSE client. Returns a cleanup function for disconnect. */
export function addClient(reply: FastifyReply): () => void {
  const client: Client = { id: nextId++, reply };
  clients.add(client);

  ensureHeartbeat();

  const cleanup = (): void => {
    clients.delete(client);
    if (clients.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  return cleanup;
}

/** Send an initial snapshot to one client (chart/portfolio resync on connect). */
export function sendSnapshot(reply: FastifyReply, snapshot: unknown): void {
  reply.raw.write(frame('snapshot', snapshot));
}

export function clientCount(): number {
  return clients.size;
}

function ensureHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const c of [...clients]) safeWrite(c, ': ping\n\n'); // comment frame
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();
}

/** Close all SSE connections (graceful shutdown). */
export function closeAll(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  for (const c of clients) {
    try {
      c.reply.raw.end();
    } catch {
      // ignore
    }
  }
  clients.clear();
}
