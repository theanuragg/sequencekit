/**
 * POST /api/demo/fill-order
 *
 * Attempts to fill a maker order using the taker keypair.
 *
 * When MakerShield is active: cancel_order runs first → order is Cancelled
 * → this fill fails with OrderNotFillable. That's the proof.
 *
 * When MakerShield is off: fill may succeed (demonstrates the problem).
 *
 * Body:  { orderId: number, makerAddress: string }
 * Returns: { result: 'rejected' | 'filled', signature?, error? }
 */
import { NextRequest } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RPC_URL     = process.env.NEXT_PUBLIC_RPC_URL     ?? 'https://api.devnet.solana.com';
const PROGRAM_ID  = process.env.NEXT_PUBLIC_PROGRAM_ID  ?? '93bKGD7STjvA2h4if8cs4sVxJqtUmxmh8tYFBaRhEgsn';
const MARKET_ADDR = process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? '';
const TAKER_KEY   = process.env.TAKER_KEYPAIR_BASE58    ?? '';
const MAKER_ADDR  = process.env.DEMO_MAKER_ADDRESS      ?? ''; // maker pubkey for this market

// sha256("global:fill_order")[0..8]
const FILL_DISC = Buffer.from([232, 122, 115, 25, 199, 143, 136, 162]);

export async function POST(req: NextRequest) {
  if (!MARKET_ADDR || !TAKER_KEY || !MAKER_ADDR) {
    return Response.json({
      error: 'Missing NEXT_PUBLIC_MARKET_ADDRESS, TAKER_KEYPAIR_BASE58, or DEMO_MAKER_ADDRESS',
    }, { status: 400 });
  }

  const body = await req.json() as { orderId: number; makerAddress?: string };
  const { orderId } = body;
  const makerAddrOverride = body.makerAddress || MAKER_ADDR;

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const takerKp   = Keypair.fromSecretKey(bs58.decode(TAKER_KEY));
    const programId = new PublicKey(PROGRAM_ID);
    const marketPk  = new PublicKey(MARKET_ADDR);
    const makerPk   = new PublicKey(makerAddrOverride);

    // Read market for mints
    const marketInfo = await connection.getAccountInfo(marketPk);
    if (!marketInfo) throw new Error('Market not found');
    const baseMint  = new PublicKey(marketInfo.data.slice(8+32, 8+64));
    const quoteMint = new PublicKey(marketInfo.data.slice(8+64, 8+96));

    // Derive PDAs
    const [baseVault]  = PublicKey.findProgramAddressSync([Buffer.from('base_vault'),  marketPk.toBuffer()], programId);
    const [quoteVault] = PublicKey.findProgramAddressSync([Buffer.from('quote_vault'), marketPk.toBuffer()], programId);

    const orderIdBuf = Buffer.alloc(8);
    orderIdBuf.writeBigUInt64LE(BigInt(orderId));
    const [makerOrderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), marketPk.toBuffer(), makerPk.toBuffer(), orderIdBuf], programId);
    const [makerPosPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), marketPk.toBuffer(), makerPk.toBuffer()], programId);
    const [takerPosPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), marketPk.toBuffer(), takerKp.publicKey.toBuffer()], programId);

    const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const takerBaseAta  = getAssociatedTokenAddressSync(baseMint,  takerKp.publicKey);
    const takerQuoteAta = getAssociatedTokenAddressSync(quoteMint, takerKp.publicKey);
    const makerBaseAta  = getAssociatedTokenAddressSync(baseMint,  makerPk);
    const makerQuoteAta = getAssociatedTokenAddressSync(quoteMint, makerPk);

    // Build fill_order instruction: disc(8) + maker_order_id(8) + fill_size_lots(8) = 24 bytes
    const fillData = Buffer.alloc(24);
    FILL_DISC.copy(fillData, 0);
    fillData.writeBigUInt64LE(BigInt(orderId), 8);
    fillData.writeBigUInt64LE(BigInt(1), 16); // fill 1 lot

    const fillIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: marketPk,           isSigner: false, isWritable: true  },
        { pubkey: makerPk,            isSigner: false, isWritable: false }, // maker_order_owner
        { pubkey: makerOrderPda,      isSigner: false, isWritable: true  },
        { pubkey: makerPosPda,        isSigner: false, isWritable: true  },
        { pubkey: takerPosPda,        isSigner: false, isWritable: true  },
        { pubkey: baseVault,          isSigner: false, isWritable: true  },
        { pubkey: quoteVault,         isSigner: false, isWritable: true  },
        { pubkey: takerBaseAta,       isSigner: false, isWritable: true  },
        { pubkey: takerQuoteAta,      isSigner: false, isWritable: true  },
        { pubkey: makerBaseAta,       isSigner: false, isWritable: true  },
        { pubkey: makerQuoteAta,      isSigner: false, isWritable: true  },
        { pubkey: takerKp.publicKey,  isSigner: true,  isWritable: true  },
        { pubkey: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: fillData,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: takerKp.publicKey,
        recentBlockhash: blockhash,
        instructions: [fillIx],
      }).compileToV0Message(),
    );
    tx.sign([takerKp]);

    // Send with skipPreflight=true so it hits the chain even if locally it looks like it'll fail
    // This lets the on-chain ordering decide (if cancel beat it, it fails on-chain)
    try {
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: true,
        maxRetries: 1,
      });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      // Check if the order is actually filled or still cancelled
      const orderInfo = await connection.getAccountInfo(makerOrderPda);
      if (!orderInfo) {
        // Order account closed = was cancelled (cancel_order closes the account)
        console.log('[demo/fill-order] Order account gone → cancelled → fill rejected on-chain');
        return Response.json({ result: 'rejected' });
      }

      // Read order status byte: disc(8)+market(32)+owner(32)+side(1)+price(8)+size(8)+filled(8)+status(1)
      const STATUS_OFFSET = 8+32+32+1+8+8+8;
      const status = orderInfo.data[STATUS_OFFSET];
      // status: 0=Open, 1=PartiallyFilled, 2=Filled, 3=Cancelled
      if (status === 3 || status === 2) {
        return Response.json({ result: status === 3 ? 'rejected' : 'filled', signature });
      }
      return Response.json({ result: 'filled', signature });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('OrderNotFillable') || msg.includes('custom program error: 0x6') || msg.includes('0x1770')) {
        console.log('[demo/fill-order] OrderNotFillable — cancel won!');
        return Response.json({ result: 'rejected' });
      }
      throw err;
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[demo/fill-order]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
