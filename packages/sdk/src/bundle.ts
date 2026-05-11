/**
 * bundle.ts — Jito Bundle submission via Block Engine JSON-RPC.
 *
 * Uses the Jito Block Engine JSON-RPC endpoint directly.
 * This avoids the jito-ts gRPC dependency which has a non-trivial setup
 * and brittle import paths. JSON-RPC is the stable, documented interface.
 *
 * Reference: https://docs.jito.wtf/lowlatencytxnsend/
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  BAM_EXPLORER_BASE,
  DEFAULT_COMPUTE_UNIT_PRICE,
  DEFAULT_COMPUTE_UNITS,
  DEFAULT_TIP_LAMPORTS,
  JITO_TIP_ACCOUNTS,
} from './constants.js';
import type { BundleResult, MakerBundleParams, SequenceKitConfig, SpreadInfo } from './types.js';

const BUNDLE_POLL_TIMEOUT_MS = 15_000;
const BUNDLE_POLL_INTERVAL_MS = 400;

// Market account layout offsets for getSpread()
const MARKET_PLUGIN_OFFSET  = 8+32+32+32+8+8;     // plugin_active byte
const MARKET_BEST_BID_OFFSET = 8+32+32+32+8+8+2;  // +paused(1)+plugin(1)
const MARKET_BEST_ASK_OFFSET = MARKET_BEST_BID_OFFSET + 8;
const MARKET_SPREAD_OFFSET   = MARKET_BEST_ASK_OFFSET + 8;

export class BundleClient {
  private readonly connection: Connection;
  private readonly blockEngineUrl: string;
  private readonly marketPk: PublicKey;
  private readonly programId: PublicKey;

  constructor(config: Required<SequenceKitConfig>) {
    this.connection    = config.connection as Connection;
    this.blockEngineUrl = config.jitoBlockEngineUrl;
    // market and programId are stored as strings in internalConfig
    this.marketPk  = new PublicKey(config.market as unknown as string);
    this.programId = new PublicKey(config.programId as unknown as string);
  }

  /**
   * Submit a maker instruction as an atomic Jito Bundle.
   *
   * Builds two transactions:
   *   [0] maker instruction (cancel_order or update_quote)
   *   [1] tip transfer to a Jito tip account
   *
   * Submits via Block Engine JSON-RPC sendBundle.
   * Polls getBundleStatuses until confirmed or timeout.
   */
  async submit(params: MakerBundleParams): Promise<BundleResult> {
    const {
      instruction,
      signer,
      tipLamports    = DEFAULT_TIP_LAMPORTS,
      computeUnits   = DEFAULT_COMPUTE_UNITS,
      computeUnitPrice = DEFAULT_COMPUTE_UNIT_PRICE,
    } = params;

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

    // Transaction 0: maker instruction
    const makerTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
          instruction,
        ],
      }).compileToV0Message(),
    );
    makerTx.sign([signer]);

    // Transaction 1: tip
    const tipAccount = new PublicKey(
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]!
    );
    const tipTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: tipAccount,
            lamports: tipLamports,
          }),
        ],
      }).compileToV0Message(),
    );
    tipTx.sign([signer]);

    // Send bundle
    const bundleId = await this.sendBundle([makerTx, tipTx]);
    console.log('[BundleClient] sent bundleId:', bundleId);

    // Poll for confirmation
    const confirmed = await this.pollConfirmation(bundleId);
    const signature = Buffer.from(makerTx.signatures[0]!).toString('base58');

    let attestationHash: string | undefined;
    let proofUrl: string | undefined;
    if (confirmed?.slot) {
      attestationHash = await this.fetchAttestation(confirmed.slot);
      if (attestationHash) proofUrl = `${BAM_EXPLORER_BASE}/${confirmed.slot}`;
    }

    return { bundleId, signature, slot: confirmed?.slot, attestationHash, proofUrl };
  }

  async setPluginActive(active: boolean, authority: Keypair): Promise<string> {
    // toggle_plugin discriminator: [217,191,148,183,220,117,85,28]
    const data = Buffer.alloc(9);
    Buffer.from([217, 191, 148, 183, 220, 117, 85, 28]).copy(data, 0);
    data.writeUInt8(active ? 1 : 0, 8);

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: authority.publicKey,
        recentBlockhash: blockhash,
        instructions: [{
          programId: this.programId,
          keys: [
            { pubkey: this.marketPk,          isSigner: false, isWritable: true  },
            { pubkey: authority.publicKey,    isSigner: true,  isWritable: false },
          ],
          data,
        }],
      }).compileToV0Message(),
    );
    tx.sign([authority]);

    const sig = await this.connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
    await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  }

  async getSpread(): Promise<SpreadInfo> {
    const info = await this.connection.getAccountInfo(this.marketPk);
    if (!info) throw new Error(`Market account not found: ${this.marketPk.toBase58()}`);

    const buf          = info.data;
    const pluginActive = buf[MARKET_PLUGIN_OFFSET] === 1;
    const bestBid      = Number(buf.readBigUInt64LE(MARKET_BEST_BID_OFFSET));
    const bestAskRaw   = Number(buf.readBigUInt64LE(MARKET_BEST_ASK_OFFSET));
    const bestAsk      = bestAskRaw === 0xFFFFFFFFFFFFFFFF ? 0 : bestAskRaw; // u64::MAX → 0 for display
    const spreadBps    = buf.readUInt16LE(MARKET_SPREAD_OFFSET);
    const slot         = await this.connection.getSlot('confirmed');

    return { bestBid, bestAsk, spreadBps, pluginActive, slot };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async sendBundle(txs: VersionedTransaction[]): Promise<string> {
    const encoded = txs.map(tx => Buffer.from(tx.serialize()).toString('base64'));
    const res = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [encoded] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Block Engine HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json() as { result?: string; error?: { message: string } };
    if (data.error) throw new Error(`Block Engine RPC: ${data.error.message}`);
    if (!data.result) throw new Error('Block Engine returned no bundle ID');
    return data.result;
  }

  private async pollConfirmation(bundleId: string): Promise<{ slot: number } | null> {
    const deadline = Date.now() + BUNDLE_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(BUNDLE_POLL_INTERVAL_MS);
      try {
        const res = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getBundleStatuses', params: [[bundleId]],
          }),
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json() as {
          result?: { value?: Array<{ confirmation_status: string; slot: number }> };
        };
        const status = data.result?.value?.[0];
        if (status?.confirmation_status === 'confirmed' || status?.confirmation_status === 'finalized') {
          console.log('[BundleClient] confirmed in slot:', status.slot);
          return { slot: status.slot };
        }
      } catch { /* retry */ }
    }
    console.warn('[BundleClient] bundle poll timeout');
    return null;
  }

  private async fetchAttestation(slot: number): Promise<string | undefined> {
    try {
      const res = await fetch(`https://api.bam.dev/attestation/${slot}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return undefined;
      const data = await res.json() as { attestation_hash?: string };
      return data.attestation_hash;
    } catch { return undefined; }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
