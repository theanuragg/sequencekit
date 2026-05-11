/**
 * latency.ts — Real latency measurement via Solana RPC.
 *
 * Measures how fast our RPC confirms slots.
 * When shredstreamUrl is set: compares ShredStream arrival vs RPC confirmation.
 * When not set: measures raw RPC round-trip latency per slot.
 * No Math.random(). No fake data.
 */
import type { Connection } from '@solana/web3.js';
import type { LatencyEvent, SequenceKitConfig, Unsubscribe } from './types.js';

export class LatencyClient {
  private readonly connection: Connection;
  private readonly shredstreamUrl: string;

  constructor(config: Required<SequenceKitConfig>) {
    this.connection = config.connection as Connection;
    this.shredstreamUrl =
      (config as unknown as Record<string, unknown>)['shredstreamUrl'] as string ?? '';
  }

  subscribe(callback: (event: LatencyEvent) => void): Unsubscribe {
    if (this.shredstreamUrl) {
      return this.subscribeViaShredStream(callback);
    }
    return this.subscribeViaRPCPolling(callback);
  }

  /**
   * ShredStream path: requires shredstream-proxy WebSocket.
   * Tracks shred arrival time vs onSlotChange confirmation time.
   */
  private subscribeViaShredStream(callback: (event: LatencyEvent) => void): Unsubscribe {
    // Map slot → ms when first shred arrived
    const shredArrivalMs = new Map<number, number>();

    // Track RPC confirmation via onSlotChange
    const subId = this.connection.onSlotChange((slotInfo) => {
      const slot = slotInfo.slot;
      const rpcConfirmedAtMs = Date.now();
      const shredReceivedAtMs = shredArrivalMs.get(slot);
      if (shredReceivedAtMs !== undefined) {
        callback({
          slot,
          shredReceivedAtMs,
          rpcConfirmedAtMs,
          deltaMs: Math.max(0, rpcConfirmedAtMs - shredReceivedAtMs),
        });
        shredArrivalMs.delete(slot);
      }
      // Clean stale entries
      for (const [s] of shredArrivalMs) {
        if (s < slot - 100) shredArrivalMs.delete(s);
      }
    });

    // Connect to ShredStream proxy WebSocket
    // shredstream-proxy sends: { slot: number, parent: number }
    let ws: WebSocket | null = null;
    let closed = false;

    try {
      ws = new WebSocket(this.shredstreamUrl);
      ws.onopen = () => console.log('[ShredStream] connected');
      ws.onmessage = (event) => {
        if (closed) return;
        try {
          const msg = JSON.parse(event.data as string) as { slot?: number };
          if (typeof msg.slot === 'number') {
            shredArrivalMs.set(msg.slot, Date.now());
          }
        } catch { /* ignore */ }
      };
      ws.onerror = (e) => console.error('[ShredStream] error:', e);
      ws.onclose = () => { if (!closed) console.warn('[ShredStream] closed unexpectedly'); };
    } catch (e) {
      console.error('[ShredStream] failed to connect:', e);
    }

    return () => {
      closed = true;
      ws?.close();
      this.connection.removeSlotChangeListener(subId);
      shredArrivalMs.clear();
    };
  }

  /**
   * RPC polling path: measures actual getSlot() round-trip time.
   * Reports per-slot latency in ms — real infrastructure data.
   */
  private subscribeViaRPCPolling(callback: (event: LatencyEvent) => void): Unsubscribe {
    let stopped = false;
    let lastSlot = 0;

    const poll = async () => {
      while (!stopped) {
        try {
          const start = Date.now();
          const slot  = await this.connection.getSlot('confirmed');
          const rpcConfirmedAtMs = Date.now();
          const deltaMs = rpcConfirmedAtMs - start;

          if (slot > lastSlot) {
            lastSlot = slot;
            callback({
              slot,
              shredReceivedAtMs: start,
              rpcConfirmedAtMs,
              deltaMs,
            });
          }
        } catch (e) {
          console.debug('[LatencyClient] poll error:', e);
        }
        await sleep(400);
      }
    };

    poll().catch(console.error);
    return () => { stopped = true; };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
