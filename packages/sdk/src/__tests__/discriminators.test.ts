/**
 * discriminators.test.ts
 *
 * Verifies that the discriminator constants in constants.ts match the real
 * sha256("global:<name>")[0..8] values that Anchor generates.
 *
 * This test MUST pass — if it fails, the MakerShield plugin will misclassify
 * cancel_order and update_quote instructions, breaking the core guarantee.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { DISCRIMINATORS } from '../constants.js';

function anchorDiscriminator(instructionName: string): number[] {
  const hash = createHash('sha256')
    .update(`global:${instructionName}`)
    .digest();
  return Array.from(hash.slice(0, 8));
}

describe('Anchor instruction discriminators', () => {
  it('cancel_order discriminator matches sha256', () => {
    expect(DISCRIMINATORS.cancel_order).toEqual(anchorDiscriminator('cancel_order'));
  });

  it('update_quote discriminator matches sha256', () => {
    expect(DISCRIMINATORS.update_quote).toEqual(anchorDiscriminator('update_quote'));
  });

  it('fill_order discriminator matches sha256', () => {
    expect(DISCRIMINATORS.fill_order).toEqual(anchorDiscriminator('fill_order'));
  });

  it('place_order discriminator matches sha256', () => {
    expect(DISCRIMINATORS.place_order).toEqual(anchorDiscriminator('place_order'));
  });

  it('Rust classifier constants match TypeScript constants', () => {
    // These are the values in crates/maker-shield/src/classifier.rs
    // If this test fails, update BOTH files to match the sha256 output
    const rustCancelOrder  = [95, 129, 237, 240, 8, 49, 223, 132];
    const rustUpdateQuote  = [235, 69, 162, 233, 147, 53, 42, 225];

    expect(DISCRIMINATORS.cancel_order).toEqual(rustCancelOrder);
    expect(DISCRIMINATORS.update_quote).toEqual(rustUpdateQuote);
  });
});
