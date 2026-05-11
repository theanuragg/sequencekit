#!/usr/bin/env npx tsx
/**
 * compute-discriminators.ts
 *
 * Computes Anchor instruction discriminators for all MicroCLOB instructions
 * and verifies they match the constants hardcoded in:
 *   crates/maker-shield/src/classifier.rs
 *
 * Run: npx tsx scripts/compute-discriminators.ts
 */

import { createHash } from 'crypto';

function discriminator(name: string): string {
  const hash = createHash('sha256')
    .update(`global:${name}`)
    .digest();
  return Array.from(hash.slice(0, 8))
    .map(b => `0x${b.toString(16).padStart(2, '0')}`)
    .join(', ');
}

const instructions = [
  'initialize_market',
  'place_order',
  'cancel_order',
  'update_quote',
  'fill_order',
  'toggle_plugin',
];

console.log('Anchor instruction discriminators for MicroCLOB:');
console.log('─'.repeat(60));

for (const ix of instructions) {
  const disc = discriminator(ix);
  const isMaker = ix === 'cancel_order' || ix === 'update_quote';
  const tag = isMaker ? ' ← MAKER (MakerShield tags MAKER_PRIORITY)' : '';
  console.log(`${ix.padEnd(25)} [${disc}]${tag}`);
}

console.log('─'.repeat(60));
console.log('');
console.log('Verify these match the constants in:');
console.log('  crates/maker-shield/src/classifier.rs');
console.log('');
console.log('CANCEL_ORDER_DISCRIMINATOR should be:');
console.log(`  [${discriminator('cancel_order')}]`);
console.log('UPDATE_QUOTE_DISCRIMINATOR should be:');
console.log(`  [${discriminator('update_quote')}]`);
