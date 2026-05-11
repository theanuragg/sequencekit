#!/usr/bin/env npx tsx
/**
 * demo-taker.ts — Taker demo script.
 *
 * Run this in Terminal 2 simultaneously with demo-maker.ts to simulate
 * a taker trying to fill a stale maker order in the same block.
 *
 * When MakerShield is active:
 *   cancel_order lands first → fill_order fails with OrderNotFillable
 *   → Judges see: maker is protected, no adverse selection
 *
 * When MakerShield is off:
 *   fill_order may land first → maker gets picked off at stale price
 *   → Judges see: the problem we're solving
 *
 * Usage:
 *   TAKER_KEYPAIR=~/.config/solana/taker.json \
 *   MARKET_ADDRESS=<market-pda> \
 *   MAKER_ORDER_ID=0 \
 *   MAKER_ADDRESS=<maker-pubkey> \
 *   npx tsx scripts/demo-taker.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TOKEN_PROGRAM_ID,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import fs from 'fs';
import { deriveOrderAddress, derivePositionAddress, deriveVaultAddresses } from '../packages/sdk/src/plugin.js';
import { DISCRIMINATORS, MICRO_CLOB_PROGRAM_ID } from '../packages/sdk/src/constants.js';

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL       = process.env.NEXT_PUBLIC_RPC_URL    ?? 'https://api.devnet.solana.com';
const MARKET_ADDR   = process.env.MARKET_ADDRESS         ?? process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? '';
const TAKER_KEY     = process.env.TAKER_KEYPAIR          ?? `${process.env.HOME}/.config/solana/taker.json`;
const MAKER_ADDR    = process.env.MAKER_ADDRESS          ?? '';
const ORDER_ID      = BigInt(process.env.MAKER_ORDER_ID  ?? '0');
const PROGRAM_ID    = process.env.NEXT_PUBLIC_PROGRAM_ID ?? MICRO_CLOB_PROGRAM_ID;
const FILL_SIZE     = BigInt(1); // fill entire lot

async function main() {
  if (!MARKET_ADDR || !MAKER_ADDR) {
    console.error('❌ Set MARKET_ADDRESS and MAKER_ADDRESS env vars');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const takerKp    = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(TAKER_KEY, 'utf-8')) as number[]),
  );
  const programId  = new PublicKey(PROGRAM_ID);
  const marketPk   = new PublicKey(MARKET_ADDR);
  const makerPk    = new PublicKey(MAKER_ADDR);

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║         SequenceKit — Taker Demo (Terminal 2)            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  console.log(`Taker:      ${takerKp.publicKey.toBase58()}`);
  console.log(`Target order: ${ORDER_ID} (maker: ${MAKER_ADDR.slice(0,8)}…)\n`);

  // Read market to get mint addresses
  const marketInfo = await connection.getAccountInfo(marketPk);
  if (!marketInfo) { console.error('❌ Market not found'); process.exit(1); }

  const baseMint  = new PublicKey(marketInfo.data.slice(8+32, 8+64));
  const quoteMint = new PublicKey(marketInfo.data.slice(8+64, 8+96));
  const pluginActive = marketInfo.data[8+32+32+32+8+8] === 1;

  console.log(`MakerShield: ${pluginActive ? '🛡 ON (taker fill should FAIL)' : '○ OFF (fill may succeed)'}`);

  const { baseVault, quoteVault } = deriveVaultAddresses({ marketAddress: marketPk, programId });
  const [makerOrderPda]   = deriveOrderAddress({ marketAddress: marketPk, owner: makerPk, orderId: ORDER_ID, programId });
  const [makerPositionPda]= derivePositionAddress({ marketAddress: marketPk, owner: makerPk, programId });
  const [takerPositionPda]= derivePositionAddress({ marketAddress: marketPk, owner: takerKp.publicKey, programId });

  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  const takerBaseAta  = await getAssociatedTokenAddress(baseMint, takerKp.publicKey);
  const takerQuoteAta = await getAssociatedTokenAddress(quoteMint, takerKp.publicKey);
  const makerBaseAta  = await getAssociatedTokenAddress(baseMint, makerPk);
  const makerQuoteAta = await getAssociatedTokenAddress(quoteMint, makerPk);

  // Build fill_order instruction
  // disc(8) + maker_order_id(8) + fill_size_lots(8)
  const fillData = Buffer.alloc(24);
  Buffer.from(DISCRIMINATORS.fill_order).copy(fillData, 0);
  fillData.writeBigUInt64LE(ORDER_ID, 8);
  fillData.writeBigUInt64LE(FILL_SIZE, 16);

  const fillIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: marketPk,         isSigner: false, isWritable: true  },
      { pubkey: makerPk,          isSigner: false, isWritable: false },  // maker_order_owner
      { pubkey: makerOrderPda,    isSigner: false, isWritable: true  },
      { pubkey: makerPositionPda, isSigner: false, isWritable: true  },
      { pubkey: takerPositionPda, isSigner: false, isWritable: true  },
      { pubkey: baseVault,        isSigner: false, isWritable: true  },
      { pubkey: quoteVault,       isSigner: false, isWritable: true  },
      { pubkey: takerBaseAta,     isSigner: false, isWritable: true  },
      { pubkey: takerQuoteAta,    isSigner: false, isWritable: true  },
      { pubkey: makerBaseAta,     isSigner: false, isWritable: true  },
      { pubkey: makerQuoteAta,    isSigner: false, isWritable: true  },
      { pubkey: takerKp.publicKey, isSigner: true, isWritable: true  },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,         isSigner: false, isWritable: false },
    ],
    data: fillData,
  });

  console.log('\n⚡ Firing fill_order simultaneously with maker cancel...\n');

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const fillTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: takerKp.publicKey,
      recentBlockhash: blockhash,
      instructions: [fillIx],
    }).compileToV0Message(),
  );
  fillTx.sign([takerKp]);

  try {
    const sig = await connection.sendTransaction(fillTx, {
      skipPreflight: true, // send immediately, don't wait for preflight
    });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

    console.log('⚠️  Fill SUCCEEDED (MakerShield was OFF or non-BAM block)');
    console.log(`   Tx: ${sig}`);
    console.log('\n   This demonstrates the PROBLEM — without MakerShield,');
    console.log('   takers can fill stale maker orders.');

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('OrderNotFillable')) {
      console.log('✅ Fill REJECTED — OrderNotFillable');
      console.log('\n   ═══════════════════════════════════════════════════════');
      console.log('   ✅ MakerShield WORKED: cancel ran first, fill rejected!');
      console.log('   Maker is safe. No adverse selection. Spread stays tight.');
      console.log('   ═══════════════════════════════════════════════════════\n');
    } else {
      console.log('❌ Fill failed with unexpected error:', msg);
    }
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
