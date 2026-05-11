/**
 * POST /api/toggle-plugin
 *
 * Sends a real on-chain toggle_plugin transaction to the MicroCLOB program.
 * Uses the AUTHORITY_KEYPAIR env var (base58 private key) to sign.
 *
 * Body: { active: boolean }
 * Returns: { active: boolean, signature: string }
 */

import { NextRequest } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

export const runtime = 'nodejs'; // needs fs/crypto — not edge compatible

const RPC_URL     = process.env.NEXT_PUBLIC_RPC_URL    ?? 'https://api.devnet.solana.com';
const PROGRAM_ID  = process.env.NEXT_PUBLIC_PROGRAM_ID ?? '93bKGD7STjvA2h4if8cs4sVxJqtUmxmh8tYFBaRhEgsn';
const MARKET_ADDR = process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? '';
// AUTHORITY_KEYPAIR: base58-encoded secret key of the market authority
// Set this in .env.local — NEVER commit to git
const AUTH_KEY    = process.env.AUTHORITY_KEYPAIR ?? '';

export async function POST(req: NextRequest) {
  const { active } = await req.json() as { active: boolean };

  if (!MARKET_ADDR) {
    return Response.json({ error: 'NEXT_PUBLIC_MARKET_ADDRESS not configured' }, { status: 400 });
  }
  if (!AUTH_KEY) {
    return Response.json({ error: 'AUTHORITY_KEYPAIR not configured in .env.local' }, { status: 500 });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const authority  = Keypair.fromSecretKey(bs58.decode(AUTH_KEY));
    const programId  = new PublicKey(PROGRAM_ID);
    const marketPk   = new PublicKey(MARKET_ADDR);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed');

    // toggle_plugin discriminator: sha256("global:toggle_plugin")[0..8]
    // = [217, 191, 148, 183, 220, 117, 85, 28]
    // Instruction data = discriminator(8) + active(1 byte: 1=true, 0=false)
    const data = Buffer.alloc(9);
    data.set([217, 191, 148, 183, 220, 117, 85, 28], 0);
    data.writeUInt8(active ? 1 : 0, 8);

    const message = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [{
        programId,
        keys: [
          { pubkey: marketPk,           isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true,  isWritable: false },
        ],
        data,
      }],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([authority]);

    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    });

    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    console.log(`[toggle-plugin] active=${active} tx=${signature}`);
    return Response.json({ active, signature });

  } catch (err) {
    console.error('[toggle-plugin] Error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
