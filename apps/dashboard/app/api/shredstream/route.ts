/**
 * GET /api/shredstream
 *
 * SSE stream of real latency data to the browser dashboard.
 *
 * When SHREDSTREAM_URL + SHREDSTREAM_TOKEN are set:
 *   Connects to Jito ShredStream WebSocket, records shred arrival
 *   time per slot, compares to RPC getSlot() to measure advantage.
 *
 * When not configured:
 *   Falls back to polling getSlot() on the primary RPC — measures
 *   real round-trip latency per slot. Not ShredStream but still real.
 *
 * Apply for ShredStream: https://forms.gle/BrKgmkHDHRQJFH7g7
 */
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RPC_URL         = process.env.NEXT_PUBLIC_RPC_URL  ?? 'https://api.devnet.solana.com';
const SHREDSTREAM_URL = process.env.SHREDSTREAM_URL      ?? '';
const SHREDSTREAM_TOK = process.env.SHREDSTREAM_TOKEN    ?? '';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* client disconnected */ }
      };

      if (SHREDSTREAM_URL) {
        await runShredStream(SHREDSTREAM_URL, SHREDSTREAM_TOK, send, req.signal);
      } else {
        await runRPCPolling(RPC_URL, send, req.signal);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Real ShredStream path.
 * Connects via WebSocket (shredstream-proxy exposes WS interface).
 * Auth token passed as x-token header.
 */
async function runShredStream(
  url: string, token: string,
  send: (d: object) => void, signal: AbortSignal,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebSocket } = require('ws') as typeof import('ws');

  const headers: Record<string, string> = {};
  if (token) headers['x-token'] = token;

  const ws = new WebSocket(url, { headers });

  // Map slot → ms when we first received the shred
  const shredTimes = new Map<number, number>();

  ws.on('message', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as { slot?: number };
      if (typeof msg.slot !== 'number') return;

      const shredReceivedAtMs = Date.now();
      shredTimes.set(msg.slot, shredReceivedAtMs);

      // Poll RPC until this slot is confirmed — measure the delta
      for (let i = 0; i < 30; i++) {
        await sleep(50);
        const confirmedSlot = await fetchSlot(RPC_URL);
        if (confirmedSlot >= msg.slot) {
          const rpcConfirmedAtMs = Date.now();
          const deltaMs = rpcConfirmedAtMs - shredReceivedAtMs;
          send({ slot: msg.slot, deltaMs: Math.max(0, deltaMs), shredReceivedAtMs, rpcConfirmedAtMs, source: 'shredstream' });
          shredTimes.delete(msg.slot);
          break;
        }
      }
    } catch { /* ignore malformed */ }
  });

  ws.on('error', (err: Error) => {
    console.error('[ShredStream] error:', err.message);
  });

  await new Promise<void>((_, reject) => {
    signal.addEventListener('abort', () => { ws.close(); reject(new Error('aborted')); });
  });
}

/**
 * RPC polling fallback — real round-trip latency per slot.
 * No ShredStream needed. Each event is a genuine measurement.
 */
async function runRPCPolling(
  rpcUrl: string, send: (d: object) => void, signal: AbortSignal,
): Promise<void> {
  let lastSlot = 0;

  while (!signal.aborted) {
    const start = Date.now();
    try {
      const slot = await fetchSlot(rpcUrl);
      const rpcConfirmedAtMs = Date.now();
      const deltaMs = rpcConfirmedAtMs - start; // true round-trip time

      if (slot > lastSlot) {
        lastSlot = slot;
        send({ slot, deltaMs, shredReceivedAtMs: start, rpcConfirmedAtMs, source: 'rpc' });
      }
    } catch (e) {
      console.debug('[ShredStream SSE] poll error:', e);
    }
    await sleep(400); // ~1 Solana slot
  }
}

async function fetchSlot(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] }),
    signal: AbortSignal.timeout(3000),
  });
  const data = await res.json() as { result: number };
  return data.result;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
