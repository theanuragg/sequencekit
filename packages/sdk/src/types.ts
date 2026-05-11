import type { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SequenceKitConfig {
  /** Solana RPC connection (devnet or mainnet-beta) */
  connection: Connection;

  /**
   * Jito Block Engine URL.
   * Choose the region closest to your users:
   *   Amsterdam: https://amsterdam.mainnet.block-engine.jito.wtf
   *   Frankfurt: https://frankfurt.mainnet.block-engine.jito.wtf
   *   New York:  https://ny.mainnet.block-engine.jito.wtf
   *   Tokyo:     https://tokyo.mainnet.block-engine.jito.wtf
   *   Salt Lake: https://slc.mainnet.block-engine.jito.wtf
   */
  jitoBlockEngineUrl: string;

  /** ShredStream WebSocket URL (optional — required for LatencyFeed dashboard panel) */
  shredstreamUrl?: string;

  /** MicroCLOB market address to interact with */
  market: PublicKey | string;

  /** MicroCLOB program ID. Defaults to deployed devnet address. */
  programId?: PublicKey | string;

  /** Jito Stake Pool API base URL. Defaults to kobe.mainnet.jito.network */
  stakePoolApiUrl?: string;
}

// ─── Bundle ───────────────────────────────────────────────────────────────────

export interface MakerBundleParams {
  /** The maker instruction (cancel_order or update_quote) to protect */
  instruction: TransactionInstruction;

  /** Signer keypair for the maker instruction */
  signer: Keypair;

  /**
   * Lamports to tip Jito validators.
   * Higher tip = higher bundle priority in Block Engine auction.
   * Minimum: 1_000. Recommended: 10_000–100_000 during volatile markets.
   * Default: 10_000 (~$0.001 at current SOL price)
   */
  tipLamports?: number;

  /** Compute unit limit for the maker instruction tx. Default: 200_000 */
  computeUnits?: number;

  /** Compute unit price in microlamports (priority fee). Default: 1 */
  computeUnitPrice?: number;
}

export interface BundleResult {
  /** Jito bundle UUID — use to poll bundle status via Block Engine API */
  bundleId: string;

  /** On-chain transaction signature for the maker instruction */
  signature: string;

  /** Slot the bundle was included in (after confirmation) */
  slot?: number;

  /**
   * TEE attestation hash from MakerShield plugin.
   * Available ~400ms after slot confirmation via BAM Explorer.
   * sha256 of (slot || tx_signatures in order), signed by AMD SEV-SNP key.
   */
  attestationHash?: string;

  /** Direct link to BAM Explorer for this slot's attestation */
  proofUrl?: string;
}

// ─── Latency ──────────────────────────────────────────────────────────────────

export interface LatencyEvent {
  /** Solana slot number */
  slot: number;

  /** Unix ms timestamp when ShredStream received the first shred for this slot */
  shredReceivedAtMs: number;

  /** Unix ms timestamp when the public RPC confirmed this slot */
  rpcConfirmedAtMs: number;

  /**
   * Our latency advantage in milliseconds.
   * Positive = we saw the block before the public RPC.
   * Typical range: 10–50ms depending on region.
   */
  deltaMs: number;
}

// ─── MEV Stats ────────────────────────────────────────────────────────────────

export interface MEVStats {
  /** Total SOL tips collected in the current epoch via Tip Router */
  tipsCollectedSOL: number;

  /** Tip Router program address */
  tipRouterAddress: string;

  /** Current JitoSOL APY in percent (e.g. 8.3 = 8.3%) */
  jitoSOLAPY: number;

  /** JitoSOL total value locked in SOL */
  jitoSOLTVL: number;

  /** Estimated staker share of this session's tips in SOL */
  stakerShareSOL: number;

  /** Current Solana epoch number */
  epoch: number;

  /** JitoSOL/SOL exchange ratio (always >= 1.0, grows with MEV rewards) */
  jitoSOLRatio: number;
}

// ─── Spread ───────────────────────────────────────────────────────────────────

export interface SpreadInfo {
  /** Current best bid price in lots */
  bestBid: number;

  /** Current best ask price in lots (u64::MAX if empty) */
  bestAsk: number;

  /** Spread in basis points (0 if one side is empty) */
  spreadBps: number;

  /** Whether MakerShield plugin is active for this market */
  pluginActive: boolean;

  /** Slot when this info was last updated */
  slot: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface SpreadChangedEvent {
  market: string;
  oldSpreadBps: number;
  newSpreadBps: number;
  slot: number;
  pluginActive: boolean;
}

export interface OrderFilledEvent {
  market: string;
  makerOrderId: string;
  maker: string;
  taker: string;
  priceLots: string;
  fillSizeLots: string;
  timestamp: number;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

/** Call to unsubscribe from a real-time feed */
export type Unsubscribe = () => void;
