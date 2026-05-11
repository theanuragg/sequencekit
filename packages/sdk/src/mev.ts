/**
 * mev.ts — Jito Stake Pool API statistics.
 * Fetches real data. Returns 0 values when APIs are unavailable — no fake numbers.
 * Cached for 5 minutes.
 */
import { DEFAULT_STAKE_POOL_API } from './constants.js';
import type { MEVStats, SequenceKitConfig } from './types.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: MEVStats;
  fetchedAt: number;
}

export class MEVClient {
  private cache: CacheEntry | null = null;
  private readonly stakePoolApiUrl: string;

  constructor(config: Required<SequenceKitConfig>) {
    // stakePoolApiUrl is stored as a plain string in internalConfig
    // Access via bracket notation since TypeScript types it as PublicKey
    this.stakePoolApiUrl =
      (config as unknown as Record<string, unknown>)['stakePoolApiUrl'] as string
      ?? DEFAULT_STAKE_POOL_API;
  }

  async getStats(): Promise<MEVStats> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.data;
    }

    const [apyResult, mevResult] = await Promise.allSettled([
      this.fetchJSON<APYResponse>(`${this.stakePoolApiUrl}/api/v1/apy`),
      this.fetchJSON<MEVRewardsResponse>(`${this.stakePoolApiUrl}/api/v1/mev_rewards`),
    ]);

    const apy = apyResult.status === 'fulfilled' ? apyResult.value : null;
    const mev = mevResult.status === 'fulfilled' ? mevResult.value : null;

    if (!apy) console.warn('[MEVClient] APY API unavailable');
    if (!mev) console.warn('[MEVClient] MEV rewards API unavailable');

    const stats: MEVStats = {
      jitoSOLAPY:       apy?.apy           ?? 0,
      jitoSOLTVL:       apy?.tvl_sol       ?? 0,
      jitoSOLRatio:     apy?.exchange_rate ?? 1.0,
      tipsCollectedSOL: mev?.total_rewards_sol  ?? 0,
      stakerShareSOL:   mev?.staker_rewards_sol ?? 0,
      epoch:            mev?.epoch ?? 0,
      tipRouterAddress: 'T1pRo1iZarGMCnZ6oMFEGriLKaPHQN1hBFZKmeiLzBUN',
    };

    this.cache = { data: stats, fetchedAt: Date.now() };
    return stats;
  }

  private async fetchJSON<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json() as Promise<T>;
  }
}

interface APYResponse {
  apy: number;
  tvl_sol: number;
  exchange_rate: number;
  epoch?: number;
}

interface MEVRewardsResponse {
  total_rewards_sol: number;
  staker_rewards_sol: number;
  epoch: number;
}
