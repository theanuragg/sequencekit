/**
 * POST /api/demo/place-order
 *
 * Places a real Ask order on MicroCLOB using the maker keypair.
 * MAKER_KEYPAIR_BASE58 must be set in .env.local (base58 encoded secret key).
 *
 * Returns: { orderId: number, signature: string }
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
const MAKER_KEY   = process.env.MAKER_KEYPAIR_BASE58    ?? '';

// sha256("global:place_order")[0..8]
const PLACE_DISC = Buffer.from([51, 194, 155, 175, 109, 130, 96, 106]);

// Market account offsets
const NEXT_ORDER_ID_OFFSET = 8+32+32+32+8+8+1+1+8+8+2; // = 142

export async function POST(req: NextRequest) {
  if (!MARKET_ADDR || !MAKER_KEY) {
    return Response.json({
      error: 'Missing NEXT_PUBLIC_MARKET_ADDRESS or MAKER_KEYPAIR_BASE58 in .env.local',
    }, { status: 400 });
  }

  const body = await req.json() as { priceLots?: number; sizeLots?: number };
  const priceLots = BigInt(body.priceLots ?? 100_000);
  const sizeLots  = BigInt(body.sizeLots  ?? 1);

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const makerKp   = Keypair.fromSecretKey(bs58.decode(MAKER_KEY));
    const programId = new PublicKey(PROGRAM_ID);
    const marketPk  = new PublicKey(MARKET_ADDR);

    // Read market account
    const marketInfo = await connection.getAccountInfo(marketPk);
    if (!marketInfo) throw new Error(`Market not found: ${MARKET_ADDR}`);

    const baseMint    = new PublicKey(marketInfo.data.slice(8+32, 8+64));
    const quoteMint   = new PublicKey(marketInfo.data.slice(8+64, 8+96));
    const nextOrderId = marketInfo.data.readBigUInt64LE(NEXT_ORDER_ID_OFFSET);

    // Derive all PDAs
    const [baseVault]   = PublicKey.findProgramAddressSync(
      [Buffer.from('base_vault'),  marketPk.toBuffer()], programId);
    const [quoteVault]  = PublicKey.findProgramAddressSync(
      [Buffer.from('quote_vault'), marketPk.toBuffer()], programId);

    const orderIdBuf = Buffer.alloc(8);
    orderIdBuf.writeBigUInt64LE(nextOrderId);
    const [orderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), marketPk.toBuffer(), makerKp.publicKey.toBuffer(), orderIdBuf],
      programId);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), marketPk.toBuffer(), makerKp.publicKey.toBuffer()],
      programId);

    // Get associated token accounts
    const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const makerBaseAta  = getAssociatedTokenAddressSync(baseMint,  makerKp.publicKey);
    const makerQuoteAta = getAssociatedTokenAddressSync(quoteMint, makerKp.publicKey);

    // Build instruction: disc(8) + side(1=Ask) + price_lots(8) + size_lots(8) = 25 bytes
    const data = Buffer.alloc(25);
    PLACE_DISC.copy(data, 0);
    data.writeUInt8(1, 8); // side = Ask
    data.writeBigUInt64LE(priceLots, 9);
    data.writeBigUInt64LE(sizeLots,  17);

    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: marketPk,           isSigner: false, isWritable: true  },
        { pubkey: orderPda,           isSigner: false, isWritable: true  },
        { pubkey: positionPda,        isSigner: false, isWritable: true  },
        { pubkey: baseVault,          isSigner: false, isWritable: true  },
        { pubkey: quoteVault,         isSigner: false, isWritable: true  },
        { pubkey: makerBaseAta,       isSigner: false, isWritable: true  },
        { pubkey: makerQuoteAta,      isSigner: false, isWritable: true  },
        { pubkey: makerKp.publicKey,  isSigner: true,  isWritable: true  },
        { pubkey: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: makerKp.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message(),
    );
    tx.sign([makerKp]);

    const signature = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

    console.log(`[demo/place-order] orderId=${nextOrderId} sig=${signature}`);
    return Response.json({ orderId: Number(nextOrderId), signature });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[demo/place-order]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
