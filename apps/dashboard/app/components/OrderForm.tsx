'use client';

import { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram, SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { DISCRIMINATORS, JITO_TIP_ACCOUNTS, DEFAULT_TIP_LAMPORTS } from '../../lib/constants';

interface Props {
  marketAddress: string;
  programId?: string;
  pluginActive: boolean;
  bestBid: number;
  bestAsk: number;
  tickSize: number;
  lotSize: number;
  baseMint?: string;
  quoteMint?: string;
  onOrderPlaced?: (orderId: number) => void;
}

type Side = 'bid' | 'ask';

// Jito Block Engine URL for bundle submission
const BLOCK_ENGINE = process.env.NEXT_PUBLIC_BLOCK_ENGINE_URL
  ?? 'https://amsterdam.mainnet.block-engine.jito.wtf';

export function OrderForm({
  marketAddress, programId, pluginActive,
  bestBid, bestAsk, tickSize, lotSize,
  baseMint, quoteMint, onOrderPlaced,
}: Props) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [tab,       setTab]       = useState<'limit' | 'cancel'>('limit');
  const [side,      setSide]      = useState<Side>('bid');
  const [price,     setPrice]     = useState('');
  const [size,      setSize]      = useState('');
  const [cancelId,  setCancelId]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [msg,       setMsg]       = useState<{ text: string; ok: boolean; sig?: string } | null>(null);

  const pid = new PublicKey(programId ?? '93bKGD7STjvA2h4if8cs4sVxJqtUmxmh8tYFBaRhEgsn');
  const mktPk = marketAddress ? new PublicKey(marketAddress) : null;

  const priceToLots = (v: string) => Math.round((parseFloat(v) * 1e6) / tickSize);
  const sizeToLots  = (v: string) => Math.round((parseFloat(v) * 1e9) / lotSize);

  // ── Build and send a transaction signed by the connected wallet ───────────
  const sendTx = useCallback(async (instructions: TransactionInstruction[]): Promise<string> => {
    if (!publicKey || !signTransaction) throw new Error('Wallet not connected');

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  }, [publicKey, signTransaction, connection]);

  // ── Submit cancel as Jito Bundle (wallet signs both txs) ─────────────────
  const sendBundle = useCallback(async (cancelIx: TransactionInstruction): Promise<{
    sig: string; bundleId: string; attestationHash?: string;
  }> => {
    if (!publicKey || !signTransaction) throw new Error('Wallet not connected');

    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    // Tx 0: cancel instruction
    const cancelMsg = new TransactionMessage({
      payerKey: publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        cancelIx,
      ],
    }).compileToV0Message();
    const cancelTx = new VersionedTransaction(cancelMsg);

    // Tx 1: tip transaction
    const tipAccount = new PublicKey(
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]!
    );
    const tipMsg = new TransactionMessage({
      payerKey: publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: tipAccount, lamports: DEFAULT_TIP_LAMPORTS }),
      ],
    }).compileToV0Message();
    const tipTx = new VersionedTransaction(tipMsg);

    // Sign both with wallet
    const [signedCancel, signedTip] = await Promise.all([
      signTransaction(cancelTx),
      signTransaction(tipTx),
    ]);

    // Submit bundle
    const res = await fetch(`${BLOCK_ENGINE}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sendBundle',
        params: [[
          Buffer.from(signedCancel.serialize()).toString('base64'),
          Buffer.from(signedTip.serialize()).toString('base64'),
        ]],
      }),
    });
    const data = await res.json() as { result?: string; error?: { message: string } };
    if (data.error) throw new Error(data.error.message);
    const bundleId = data.result!;

    // Poll for confirmation
    let attestationHash: string | undefined;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const s = await fetch(`${BLOCK_ENGINE}/api/v1/bundles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBundleStatuses', params: [[bundleId]] }),
        });
        const sd = await s.json() as { result?: { value?: Array<{ confirmation_status: string; slot: number }> } };
        const status = sd.result?.value?.[0];
        if (status?.confirmation_status === 'confirmed' || status?.confirmation_status === 'finalized') {
          // Try to fetch attestation
          try {
            const ar = await fetch(`https://api.bam.dev/attestation/${status.slot}`);
            if (ar.ok) {
              const ad = await ar.json() as { attestation_hash?: string };
              attestationHash = ad.attestation_hash;
            }
          } catch { /* optional */ }
          break;
        }
      } catch { /* retry */ }
    }

    const sig = bs58.encode(signedCancel.signatures[0]!);
    return { sig, bundleId, attestationHash };
  }, [publicKey, signTransaction, connection]);

  // ── Place order ───────────────────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (!connected || !publicKey || !mktPk) {
      setMsg({ text: 'Connect wallet first', ok: false });
      return;
    }
    if (!baseMint || !quoteMint) {
      setMsg({ text: 'Market not loaded yet', ok: false });
      return;
    }
    const priceLots = priceToLots(price);
    const sizeLots  = sizeToLots(size);
    if (!priceLots || !sizeLots) {
      setMsg({ text: 'Enter valid price and size', ok: false });
      return;
    }

    setLoading(true);
    setMsg(null);
    try {
      // Derive all PDAs
      const baseMintPk  = new PublicKey(baseMint);
      const quoteMintPk = new PublicKey(quoteMint);

      // Read next_order_id from market account
      const mktInfo = await connection.getAccountInfo(mktPk);
      if (!mktInfo) throw new Error('Market not found');
      const nextOrderId = mktInfo.data.readBigUInt64LE(8+32+32+32+8+8+1+1+8+8+2);

      const [baseVault]  = PublicKey.findProgramAddressSync([Buffer.from('base_vault'),  mktPk.toBuffer()], pid);
      const [quoteVault] = PublicKey.findProgramAddressSync([Buffer.from('quote_vault'), mktPk.toBuffer()], pid);
      const orderIdBuf = Buffer.alloc(8); orderIdBuf.writeBigUInt64LE(nextOrderId);
      const [orderPda]   = PublicKey.findProgramAddressSync([Buffer.from('order'), mktPk.toBuffer(), publicKey.toBuffer(), orderIdBuf], pid);
      const [posPda]     = PublicKey.findProgramAddressSync([Buffer.from('position'), mktPk.toBuffer(), publicKey.toBuffer()], pid);
      const baseAta  = getAssociatedTokenAddressSync(baseMintPk,  publicKey);
      const quoteAta = getAssociatedTokenAddressSync(quoteMintPk, publicKey);

      // Build instruction data: disc(8) + side(1) + price_lots(8) + size_lots(8)
      const data = Buffer.alloc(25);
      Buffer.from(DISCRIMINATORS.place_order).copy(data, 0);
      data.writeUInt8(side === 'bid' ? 0 : 1, 8);
      data.writeBigUInt64LE(BigInt(priceLots), 9);
      data.writeBigUInt64LE(BigInt(sizeLots),  17);

      const ix = new TransactionInstruction({
        programId: pid,
        keys: [
          { pubkey: mktPk,       isSigner: false, isWritable: true  },
          { pubkey: orderPda,    isSigner: false, isWritable: true  },
          { pubkey: posPda,      isSigner: false, isWritable: true  },
          { pubkey: baseVault,   isSigner: false, isWritable: true  },
          { pubkey: quoteVault,  isSigner: false, isWritable: true  },
          { pubkey: baseAta,     isSigner: false, isWritable: true  },
          { pubkey: quoteAta,    isSigner: false, isWritable: true  },
          { pubkey: publicKey,   isSigner: true,  isWritable: true  },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });

      const sig = await sendTx([ix]);
      setMsg({ text: `Order #${Number(nextOrderId)} placed`, ok: true, sig });
      onOrderPlaced?.(Number(nextOrderId));
      setPrice(''); setSize('');
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setLoading(false);
    }
  };

  // ── Cancel order ──────────────────────────────────────────────────────────
  const handleCancelOrder = async () => {
    if (!connected || !publicKey || !mktPk) {
      setMsg({ text: 'Connect wallet first', ok: false });
      return;
    }
    if (!baseMint || !quoteMint) {
      setMsg({ text: 'Market not loaded', ok: false });
      return;
    }
    const orderId = parseInt(cancelId);
    if (isNaN(orderId)) { setMsg({ text: 'Enter valid order ID', ok: false }); return; }

    setLoading(true);
    setMsg(null);
    try {
      const baseMintPk  = new PublicKey(baseMint);
      const quoteMintPk = new PublicKey(quoteMint);
      const [baseVault]  = PublicKey.findProgramAddressSync([Buffer.from('base_vault'),  mktPk.toBuffer()], pid);
      const [quoteVault] = PublicKey.findProgramAddressSync([Buffer.from('quote_vault'), mktPk.toBuffer()], pid);
      const orderIdBuf = Buffer.alloc(8); orderIdBuf.writeBigUInt64LE(BigInt(orderId));
      const [orderPda] = PublicKey.findProgramAddressSync([Buffer.from('order'), mktPk.toBuffer(), publicKey.toBuffer(), orderIdBuf], pid);
      const [posPda]   = PublicKey.findProgramAddressSync([Buffer.from('position'), mktPk.toBuffer(), publicKey.toBuffer()], pid);
      const baseAta  = getAssociatedTokenAddressSync(baseMintPk,  publicKey);
      const quoteAta = getAssociatedTokenAddressSync(quoteMintPk, publicKey);

      // disc(8) + order_id(8)
      const data = Buffer.alloc(16);
      Buffer.from(DISCRIMINATORS.cancel_order).copy(data, 0);
      data.writeBigUInt64LE(BigInt(orderId), 8);

      const cancelIx = new TransactionInstruction({
        programId: pid,
        keys: [
          { pubkey: mktPk,      isSigner: false, isWritable: true  },
          { pubkey: orderPda,   isSigner: false, isWritable: true  },
          { pubkey: posPda,     isSigner: false, isWritable: true  },
          { pubkey: baseVault,  isSigner: false, isWritable: true  },
          { pubkey: quoteVault, isSigner: false, isWritable: true  },
          { pubkey: baseAta,    isSigner: false, isWritable: true  },
          { pubkey: quoteAta,   isSigner: false, isWritable: true  },
          { pubkey: publicKey,  isSigner: true,  isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data,
      });

      if (pluginActive) {
        // Submit as Jito Bundle — MakerShield guarantees ordering
        const { sig, bundleId, attestationHash } = await sendBundle(cancelIx);
        const proof = attestationHash ? ` | TEE: ${attestationHash.slice(0, 12)}…` : '';
        setMsg({ text: `🛡 Bundle submitted${proof}`, ok: true, sig });
      } else {
        // Regular transaction
        const sig = await sendTx([cancelIx]);
        setMsg({ text: `Cancel confirmed`, ok: true, sig });
      }
      setCancelId('');
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div className="panel flex flex-col h-full">
        <div className="panel-header"><span className="panel-title">Trade</span></div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-[32px]">🔗</div>
          <div className="text-[var(--muted)] text-sm">Connect wallet to trade</div>
          <div className="text-[10px] text-[var(--faint)]">Phantom · Solflare · Backpack</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Trade</span>
        <div className="flex items-center gap-1.5">
          {pluginActive && <span className="badge badge-amber text-[10px]">🛡 Protected</span>}
          <span className="num text-[10px] text-[var(--muted)]" title={publicKey!.toBase58()}>
            {publicKey!.toBase58().slice(0, 6)}…
          </span>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab ${tab === 'limit'  ? 'active' : ''}`} onClick={() => setTab('limit')}>Limit</button>
        <button className={`tab ${tab === 'cancel' ? 'active' : ''}`} onClick={() => setTab('cancel')}>Cancel</button>
      </div>

      <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto">
        {tab === 'limit' ? (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <button className={`btn ${side === 'bid' ? 'btn-bid' : 'btn-ghost'}`} onClick={() => setSide('bid')}>Buy / Bid</button>
              <button className={`btn ${side === 'ask' ? 'btn-ask' : 'btn-ghost'}`} onClick={() => setSide('ask')}>Sell / Ask</button>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Price (USDC)</label>
                <div className="flex gap-2">
                  {bestBid > 0 && <button onClick={() => setPrice(((bestBid * tickSize) / 1e6).toFixed(3))} className="text-[10px] text-[var(--bid)] hover:underline num">Bid {((bestBid * tickSize) / 1e6).toFixed(3)}</button>}
                  {bestAsk > 0 && <button onClick={() => setPrice(((bestAsk * tickSize) / 1e6).toFixed(3))} className="text-[10px] text-[var(--ask)] hover:underline num">Ask {((bestAsk * tickSize) / 1e6).toFixed(3)}</button>}
                </div>
              </div>
              <input className="input" type="number" placeholder="0.000" value={price} onChange={e => setPrice(e.target.value)} min="0" step="0.001" />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--muted)] block mb-1">Size (SOL)</label>
              <input className="input" type="number" placeholder="0.0000" value={size} onChange={e => setSize(e.target.value)} min="0" step="0.1" />
            </div>

            {price && size && !isNaN(parseFloat(price)) && !isNaN(parseFloat(size)) && (
              <div className="bg-[var(--bg)] rounded px-2.5 py-2 text-[11px] text-[var(--muted)] num">
                ≈ ${(parseFloat(price) * parseFloat(size)).toFixed(2)} USDC total
              </div>
            )}

            <button className={`btn mt-auto ${side === 'bid' ? 'btn-bid' : 'btn-ask'}`} style={{ height: 38 }} onClick={handlePlaceOrder} disabled={loading}>
              {loading ? '⏳ Signing…' : side === 'bid' ? 'Place Bid' : 'Place Ask'}
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--muted)] block mb-1">Order ID</label>
              <input className="input" type="number" placeholder="0" value={cancelId} onChange={e => setCancelId(e.target.value)} />
            </div>

            <div className="bg-[var(--bg)] rounded p-2.5 text-[11px] text-[var(--muted)]">
              {pluginActive ? (
                <><p className="text-[var(--amber)] font-medium mb-1">🛡 MakerShield Active</p><p>Cancel sent as Jito Bundle — sequenced before any fill in the same slot. TEE attestation proves ordering.</p></>
              ) : (
                <><p className="text-[var(--ask)] font-medium mb-1">○ No protection</p><p>Regular tx. Enable MakerShield for guaranteed ordering protection.</p></>
              )}
            </div>

            <button className="btn btn-ask mt-auto" style={{ height: 38 }} onClick={handleCancelOrder} disabled={loading || !cancelId}>
              {loading ? '⏳ Signing…' : pluginActive ? '🛡 Protected Cancel' : 'Cancel Order'}
            </button>
          </>
        )}

        {msg && (
          <div className={`text-[11px] px-2.5 py-2 rounded num ${msg.ok ? 'text-[var(--bid)] bg-[rgba(34,197,94,0.08)]' : 'text-[var(--ask)] bg-[rgba(239,68,68,0.08)]'}`}>
            <div>{msg.text}</div>
            {msg.sig && (
              <a href={`https://explorer.solana.com/tx/${msg.sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-[var(--violet)] hover:underline text-[10px]">
                View tx ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
