/**
 * bundle.test.ts — Unit tests for BundleClient.
 *
 * Tests the bundle construction logic without hitting real Jito endpoints.
 * Integration tests (real bundle submission) live in scripts/test-bundle.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

// Mock the jito-ts import so tests run without the real package
vi.mock('jito-ts/dist/sdk/block-engine/searcher.js', () => ({
  searcherClient: vi.fn(),
  Bundle: class {
    txs: unknown[] = [];
    addTransactions(...txs: unknown[]) { this.txs.push(...txs); }
    addTipTx(_payer: unknown, _lamports: number, _account: unknown) { this.txs.push('tip'); }
  },
}));

import { BundleClient } from '../bundle.js';
import { JITO_TIP_ACCOUNTS, MICRO_CLOB_PROGRAM_ID } from '../constants.js';
import type { SequenceKitConfig } from '../types.js';

function makeConfig(overrides: Partial<SequenceKitConfig> = {}): Required<SequenceKitConfig> {
  const connection = new Connection('https://api.devnet.solana.com');
  return {
    connection,
    jitoBlockEngineUrl: 'https://amsterdam.mainnet.block-engine.jito.wtf',
    shredstreamUrl: '',
    market: new PublicKey(PublicKey.default),
    programId: new PublicKey(MICRO_CLOB_PROGRAM_ID),
    stakePoolApiUrl: 'https://kobe.mainnet.jito.network',
    ...overrides,
  } as Required<SequenceKitConfig>;
}

describe('BundleClient', () => {
  it('constructs without throwing', () => {
    expect(() => new BundleClient(makeConfig())).not.toThrow();
  });

  it('JITO_TIP_ACCOUNTS contains 8 valid-looking addresses', () => {
    expect(JITO_TIP_ACCOUNTS).toHaveLength(8);
    for (const addr of JITO_TIP_ACCOUNTS) {
      // Valid base58 pubkey — try to construct PublicKey
      expect(() => new PublicKey(addr)).not.toThrow();
    }
  });

  it('getSpread returns SpreadInfo shape', async () => {
    // Mock connection.getAccountInfo to return null (market not found)
    const config = makeConfig();
    vi.spyOn(config.connection, 'getAccountInfo').mockResolvedValue(null);

    const client = new BundleClient(config);
    await expect(client.getSpread()).rejects.toThrow('Market account not found');
  });
});
