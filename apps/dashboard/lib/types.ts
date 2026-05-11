// ─── On-chain data types ──────────────────────────────────────────────────────

export interface OrderLevel {
  orderId: number;
  owner: string;
  priceLots: number;
  sizeLots: number;
  filledLots: number;
  side: 'bid' | 'ask';
  priceUSDC: number;   // price_lots * tick_size / 1e6
  sizeSOL: number;     // (size_lots - filled_lots) * lot_size / 1e9
  isOwn: boolean;
}

export interface Trade {
  slot: number;
  timestamp: number;
  priceLots: number;
  priceUSDC: number;
  sizeSOL: number;
  side: 'buy' | 'sell';  // taker side
  makerOrderId: number;
}

export interface Candle {
  time: number;   // unix seconds (used by lightweight-charts)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBook {
  bids: OrderLevel[];
  asks: OrderLevel[];
  midPrice: number;
  spreadBps: number;
  pluginActive: boolean;
  slot: number;
}

// ─── Attestation / plugin ─────────────────────────────────────────────────────

export interface AttestationRow {
  slot: number;
  makerCount: number;
  takerCount: number;
  attestationHash: string;
  teeVerified: boolean;
  proofUrl: string;
  timestamp: number;
}

// ─── Latency / MEV ────────────────────────────────────────────────────────────

export interface LatencyPoint {
  slot: number;
  deltaMs: number;
}

export interface MEVDisplay {
  tipsSol:        number | null;
  jitosolApy:     number | null;
  jitosolTvl:     number | null;
  stakerShareSol: number | null;
  epoch:          number | null;
  jitosolRatio:   number | null;
}

// ─── Wallet / session ─────────────────────────────────────────────────────────

export interface OpenOrder {
  orderId: number;
  side: 'bid' | 'ask';
  priceLots: number;
  sizeLots: number;
  filledLots: number;
  priceUSDC: number;
  sizeSOL: number;
  createdAt: number;
}

// ─── Market config (from on-chain Market account) ────────────────────────────

export interface MarketConfig {
  address: string;
  baseMint: string;
  quoteMint: string;
  tickSize: number;   // in quote native units
  lotSize: number;    // in base native units
  pluginActive: boolean;
  paused: boolean;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  nextOrderId: number;
}

// ─── SpreadDataPoint for spread monitor ──────────────────────────────────────

export interface SpreadDataPoint {
  slot: number;
  bps: number;
  pluginActive: boolean;
  timestamp: number;
}
