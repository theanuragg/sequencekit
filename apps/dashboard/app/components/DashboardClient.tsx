'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TopBar }          from './TopBar';
import { OrderBook }       from './OrderBook';
import { CandleChart }     from './CandleChart';
import { OrderForm }       from './OrderForm';
import { TradeHistory }    from './TradeHistory';
import { AttestationFeed } from './AttestationFeed';
import { SpreadMonitor }   from './SpreadMonitor';
import {
  parseMarketAccount, parseSpreadChangedEvent,
  parseOrderFilledEvent, buildCandles, fetchOrderBook,
} from '../../lib/market';
import { DISCRIMINATORS } from '../../lib/constants';
import type {
  AttestationRow, Candle, MarketConfig,
  OrderBook as OBType, SpreadDataPoint, Trade,
} from '../../lib/types';

interface Props {
  rpcUrl: string;
  programId: string;
  marketAddress: string;
  cluster: string;
}

export function DashboardClient({ rpcUrl, programId, marketAddress, cluster }: Props) {
  const { connection }                   = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [market,       setMarket]       = useState<MarketConfig | null>(null);
  const [orderBook,    setOrderBook]    = useState<OBType>({ bids: [], asks: [], midPrice: 0, spreadBps: 0, pluginActive: false, slot: 0 });
  const [trades,       setTrades]       = useState<Trade[]>([]);
  const [candles,      setCandles]      = useState<Candle[]>([]);
  const [spreadData,   setSpreadData]   = useState<SpreadDataPoint[]>([]);
  const [attestations, setAttestations] = useState<AttestationRow[]>([]);
  const [latencyMs,    setLatencyMs]    = useState(0);
  const [pluginActive, setPluginActive] = useState(false);
  const [toggling,     setToggling]     = useState(false);
  const [shredConn,    setShredConn]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [activeTab,    setActiveTab]    = useState<'trades' | 'attestations' | 'spread'>('trades');

  const logSubRef     = useRef<number | null>(null);
  const bookTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const marketRef     = useRef<MarketConfig | null>(null);
  const allTradesRef  = useRef<Trade[]>([]);
  const pid           = new PublicKey(programId);

  useEffect(() => { marketRef.current = market; }, [market]);

  // ── Parse Anchor events ────────────────────────────────────────────────────
  const handleEvent = useCallback((buf: Buffer, slot: number) => {
    if (buf.length < 8) return;
    const m = marketRef.current;

    // SpreadChanged: disc(8)+market(32)+old_bps(2)+new_bps(2)+slot(8)+plugin(1) = 53
    if (buf.length >= 53) {
      const ev = parseSpreadChangedEvent(buf);
      if (ev) {
        setPluginActive(ev.pluginActive);
        setOrderBook(prev => ({ ...prev, spreadBps: ev.newBps, pluginActive: ev.pluginActive }));
        setSpreadData(prev => [
          ...prev, { slot, bps: ev.newBps, pluginActive: ev.pluginActive, timestamp: Date.now() },
        ].slice(-150));
        return;
      }
    }

    // OrderFilled: disc(8)+market(32)+id(8)+maker(32)+taker(32)+price(8)+size(8)+ts(8) = 136
    if (buf.length >= 136 && m) {
      const trade = parseOrderFilledEvent(buf, m, slot);
      if (trade) {
        setTrades(prev => [trade, ...prev].slice(0, 200));
        allTradesRef.current = [trade, ...allTradesRef.current].slice(0, 5000);
        setCandles(buildCandles(allTradesRef.current));
        return;
      }
    }

    // OrderingProven: disc(8)+slot(8)+market(32)+maker(1)+taker(1)+hash(32) = 82
    if (buf.length >= 82) {
      const makerCount = buf[48] ?? 0;
      const takerCount = buf[49] ?? 0;
      const hash = buf.slice(50, 82).toString('hex');
      if (hash !== '0'.repeat(64)) {
        fetch(`/api/attestation?slot=${slot}`)
          .then(r => r.json() as Promise<{ teeVerified?: boolean; proofUrl?: string | null }>)
          .then(d => {
            setAttestations(prev => [{
              slot, makerCount, takerCount, attestationHash: hash,
              teeVerified: d.teeVerified ?? false,
              proofUrl: d.proofUrl ?? `https://bam.dev/explorer/slot/${slot}`,
              timestamp: Date.now(),
            }, ...prev].slice(0, 30));
          })
          .catch(() => {
            setAttestations(prev => [{
              slot, makerCount, takerCount, attestationHash: hash, teeVerified: false,
              proofUrl: `https://bam.dev/explorer/slot/${slot}`, timestamp: Date.now(),
            }, ...prev].slice(0, 30));
          });
      }
    }
  }, []);

  // ── Connect to chain ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!marketAddress) {
      setError('Set NEXT_PUBLIC_MARKET_ADDRESS — run: make init-market');
      return;
    }
    const mktPk = new PublicKey(marketAddress);

    // Read market account
    connection.getAccountInfo(mktPk).then(info => {
      if (!info) { setError('Market account not found on chain'); return; }
      const cfg = parseMarketAccount(Buffer.from(info.data), marketAddress);
      setMarket(cfg);
      setPluginActive(cfg.pluginActive);
      setOrderBook(prev => ({ ...prev, pluginActive: cfg.pluginActive, spreadBps: cfg.spreadBps }));
    }).catch(e => setError(String(e)));

    // Subscribe to program logs
    const subId = connection.onLogs(pid, ({ logs, err }, { slot }) => {
      if (err) return;
      for (const log of logs) {
        if (!log.startsWith('Program data: ')) continue;
        try { handleEvent(Buffer.from(log.slice(14).trim(), 'base64'), slot); } catch { /* skip */ }
      }
    }, 'confirmed');
    logSubRef.current = subId;

    // Poll order book every 2 seconds
    bookTimerRef.current = setInterval(async () => {
      const m = marketRef.current;
      if (!m) return;
      try {
        const { bids, asks } = await fetchOrderBook(connection, pid, m, publicKey?.toBase58());
        const bestBid = bids[0]?.priceUSDC ?? 0;
        const bestAsk = asks[0]?.priceUSDC ?? 0;
        const mid     = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
        const spread  = mid > 0 ? Math.round(((bestAsk - bestBid) / mid) * 10_000 * 10) / 10 : 0;
        setOrderBook(prev => ({ ...prev, bids, asks, midPrice: mid, spreadBps: spread }));
      } catch { /* transient */ }
    }, 2000);

    return () => {
      if (logSubRef.current !== null) connection.removeOnLogsListener(logSubRef.current);
      if (bookTimerRef.current) clearInterval(bookTimerRef.current);
    };
  }, [connection, programId, marketAddress, publicKey, handleEvent]);

  // ── ShredStream SSE ─────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/shredstream');
    es.onopen  = () => setShredConn(true);
    es.onerror = () => setShredConn(false);
    es.onmessage = (e: MessageEvent<string>) => {
      try { const d = JSON.parse(e.data) as { deltaMs: number }; setLatencyMs(d.deltaMs); } catch { /* skip */ }
    };
    return () => es.close();
  }, []);

  // ── Toggle plugin (wallet signs) ────────────────────────────────────────────
  const handleToggle = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setError('Connect wallet to toggle plugin');
      return;
    }
    setToggling(true);
    try {
      const mktPk = new PublicKey(marketAddress);
      const data  = Buffer.alloc(9);
      Buffer.from(DISCRIMINATORS.toggle_plugin).copy(data, 0);
      data.writeUInt8(pluginActive ? 0 : 1, 8);

      const ix = new TransactionInstruction({
        programId: pid,
        keys: [
          { pubkey: mktPk,      isSigner: false, isWritable: true  },
          { pubkey: publicKey,  isSigner: true,  isWritable: false },
        ],
        data,
      });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: publicKey, recentBlockhash: blockhash, instructions: [ix],
      }).compileToV0Message();
      const tx     = new VersionedTransaction(msg);
      const signed = await signTransaction(tx);
      const sig    = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      const newActive = !pluginActive;
      setPluginActive(newActive);
      setOrderBook(prev => ({ ...prev, pluginActive: newActive }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)]">
      <TopBar
        marketAddress={marketAddress}
        pluginActive={pluginActive}
        toggling={toggling}
        onToggle={handleToggle}
        midPrice={orderBook.midPrice}
        spreadBps={orderBook.spreadBps}
        latencyMs={latencyMs}
        shredConnected={shredConn}
        cluster={cluster}
      />

      {error && (
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-[var(--ask)] bg-[rgba(239,68,68,0.08)] border-b border-[rgba(239,68,68,0.2)] shrink-0">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="px-2">✕</button>
        </div>
      )}

      {/* 3-column layout */}
      <div className="flex-1 overflow-hidden grid" style={{
        gridTemplateColumns: '220px 1fr 220px',
        gridTemplateRows: '1fr 200px',
      }}>
        {/* Left: Order book — spans 2 rows */}
        <div className="row-span-2 border-r border-[var(--border)] overflow-hidden">
          <OrderBook
            bids={orderBook.bids} asks={orderBook.asks}
            midPrice={orderBook.midPrice} spreadBps={orderBook.spreadBps}
            pluginActive={pluginActive}
          />
        </div>

        {/* Center top: Candle chart */}
        <div className="border-b border-[var(--border)] overflow-hidden">
          <CandleChart candles={candles} recentTrades={trades} symbol="SOL/USDC" />
        </div>

        {/* Right: Order form — spans 2 rows */}
        <div className="row-span-2 border-l border-[var(--border)] overflow-hidden">
          <OrderForm
            marketAddress={marketAddress}
            programId={programId}
            pluginActive={pluginActive}
            bestBid={orderBook.bids[0]?.priceLots ?? 0}
            bestAsk={orderBook.asks[0]?.priceLots ?? 0}
            tickSize={market?.tickSize  ?? 1_000}
            lotSize={market?.lotSize    ?? 100_000}
            baseMint={market?.baseMint}
            quoteMint={market?.quoteMint}
          />
        </div>

        {/* Center bottom: Tabs */}
        <div className="overflow-hidden flex flex-col">
          <div className="tab-bar shrink-0">
            {(['trades', 'attestations', 'spread'] as const).map(t => (
              <button key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
                {t === 'trades' ? 'Trades' : t === 'attestations' ? 'TEE Proofs' : 'Spread'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTab === 'trades'       && <TradeHistory    trades={trades} />}
            {activeTab === 'attestations' && <AttestationFeed rows={attestations} />}
            {activeTab === 'spread'       && <SpreadMonitor   data={spreadData} pluginActive={pluginActive} />}
          </div>
        </div>
      </div>

      <footer className="h-7 border-t border-[var(--border)] flex items-center px-4 gap-3 text-[10px] text-[var(--faint)] shrink-0">
        <span>SequenceKit — Jito Hackathon 2025</span>
        <span>·</span>
        <a href="https://github.com/sequencekit-labs/sequencekit" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--violet)] transition-colors">
          github.com/sequencekit-labs/sequencekit
        </a>
        <span>· npm: @sequencekit/sdk</span>
        <div className="flex-1" />
        <span>Jito BAM · ShredStream · Bundles · JitoSOL</span>
      </footer>
    </div>
  );
}
