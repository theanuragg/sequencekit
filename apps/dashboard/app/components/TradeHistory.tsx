'use client';

import type { Trade } from '../../lib/types';

interface Props { trades: Trade[] }

export function TradeHistory({ trades }: Props) {
  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Trade History</span>
        <span className="text-[10px] text-[var(--muted)] num">{trades.length} fills</span>
      </div>
      <div className="grid grid-cols-3 px-3 py-1.5 border-b border-[var(--border)]">
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Price (USDC)</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Size (SOL)</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Time</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)] text-xs">
            No trades yet
          </div>
        ) : (
          trades.map((t, i) => <TradeRow key={`${t.slot}-${i}`} trade={t} />)
        )}
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const isNew = Date.now() - trade.timestamp < 2000;
  return (
    <div
      className={`grid grid-cols-3 px-3 py-[3px] border-b border-[rgba(255,255,255,0.03)] ${
        isNew ? (trade.side === 'buy' ? 'flash-bid' : 'flash-ask') : ''
      }`}
    >
      <span className={`num text-[12px] ${trade.side === 'buy' ? 'text-[var(--bid)]' : 'text-[var(--ask)]'}`}>
        {trade.priceUSDC.toFixed(3)}
      </span>
      <span className="num text-[12px] text-right text-[var(--tx)]">
        {trade.sizeSOL.toFixed(4)}
      </span>
      <span className="num text-[11px] text-right text-[var(--muted)]">
        {new Date(trade.timestamp).toLocaleTimeString('en-US', {
          hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
        })}
      </span>
    </div>
  );
}
