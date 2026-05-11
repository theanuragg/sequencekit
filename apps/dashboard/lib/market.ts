/**
 * market.ts — On-chain market data utilities.
 *
 * Parses Market account, Order accounts, and program log events
 * into typed objects the dashboard can use.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import type { MarketConfig, OrderLevel, Trade, Candle } from './types';

// Market account layout offsets
// disc(8) auth(32) base_mint(32) quote_mint(32) tick(8) lot(8) plugin(1) paused(1)
// best_bid(8) best_ask(8) spread_bps(2) next_order_id(8) open_count(4) volume(8) fill_count(4) bump(1)
const OFF = {
  authority:    8,
  base_mint:    8 + 32,
  quote_mint:   8 + 64,
  tick_size:    8 + 96,
  lot_size:     8 + 104,
  plugin_active: 8 + 112,
  paused:        8 + 113,
  best_bid:      8 + 114,
  best_ask:      8 + 122,
  spread_bps:    8 + 130,
  next_order_id: 8 + 132,
  open_count:    8 + 140,
  total_volume:  8 + 144,
  fill_count:    8 + 152,
} as const;

export function parseMarketAccount(data: Buffer, address: string): MarketConfig {
  const tickSize    = Number(data.readBigUInt64LE(OFF.tick_size));
  const lotSize     = Number(data.readBigUInt64LE(OFF.lot_size));
  const bestBidRaw  = Number(data.readBigUInt64LE(OFF.best_bid));
  const bestAskRaw  = Number(data.readBigUInt64LE(OFF.best_ask));

  return {
    address,
    baseMint:    new PublicKey(data.slice(OFF.base_mint,  OFF.base_mint  + 32)).toBase58(),
    quoteMint:   new PublicKey(data.slice(OFF.quote_mint, OFF.quote_mint + 32)).toBase58(),
    tickSize,
    lotSize,
    pluginActive: data[OFF.plugin_active] === 1,
    paused:       data[OFF.paused] === 1,
    bestBid:      bestBidRaw,
    bestAsk:      bestAskRaw === 0xFFFFFFFF_FFFFFFFF ? 0 : bestAskRaw,
    spreadBps:    data.readUInt16LE(OFF.spread_bps),
    nextOrderId:  Number(data.readBigUInt64LE(OFF.next_order_id)),
  };
}

// Order account layout
// disc(8) market(32) owner(32) side(1) price_lots(8) size_lots(8) filled_lots(8) status(1) created_at(8) order_id(8) bump(1)
export function parseOrderAccount(
  data: Buffer,
  address: string,
  market: MarketConfig,
  walletAddress?: string,
): OrderLevel | null {
  if (data.length < 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 8 + 8 + 1) return null;

  const status = data[8 + 32 + 32 + 1 + 8 + 8 + 8]; // 0=Open, 1=Partial, 2=Filled, 3=Cancelled
  if (status !== 0 && status !== 1) return null; // Only open/partial

  const side       = data[8 + 32 + 32] === 0 ? 'bid' : 'ask';
  const priceLots  = Number(data.readBigUInt64LE(8 + 32 + 32 + 1));
  const sizeLots   = Number(data.readBigUInt64LE(8 + 32 + 32 + 1 + 8));
  const filledLots = Number(data.readBigUInt64LE(8 + 32 + 32 + 1 + 8 + 8));
  const owner      = new PublicKey(data.slice(8 + 32, 8 + 64)).toBase58();
  const orderId    = Number(data.readBigUInt64LE(8 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 8));

  return {
    orderId,
    owner,
    priceLots,
    sizeLots,
    filledLots,
    side: side as 'bid' | 'ask',
    priceUSDC: (priceLots * market.tickSize) / 1e6,
    sizeSOL: ((sizeLots - filledLots) * market.lotSize) / 1e9,
    isOwn: walletAddress === owner,
  };
}

// Parse SpreadChanged event from Anchor program log
// disc(8) market(32) old_bps(2) new_bps(2) slot(8) plugin_active(1) = 53 bytes
export function parseSpreadChangedEvent(buf: Buffer): {
  oldBps: number; newBps: number; slot: number; pluginActive: boolean;
} | null {
  if (buf.length < 53) return null;
  const oldBps     = buf.readUInt16LE(40);
  const newBps     = buf.readUInt16LE(42);
  const plugActive = buf[52] === 1;
  if (newBps > 10_000) return null;
  return { oldBps, newBps, slot: 0, pluginActive: plugActive };
}

// Parse OrderFilled event
// disc(8) market(32) maker_order_id(8) maker(32) taker(32) price_lots(8) fill_size_lots(8) timestamp(8) = 136 bytes
export function parseOrderFilledEvent(buf: Buffer, market: MarketConfig, slot: number): Trade | null {
  if (buf.length < 136) return null;
  try {
    const priceLots    = Number(buf.readBigUInt64LE(8 + 32 + 8 + 32 + 32));
    const fillSizeLots = Number(buf.readBigUInt64LE(8 + 32 + 8 + 32 + 32 + 8));
    const timestamp    = Number(buf.readBigInt64LE(8 + 32 + 8 + 32 + 32 + 8 + 8));
    const priceUSDC    = (priceLots * market.tickSize) / 1e6;
    const sizeSOL      = (fillSizeLots * market.lotSize) / 1e9;
    return {
      slot,
      timestamp: timestamp * 1000,
      priceLots,
      priceUSDC,
      sizeSOL,
      side: 'buy', // We determine side from context
      makerOrderId: Number(buf.readBigUInt64LE(8 + 32)),
    };
  } catch { return null; }
}

// Build candles from trade history (1-minute buckets)
export function buildCandles(trades: Trade[]): Candle[] {
  if (trades.length === 0) return [];
  const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
  const BUCKET = 60; // 1 minute

  for (const t of trades) {
    const key = Math.floor(t.timestamp / 1000 / BUCKET) * BUCKET;
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, { o: t.priceUSDC, h: t.priceUSDC, l: t.priceUSDC, c: t.priceUSDC, v: t.sizeSOL });
    } else {
      b.h = Math.max(b.h, t.priceUSDC);
      b.l = Math.min(b.l, t.priceUSDC);
      b.c = t.priceUSDC;
      b.v += t.sizeSOL;
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, b]) => ({ time, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
}

// Fetch all open Order accounts for a market
export async function fetchOrderBook(
  connection: Connection,
  programId: PublicKey,
  market: MarketConfig,
  walletAddress?: string,
): Promise<{ bids: OrderLevel[]; asks: OrderLevel[] }> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { dataSize: 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 8 + 8 + 1 }, // Order::LEN
      { memcmp: { offset: 8, bytes: new PublicKey(market.address).toBase58() } }, // market field
    ],
  });

  const bids: OrderLevel[] = [];
  const asks: OrderLevel[] = [];

  for (const { account } of accounts) {
    const order = parseOrderAccount(
      Buffer.from(account.data),
      '',
      market,
      walletAddress,
    );
    if (!order) continue;
    if (order.side === 'bid') bids.push(order);
    else asks.push(order);
  }

  // Sort: bids descending by price, asks ascending
  bids.sort((a, b) => b.priceLots - a.priceLots);
  asks.sort((a, b) => a.priceLots - b.priceLots);

  return { bids, asks };
}
