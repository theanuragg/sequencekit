#!/usr/bin/env npx tsx
/**
 * scripts/apply-shredstream.ts
 *
 * Guides you through applying for Jito ShredStream access and
 * tests the connection once you have credentials.
 *
 * ShredStream delivers raw Solana block shreds before they are
 * assembled into full blocks — giving you block data 10-50ms
 * earlier than the public RPC.
 *
 * Application: https://forms.gle/BrKgmkHDHRQJFH7g7
 *
 * Once approved you receive:
 *   - A ShredStream gRPC endpoint URL
 *   - An auth token (passed as x-token header)
 *
 * Usage:
 *   SHREDSTREAM_URL=<your-endpoint> npx tsx scripts/apply-shredstream.ts
 */

import { WebSocket } from 'ws';

const SHREDSTREAM_URL = process.env.SHREDSTREAM_URL;
const AUTH_TOKEN      = process.env.SHREDSTREAM_TOKEN;

if (!SHREDSTREAM_URL) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              ShredStream Access Application               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('ShredStream is Jito\'s low-latency block data feed.');
  console.log('It delivers block shreds 10-50ms before public RPC confirmation.\n');
  console.log('To apply for access:');
  console.log('  1. Go to: https://forms.gle/BrKgmkHDHRQJFH7g7');
  console.log('  2. Fill in your project details (mention SequenceKit / Jito Hackathon)');
  console.log('  3. Jito will provide a WebSocket endpoint and auth token\n');
  console.log('Once you have credentials:');
  console.log('  Add to apps/dashboard/.env.local:');
  console.log('    SHREDSTREAM_URL=wss://your-endpoint.jito.wtf/shredstream');
  console.log('    SHREDSTREAM_TOKEN=your-auth-token\n');
  console.log('  Then test:');
  console.log('    SHREDSTREAM_URL=wss://... SHREDSTREAM_TOKEN=... npx tsx scripts/apply-shredstream.ts\n');
  process.exit(0);
}

// ── Test the ShredStream connection ─────────────────────────────────────────

console.log(`\nConnecting to ShredStream: ${SHREDSTREAM_URL}\n`);

const headers: Record<string, string> = {};
if (AUTH_TOKEN) headers['x-token'] = AUTH_TOKEN;

const ws = new WebSocket(SHREDSTREAM_URL, { headers });

let slotCount = 0;
const startMs = Date.now();

ws.on('open', () => {
  console.log('✅ Connected to ShredStream\n');
  console.log('Receiving slot data (Ctrl+C to stop):\n');
  console.log('Slot          | Received At   | Latency');
  console.log('─────────────────────────────────────────');
});

ws.on('message', (data: Buffer | string) => {
  try {
    const msg = JSON.parse(data.toString()) as { slot?: number; parent?: number };
    if (typeof msg.slot === 'number') {
      const now = Date.now();
      slotCount++;
      // This timestamp is when WE received the shred
      // The RPC will confirm this slot ~10-50ms later
      process.stdout.write(
        `${msg.slot.toLocaleString().padStart(14)} | ${new Date(now).toISOString().slice(11, 23)} | ~${slotCount * 400 > now - startMs ? 'measuring...' : 'real data'}\n`
      );
    }
  } catch { /* binary shred data — not JSON */ }
});

ws.on('error', (err: Error) => {
  console.error('❌ WebSocket error:', err.message);
  if (err.message.includes('401') || err.message.includes('403')) {
    console.error('\nAuthentication failed. Check your SHREDSTREAM_TOKEN.');
  }
  process.exit(1);
});

ws.on('close', (code: number, reason: Buffer) => {
  console.log(`\nConnection closed: ${code} ${reason.toString()}`);
  console.log(`Received ${slotCount} slots in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
});
