/**
 * POST /api/demo/cancel-order
 *
 * Submits cancel_order as a Jito Bundle via the Block Engine.
 * This is the MAKER instruction — MakerShield tags it MAKER_PRIORITY.
 *
 * Body:  { orderId: number }
 * Returns: { signature, bundleId, attestationHash?, proofUrl? }
 */
import bs58 from 'bs58';
import { NextRequest } from 'next/server';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RPC_URL      = process.env.NEXT_PUBLIC_RPC_URL     ?? 'https://api.devnet.solana.com';
const PROGRAM_ID   = process.env.NEXT_PUBLIC_PROGRAM_ID  ?? '93bKGD7STjvA2h4if8cs4sVxJqtUmxmh8tYFBaRhEgsn';
const MARKET_ADDR  = process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? '';
const MAKER_KEY    = process.env.MAKER_KEYPAIR_BASE58    ?? '';
const BLOCK_ENGINE = process.env.JITO_BLOCK_ENGINE_URL   ?? 'https://amsterdam.mainnet.block-engine.jito.wtf';
const BAM_API      = process.env.BAM_EXPLORER_API        ?? 'https://api.bam.dev';

const TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// sha256("global:cancel_order")[0..8]
const CANCEL_DISC = Buffer.from([95, 129, 237, 240, 8, 49, 223, 132]);

export async function POST(req: NextRequest) {
  if (!MARKET_ADDR || !MAKER_KEY) {
    return Response.json({
      error: 'Missing NEXT_PUBLIC_MARKET_ADDRESS or MAKER_KEYPAIR_BASE58',
    }, { status: 400 });
  }

  const { orderId } = await req.json() as { orderId: number };
  if (orderId === undefined || orderId === null) {
    return Response.json({ error: 'Missing orderId' }, { status: 400 });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const makerKp   = Keypair.fromSecretKey(bs58.decode(MAKER_KEY));
    const programId = new PublicKey(PROGRAM_ID);
    const marketPk  = new PublicKey(MARKET_ADDR);

    // Read market to get mints
    const marketInfo = await connection.getAccountInfo(marketPk);
    if (!marketInfo) throw new Error('Market not found');
    const baseMint  = new PublicKey(marketInfo.data.slice(8+32, 8+64));
    const quoteMint = new PublicKey(marketInfo.data.slice(8+64, 8+96));

    // Derive PDAs
    const [baseVault]  = PublicKey.findProgramAddressSync([Buffer.from('base_vault'),  marketPk.toBuffer()], programId);
    const [quoteVault] = PublicKey.findProgramAddressSync([Buffer.from('quote_vault'), marketPk.toBuffer()], programId);

    const orderIdBuf = Buffer.alloc(8);
    orderIdBuf.writeBigUInt64LE(BigInt(orderId));
    const [orderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), marketPk.toBuffer(), makerKp.publicKey.toBuffer(), orderIdBuf],
      programId);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), marketPk.toBuffer(), makerKp.publicKey.toBuffer()],
      programId);

    const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const makerBaseAta  = getAssociatedTokenAddressSync(baseMint,  makerKp.publicKey);
    const makerQuoteAta = getAssociatedTokenAddressSync(quoteMint, makerKp.publicKey);

    // Build cancel_order instruction: disc(8) + order_id(8) = 16 bytes
    const cancelData = Buffer.alloc(16);
    CANCEL_DISC.copy(cancelData, 0);
    cancelData.writeBigUInt64LE(BigInt(orderId), 8);

    const cancelIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: marketPk,           isSigner: false, isWritable: true  },
        { pubkey: orderPda,           isSigner: false, isWritable: true  },
        { pubkey: positionPda,        isSigner: false, isWritable: true  },
        { pubkey: baseVault,          isSigner: false, isWritable: true  },
        { pubkey: quoteVault,         isSigner: false, isWritable: true  },
        { pubkey: makerBaseAta,       isSigner: false, isWritable: true  },
        { pubkey: makerQuoteAta,      isSigner: false, isWritable: true  },
        { pubkey: makerKp.publicKey,  isSigner: true,  isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
      ],
      data: cancelData,
    });

    // Build maker tx with compute budget
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const makerMsg = new TransactionMessage({
      payerKey: makerKp.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }),
        cancelIx,
      ],
    }).compileToV0Message();
    const makerTx = new VersionedTransaction(makerMsg);
    makerTx.sign([makerKp]);

    // Build tip tx
    const tipAccount = new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]!);
    const tipMsg = new TransactionMessage({
      payerKey: makerKp.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: makerKp.publicKey, toPubkey: tipAccount, lamports: 50_000 }),
      ],
    }).compileToV0Message();
    const tipTx = new VersionedTransaction(tipMsg);
    tipTx.sign([makerKp]);

    // Submit bundle to Jito Block Engine
    const bundleRes = await fetch(`${BLOCK_ENGINE}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sendBundle',
        params: [[
          Buffer.from(makerTx.serialize()).toString('base64'),
          Buffer.from(tipTx.serialize()).toString('base64'),
        ]],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const bundleData = await bundleRes.json() as { result?: string; error?: { message: string } };
    if (bundleData.error) throw new Error(`Block Engine: ${bundleData.error.message}`);
    const bundleId = bundleData.result!;

    // Poll for confirmation
    let slot: number | null = null;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const statusRes = await fetch(`${BLOCK_ENGINE}/api/v1/bundles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getBundleStatuses',
            params: [[bundleId]],
          }),
          signal: AbortSignal.timeout(3000),
        });
        const statusData = await statusRes.json() as {
          result?: { value?: Array<{ confirmation_status: string; slot: number }> };
        };
        const status = statusData.result?.value?.[0];
        if (status?.confirmation_status === 'confirmed' || status?.confirmation_status === 'finalized') {
          slot = status.slot;
          break;
        }
      } catch { /* retry */ }
    }

    // Fetch TEE attestation from BAM Explorer
    let attestationHash: string | undefined;
    let proofUrl: string | undefined;
    if (slot) {
      try {
        const attRes = await fetch(`${BAM_API}/attestation/${slot}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (attRes.ok) {
          const attData = await attRes.json() as { attestation_hash?: string };
          attestationHash = attData.attestation_hash;
          if (attestationHash) proofUrl = `https://bam.dev/explorer/slot/${slot}`;
        }
      } catch { /* attestation is optional */ }
    }

    const signature = bs58.encode(makerTx.signatures[0]!);
    console.log(`[demo/cancel-order] bundleId=${bundleId} slot=${slot} sig=${signature}`);

    return Response.json({ signature, bundleId, slot, attestationHash, proofUrl });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[demo/cancel-order]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
