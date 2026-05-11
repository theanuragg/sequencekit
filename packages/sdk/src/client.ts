import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import { BundleClient } from './bundle.js';
import {
  DEFAULT_STAKE_POOL_API,
  MICRO_CLOB_PROGRAM_ID,
} from './constants.js';
import { LatencyClient } from './latency.js';
import { MEVClient } from './mev.js';
import type {
  BundleResult,
  LatencyEvent,
  MakerBundleParams,
  MEVStats,
  SequenceKitConfig,
  SpreadInfo,
  Unsubscribe,
} from './types.js';

/**
 * SequenceKit — main client.
 *
 * @example
 * ```typescript
 * const sk = new SequenceKit({
 *   connection: new Connection('https://api.devnet.solana.com'),
 *   jitoBlockEngineUrl: 'https://amsterdam.mainnet.block-engine.jito.wtf',
 *   market: new PublicKey('YOUR_MARKET_PDA'),
 * });
 *
 * const result = await sk.submitMakerBundle({
 *   instruction: cancelOrderIx,
 *   signer: makerKeypair,
 *   tipLamports: 10_000,
 * });
 * console.log('TEE proof:', result.proofUrl);
 * ```
 */
export class SequenceKit {
  private readonly internalConfig: Required<SequenceKitConfig>;
  private readonly bundleClient: BundleClient;
  private readonly latencyClient: LatencyClient;
  private readonly mevClient: MEVClient;

  constructor(config: SequenceKitConfig) {
    const marketStr = typeof config.market === 'string'
      ? config.market
      : (config.market as PublicKey).toBase58();

    const programIdStr = config.programId == null
      ? MICRO_CLOB_PROGRAM_ID
      : typeof config.programId === 'string'
        ? config.programId
        : (config.programId as PublicKey).toBase58();

    // Store everything as a concrete Required<SequenceKitConfig>
    // Non-PublicKey string fields are cast to unknown to satisfy the type
    this.internalConfig = {
      connection:         config.connection,
      jitoBlockEngineUrl: config.jitoBlockEngineUrl,
      shredstreamUrl:     config.shredstreamUrl ?? '',
      market:             marketStr as unknown as PublicKey,
      programId:          programIdStr as unknown as PublicKey,
      stakePoolApiUrl:    (config.stakePoolApiUrl ?? DEFAULT_STAKE_POOL_API) as unknown as PublicKey,
    } as Required<SequenceKitConfig>;

    this.bundleClient  = new BundleClient(this.internalConfig);
    this.latencyClient = new LatencyClient(this.internalConfig);
    this.mevClient     = new MEVClient(this.internalConfig);
  }

  /** Submit a maker instruction as an atomic Jito Bundle. */
  async submitMakerBundle(params: MakerBundleParams): Promise<BundleResult> {
    return this.bundleClient.submit(params);
  }

  /** Toggle plugin_active on the Market account. */
  async setPluginActive(active: boolean, authority: Keypair): Promise<string> {
    return this.bundleClient.setPluginActive(active, authority);
  }

  /** Subscribe to real-time latency events. */
  subscribeLatency(callback: (event: LatencyEvent) => void): Unsubscribe {
    return this.latencyClient.subscribe(callback);
  }

  /** Fetch MEV stats from Jito Stake Pool API. */
  async getMEVStats(): Promise<MEVStats> {
    return this.mevClient.getStats();
  }

  /** Read current spread from on-chain Market account. */
  async getSpread(): Promise<SpreadInfo> {
    return this.bundleClient.getSpread();
  }
}
