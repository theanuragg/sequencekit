'use client';

import { useMemo } from 'react';
import type { OrderLevel } from '../../lib/types';

interface Props {
  bids: OrderLevel[];
  asks: OrderLevel[];
  midPrice: number;
  spreadBps: number;
  pluginActive: boolean;
}

const MAX_LEVELS = 14;

export function OrderBook({ bids, asks, midPrice, spreadBps, pluginActive }: Props) {
  // Aggregate by price level
  const aggBids = useMemo(() => aggregate(bids.slice(0, MAX_LEVELS)), [bids]);
  const aggAsks = useMemo(() => aggregate(asks.slice(0, MAX_LEVELS)), [asks]);

  const maxBidSize = useMemo(() => Math.max(...aggBids.map(l => l.total), 0.001), [aggBids]);
  const maxAskSize = useMemo(() => Math.max(...aggAsks.map(l => l.total), 0.001), [aggAsks]);

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Order Book</span>
        <div className="flex items-center gap-2">
          {pluginActive && (
            <span className="badge badge-amber text-[10px]">
              🛡 MakerShield
            </span>
          )}
          <span className="badge badge-violet num">{spreadBps.toFixed(1)} bps</span>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 px-3 py-1.5 border-b border-[var(--border)]">
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Price (USDC)</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Size (SOL)</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Total</span>
      </div>

      {/* Asks — displayed reversed (lowest ask at bottom, nearest spread) */}
      <div className="flex-1 overflow-hidden flex flex-col-reverse">
        {aggAsks.slice().reverse().map((level, i) => (
          <BookRow key={`ask-${level.price}`} level={level} side="ask" max={maxAskSize} />
        ))}
      </div>

      {/* Mid price */}
      <div className="flex items-center justify-between px-3 py-2 border-y border-[var(--border-s)] bg-[var(--bg-row)]">
        <span className="num font-semibold text-sm text-[var(--tx)]">
          {midPrice > 0 ? midPrice.toFixed(3) : '—'}
        </span>
        <span className="text-[10px] text-[var(--muted)]">mid price</span>
      </div>

      {/* Bids */}
      <div className="flex-1 overflow-hidden">
        {aggBids.map((level) => (
          <BookRow key={`bid-${level.price}`} level={level} side="bid" max={maxBidSize} />
        ))}
      </div>
    </div>
  );
}

interface AggLevel {
  price: number;
  total: number;
  count: number;
  cumTotal: number;
  hasOwn: boolean;
}

function aggregate(levels: OrderLevel[]): AggLevel[] {
  const map = new Map<number, AggLevel>();
  let cum = 0;
  for (const l of levels) {
    const existing = map.get(l.priceLots);
    if (existing) {
      existing.total += l.sizeSOL;
      existing.count++;
      if (l.isOwn) existing.hasOwn = true;
    } else {
      map.set(l.priceLots, { price: l.priceUSDC, total: l.sizeSOL, count: 1, cumTotal: 0, hasOwn: l.isOwn });
    }
  }
  const result = Array.from(map.values());
  let runningTotal = 0;
  for (const r of result) {
    runningTotal += r.total;
    r.cumTotal = runningTotal;
  }
  return result;
}

function BookRow({ level, side, max }: { level: AggLevel; side: 'bid' | 'ask'; max: number }) {
  const depthPct = Math.min((level.total / max) * 100, 100);
  const color = side === 'bid' ? 'var(--bid)' : 'var(--ask)';
  const bgColor = side === 'bid' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

  return (
    <div
      className="relative grid grid-cols-3 px-3 py-[3px] hover:bg-[var(--bg-row)] cursor-default select-none"
      style={{ borderLeft: level.hasOwn ? `2px solid ${color}` : '2px solid transparent' }}
    >
      {/* Depth bar behind */}
      <div
        className="depth-bar"
        style={{ width: `${depthPct}%`, background: bgColor }}
      />
      <span className="num text-[12px] relative z-10" style={{ color }}>
        {level.price.toFixed(3)}
      </span>
      <span className="num text-[12px] relative z-10 text-right text-[var(--tx)]">
        {level.total.toFixed(4)}
      </span>
      <span className="num text-[11px] relative z-10 text-right text-[var(--muted)]">
        {level.cumTotal.toFixed(4)}
      </span>
    </div>
  );
}
