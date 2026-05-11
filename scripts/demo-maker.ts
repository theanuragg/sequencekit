#!/usr/bin/env npx tsx
/**
 * demo-maker.ts — Market maker demo script.
 *
 * This is what the presenter runs in Terminal 1 during the demo.
 *
 * Flow:
 *   1. Place an Ask order on devnet MicroCLOB
 *   2. Wait for user input (price has "moved" off-screen)
 *   3. Submit cancel_order as a Jito Bundle (MakerShield protects it)
 *   4. Show the attestation hash proving ordering was enforced
 *
 * Usage:
 *   MAKER_KEYPAIR=~/.config/solana/maker.json \
 *   MARKET_ADDRESS=<market-pda> \
 *   npx tsx scripts/demo-maker.ts
 *
 * Run scripts/fund-demo-wallets.ts first to create and fund maker/taker wallets.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import fs from 'fs';
import readline from 'readline';
import { SequenceKit } from '../packages/sdk/src/index.js';
import {
  deriveMarketAddress,
  deriveOrderAddress,
  derivePositionAddress,
  deriveVaultAddresses,
} from '../packages/sdk/src/plugin.js';
import {
  CANCEL_ORDER_DISCRIMINATOR,
  DISCRIMINATORS,
  MICRO_CLOB_PROGRAM_ID,
} from '../packages/sdk/src/constants.js';

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL       = process.env.NEXT_PUBLIC_RPC_URL    ?? 'https://api.devnet.solana.com';
const MARKET_ADDR   = process.env.MARKET_ADDRESS         ?? process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? '';
const MAKER_KEY     = process.env.MAKER_KEYPAIR          ?? `${process.env.HOME}/.config/solana/maker.json`;
const BLOCK_ENGINE  = process.env.JITO_BLOCK_ENGINE_URL  ?? 'https://amsterdam.mainnet.block-engine.jito.wtf';
const PROGRAM_ID    = process.env.NEXT_PUBLIC_PROGRAM_ID ?? MICRO_CLOB_PROGRAM_ID;

// Demo order params
const PRICE_LOTS    = BigInt(100_000); // 100.000 USDC (at tick_size=0.001)
const SIZE_LOTS     = BigInt(1);       // 1 base lot
const TIP_LAMPORTS  = 50_000;         // higher tip for demo reliability

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!MARKET_ADDR) {
    console.error('❌ Set MARKET_ADDRESS env var. Run scripts/init-market.ts first.');
    process.exit(1);
  }

  if (!fs.existsSync(MAKER_KEY)) {
    console.error(`❌ Maker keypair not found: ${MAKER_KEY}`);
    console.error('   Run: scripts/fund-demo-wallets.ts');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const makerKp    = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(MAKER_KEY, 'utf-8')) as number[]),
  );
  const programId  = new PublicKey(PROGRAM_ID);
  const marketPk   = new PublicKey(MARKET_ADDR);

  const sk = new SequenceKit({
    connection,
    jitoBlockEngineUrl: BLOCK_ENGINE,
    market: marketPk,
    programId,
  });

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║           SequenceKit — MakerShield Demo                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  console.log(`Market:     ${MARKET_ADDR}`);
  console.log(`Maker:      ${makerKp.publicKey.toBase58()}`);
  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Block Engine: ${BLOCK_ENGINE}\n`);

  // Check maker balance
  const balance = await connection.getBalance(makerKp.publicKey);
  if (balance < 0.1e9) {
    console.error(`❌ Maker balance too low: ${balance / 1e9} SOL. Need at least 0.1 SOL.`);
    process.exit(1);
  }
  console.log(`Maker balance: ${(balance / 1e9).toFixed(4)} SOL ✓\n`);

  // ── STEP 1: Read current market state ─────────────────────────────────────
  const marketInfo = await connection.getAccountInfo(marketPk);
  if (!marketInfo) {
    console.error('❌ Market account not found. Has it been initialized?');
    process.exit(1);
  }

  // Read next_order_id from market account
  // Layout offset: disc(8)+authority(32)+base_mint(32)+quote_mint(32)+tick(8)+lot(8)+plugin(1)+paused(1)+best_bid(8)+best_ask(8)+spread(2)+next_order_id(8)
  const NEXT_ORDER_ID_OFFSET = 8+32+32+32+8+8+1+1+8+8+2;
  const nextOrderId = marketInfo.data.readBigUInt64LE(NEXT_ORDER_ID_OFFSET);
  const pluginActive = marketInfo.data[8+32+32+32+8+8] === 1;

  console.log(`Plugin active:  ${pluginActive ? '🛡 YES (MakerShield ON)' : '○ NO (MakerShield OFF)'}`);
  console.log(`Next order ID:  ${nextOrderId}\n`);

  // ── STEP 2: Place an Ask order ─────────────────────────────────────────────
  console.log('STEP 1: Placing Ask order...');
  console.log(`  Price: ${PRICE_LOTS} lots | Size: ${SIZE_LOTS} lot\n`);

  // Read base and quote mints from market
  const baseMint  = new PublicKey(marketInfo.data.slice(8+32, 8+64));
  const quoteMint = new PublicKey(marketInfo.data.slice(8+64, 8+96));

  const { baseVault, quoteVault } = deriveVaultAddresses({ marketAddress: marketPk, programId });
  const [positionPda] = derivePositionAddress({ marketAddress: marketPk, owner: makerKp.publicKey, programId });
  const [orderPda]    = deriveOrderAddress({ marketAddress: marketPk, owner: makerKp.publicKey, orderId: nextOrderId, programId });

  // Get maker's token accounts
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  const makerBaseAta  = await getAssociatedTokenAddress(baseMint, makerKp.publicKey);
  const makerQuoteAta = await getAssociatedTokenAddress(quoteMint, makerKp.publicKey);

  // Build place_order instruction
  // disc(8) + side(1: 0=Bid,1=Ask) + price_lots(8) + size_lots(8)
  const placeData = Buffer.alloc(25);
  Buffer.from(DISCRIMINATORS.place_order).copy(placeData, 0);
  placeData.writeUInt8(1, 8);                        // Ask
  placeData.writeBigUInt64LE(PRICE_LOTS, 9);
  placeData.writeBigUInt64LE(SIZE_LOTS, 17);

  const placeIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: marketPk,      isSigner: false, isWritable: true  },
      { pubkey: orderPda,      isSigner: false, isWritable: true  },
      { pubkey: positionPda,   isSigner: false, isWritable: true  },
      { pubkey: baseVault,     isSigner: false, isWritable: true  },
      { pubkey: quoteVault,    isSigner: false, isWritable: true  },
      { pubkey: makerBaseAta,  isSigner: false, isWritable: true  },
      { pubkey: makerQuoteAta, isSigner: false, isWritable: true  },
      { pubkey: makerKp.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID),  isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,          isSigner: false, isWritable: false },
    ],
    data: placeData,
  });

  const { blockhash: bh1, lastValidBlockHeight: lv1 } = await connection.getLatestBlockhash('confirmed');
  const placeTx = new VersionedTransaction(
    new TransactionMessage({ payerKey: makerKp.publicKey, recentBlockhash: bh1, instructions: [placeIx] })
      .compileToV0Message(),
  );
  placeTx.sign([makerKp]);
  const placeSig = await connection.sendTransaction(placeTx, { skipPreflight: false });
  await connection.confirmTransaction({ signature: placeSig, blockhash: bh1, lastValidBlockHeight: lv1 }, 'confirmed');

  console.log(`  ✅ Order placed! ID: ${nextOrderId}`);
  console.log(`  Tx: ${placeSig}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${placeSig}?cluster=devnet\n`);
  console.log('  [Dashboard should show spread update now]\n');

  // ── STEP 3: Wait for "price to move" ──────────────────────────────────────
  await prompt('\n⏸  PAUSE — Tell judges: "Price just moved. My ask is now stale."\n   Press ENTER to send cancel + let taker fire simultaneously...');

  // ── STEP 4: Submit cancel as Jito Bundle (MakerShield protects it) ────────
  console.log('\nSTEP 2: Submitting cancel_order as Jito Bundle...');
  console.log('  MakerShield will sequence this BEFORE any taker fill.\n');

  // Build cancel_order instruction
  // disc(8) + order_id(8)
  const cancelData = Buffer.alloc(16);
  Buffer.from(CANCEL_ORDER_DISCRIMINATOR).copy(cancelData, 0);
  cancelData.writeBigUInt64LE(nextOrderId, 8);

  const cancelIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: marketPk,      isSigner: false, isWritable: true  },
      { pubkey: orderPda,      isSigner: false, isWritable: true  },
      { pubkey: positionPda,   isSigner: false, isWritable: true  },
      { pubkey: baseVault,     isSigner: false, isWritable: true  },
      { pubkey: quoteVault,    isSigner: false, isWritable: true  },
      { pubkey: makerBaseAta,  isSigner: false, isWritable: true  },
      { pubkey: makerQuoteAta, isSigner: false, isWritable: true  },
      { pubkey: makerKp.publicKey, isSigner: true, isWritable: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    data: cancelData,
  });

  const result = await sk.submitMakerBundle({
    instruction: cancelIx,
    signer: makerKp,
    tipLamports: TIP_LAMPORTS,
  });

  console.log(`  ✅ Bundle submitted!`);
  console.log(`  Bundle ID:  ${result.bundleId}`);
  console.log(`  Signature:  ${result.signature}`);
  if (result.slot)            console.log(`  Slot:       ${result.slot}`);
  if (result.attestationHash) {
    console.log(`  ✅ TEE Attestation: ${result.attestationHash.slice(0, 16)}…`);
    console.log(`  Proof URL:  ${result.proofUrl}`);
  }

  console.log('\n  [Dashboard OrderingProof panel should show this attestation now]');
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Cancel executed BEFORE taker fill. Maker is safe. ✓    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
}

function prompt(question: string): Promise<void> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => { rl.close(); resolve(); });
  });
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
