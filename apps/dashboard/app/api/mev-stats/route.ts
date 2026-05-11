/**
 * GET /api/mev-stats
 *
 * Fetches REAL MEV statistics from Jito Stake Pool API.
 * No hardcoded fallbacks — returns error state if APIs are unavailable.
 *
 * Sources:
 *   kobe.mainnet.jito.network/api/v1/apy         → JitoSOL APY, TVL, ratio
 *   kobe.mainnet.jito.network/api/v1/mev_rewards → epoch tips, staker share
 */

import { NextRequest } from 'next/server';

export const runtime  = 'nodejs';
export const revalidate = 60; // cache for 60s

const STAKE_POOL_API = process.env.STAKE_POOL_API ?? 'https://kobe.mainnet.jito.network';

interface APYResponse {
  apy:           number;
  tvl_sol:       number;
  exchange_rate: number;
  epoch:         number;
}

interface MEVRewardsResponse {
  total_rewards_sol:  number;
  staker_rewards_sol: number;
  epoch:              number;
  validator_rewards_sol?: number;
}

export async function GET(_req: NextRequest) {
  const [apyResult, mevResult] = await Promise.allSettled([
    fetch(`${STAKE_POOL_API}/api/v1/apy`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 60 },
    }).then(r => {
      if (!r.ok) throw new Error(`APY API ${r.status}`);
      return r.json() as Promise<APYResponse>;
    }),

    fetch(`${STAKE_POOL_API}/api/v1/mev_rewards`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 60 },
    }).then(r => {
      if (!r.ok) throw new Error(`MEV rewards API ${r.status}`);
      return r.json() as Promise<MEVRewardsResponse>;
    }),
  ]);

  const apyOk = apyResult.status === 'fulfilled';
  const mevOk = mevResult.status === 'fulfilled';

  if (!apyOk) {
    console.error('[mev-stats] APY API failed:', (apyResult as PromiseRejectedResult).reason);
  }
  if (!mevOk) {
    console.error('[mev-stats] MEV rewards API failed:', (mevResult as PromiseRejectedResult).reason);
  }

  const apy = apyOk ? (apyResult as PromiseFulfilledResult<APYResponse>).value : null;
  const mev = mevOk ? (mevResult as PromiseFulfilledResult<MEVRewardsResponse>).value : null;

  return Response.json({
    // Real values or null — dashboard shows "N/A" when null
    jitoSOLAPY:       apy?.apy           ?? null,
    jitoSOLTVL:       apy?.tvl_sol       ?? null,
    jitoSOLRatio:     apy?.exchange_rate ?? null,
    tipsCollectedSOL: mev?.total_rewards_sol  ?? null,
    stakerShareSOL:   mev?.staker_rewards_sol ?? null,
    epoch:            mev?.epoch ?? apy?.epoch ?? null,
    tipRouterAddress: 'T1pRo1iZarGMCnZ6oMFEGriLKaPHQN1hBFZKmeiLzBUN',
    // Tell the client which sources succeeded
    sources: { apy: apyOk, mevRewards: mevOk },
  });
}
