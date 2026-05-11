'use client';

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet }         from '@solana/wallet-adapter-react';

interface Props {
  marketAddress: string;
  pluginActive: boolean;
  toggling: boolean;
  onToggle: () => void;
  midPrice: number;
  spreadBps: number;
  latencyMs: number;
  shredConnected: boolean;
  cluster: string;
}

export function TopBar({
  marketAddress, pluginActive, toggling, onToggle,
  midPrice, spreadBps, latencyMs, shredConnected, cluster,
}: Props) {
  const { connected, publicKey } = useWallet();
  const explorerUrl = marketAddress
    ? `https://explorer.solana.com/address/${marketAddress}${cluster !== 'mainnet' ? `?cluster=${cluster}` : ''}`
    : '#';

  return (
    <header className="h-12 bg-[var(--bg-panel)] border-b border-[var(--border)] flex items-center px-4 gap-3 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-1 shrink-0">
        <div className="w-6 h-6 rounded bg-gradient-to-br from-[var(--violet)] to-[var(--sky)] flex items-center justify-center text-[10px] font-bold text-white">SK</div>
        <span className="font-semibold text-sm tracking-tight">SequenceKit</span>
      </div>

      {/* Market */}
      {marketAddress && (
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="num text-[11px] text-[var(--muted)] hover:text-[var(--tx)] transition-colors shrink-0"
          title={marketAddress}>
          {marketAddress.slice(0, 8)}…{marketAddress.slice(-4)}
        </a>
      )}

      <div className="w-px h-4 bg-[var(--border)] shrink-0" />

      {/* Mid price */}
      {midPrice > 0 && (
        <span className="num text-sm font-medium text-[var(--tx)] shrink-0">
          ${midPrice.toFixed(3)}
        </span>
      )}

      {/* Spread */}
      {spreadBps > 0 && (
        <span className="num text-[11px] text-[var(--muted)] shrink-0">
          {spreadBps.toFixed(1)} bps
        </span>
      )}

      <div className="flex-1" />

      {/* Latency */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{
          background: shredConnected ? 'var(--bid)' : 'var(--faint)',
          boxShadow: shredConnected ? '0 0 4px var(--bid)' : 'none',
        }} />
        <span className="num text-[11px] text-[var(--muted)]">
          {latencyMs > 0 ? `${latencyMs}ms` : '—'}
        </span>
        <span className="text-[10px] text-[var(--faint)]">
          {shredConnected ? 'ShredStream' : 'RPC'}
        </span>
      </div>

      <div className="w-px h-4 bg-[var(--border)] shrink-0" />

      {/* Plugin toggle */}
      <button
        onClick={onToggle}
        disabled={toggling || !marketAddress || !connected}
        className={`btn text-[11px] px-3 h-7 shrink-0 ${pluginActive ? 'btn-amber' : 'btn-ghost'}`}
        title={!connected ? 'Connect wallet to toggle' : ''}
      >
        {toggling ? '⏳' : pluginActive ? '🛡 MakerShield ON' : '○ MakerShield OFF'}
      </button>

      {/* Wallet button */}
      <WalletMultiButton
        style={{
          height: 28,
          fontSize: 11,
          padding: '0 12px',
          borderRadius: 6,
          background: connected ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${connected ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'}`,
          color: connected ? 'var(--violet)' : 'var(--muted)',
        }}
      />
    </header>
  );
}
