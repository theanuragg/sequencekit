#!/usr/bin/env npx tsx
/**
 * fund-demo-wallets.ts
 *
 * Creates and funds maker + taker wallets for the demo.
 * Run this ONCE before the demo.
 *
 * Creates:
 *   ~/.config/solana/maker.json  — market maker keypair
 *   ~/.config/solana/taker.json  — taker keypair
 *
 * Airdrops 2 SOL to each on devnet.
 * Also creates associated token accounts for the demo market's mints.
 *
 * Usage:
 *   MARKET_ADDRESS=<market-pda> npx tsx scripts/fund-demo-wallets.ts
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const RPC_URL     = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';
const MARKET_ADDR = process.env.MARKET_ADDRESS ?? process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? '';
const PROGRAM_ID  = process.env.NEXT_PUBLIC_PROGRAM_ID ?? '93bKGD7STjvA2h4if8cs4sVxJqtUmxmh8tYFBaRhEgsn';
const SOLANA_DIR  = `${process.env.HOME}/.config/solana`;

async function createOrLoadKeypair(filePath: string): Promise<Keypair> {
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`Created keypair: ${filePath}`);
  return kp;
}

async function airdrop(connection: Connection, pubkey: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
}

async function main() {
  if (!MARKET_ADDR) {
    console.error('❌ Set MARKET_ADDRESS. Run scripts/init-market.ts first.');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║          SequenceKit — Fund Demo Wallets                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Create/load wallets
  const maker = await createOrLoadKeypair(`${SOLANA_DIR}/maker.json`);
  const taker = await createOrLoadKeypair(`${SOLANA_DIR}/taker.json`);

  console.log(`Maker: ${maker.publicKey.toBase58()}`);
  console.log(`Taker: ${taker.publicKey.toBase58()}\n`);

  // Read market to get mint addresses
  const marketPk   = new PublicKey(MARKET_ADDR);
  const marketInfo = await connection.getAccountInfo(marketPk);
  if (!marketInfo) { console.error('❌ Market not found'); process.exit(1); }

  const baseMint  = new PublicKey(marketInfo.data.slice(8+32, 8+64));
  const quoteMint = new PublicKey(marketInfo.data.slice(8+64, 8+96));
  console.log(`Base mint:  ${baseMint.toBase58()}`);
  console.log(`Quote mint: ${quoteMint.toBase58()}\n`);

  // Airdrop SOL
  console.log('Airdropping SOL...');
  const makerBal = await connection.getBalance(maker.publicKey);
  const takerBal = await connection.getBalance(taker.publicKey);

  if (makerBal < 0.5 * LAMPORTS_PER_SOL) {
    await airdrop(connection, maker.publicKey, 2);
    console.log('  ✓ Maker: 2 SOL airdropped');
  } else {
    console.log(`  ✓ Maker: ${makerBal/LAMPORTS_PER_SOL} SOL (already funded)`);
  }

  if (takerBal < 0.5 * LAMPORTS_PER_SOL) {
    await airdrop(connection, taker.publicKey, 2);
    console.log('  ✓ Taker: 2 SOL airdropped');
  } else {
    console.log(`  ✓ Taker: ${takerBal/LAMPORTS_PER_SOL} SOL (already funded)`);
  }

  // Create associated token accounts
  const { createAssociatedTokenAccountIdempotent, mintTo, getOrCreateAssociatedTokenAccount } = await import('@solana/spl-token');
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${SOLANA_DIR}/id.json`, 'utf-8')) as number[]),
  );

  console.log('\nCreating token accounts and minting demo tokens...');

  const makerBaseAta = await getOrCreateAssociatedTokenAccount(connection, maker, baseMint, maker.publicKey);
  const makerQuoteAta = await getOrCreateAssociatedTokenAccount(connection, maker, quoteMint, maker.publicKey);
  const takerBaseAta = await getOrCreateAssociatedTokenAccount(connection, taker, baseMint, taker.publicKey);
  const takerQuoteAta = await getOrCreateAssociatedTokenAccount(connection, taker, quoteMint, taker.publicKey);

  // Mint demo tokens (authority must be mint authority)
  try {
    await mintTo(connection, authority, baseMint,  makerBaseAta.address,  authority, 100e9);  // 100 SOL worth
    await mintTo(connection, authority, quoteMint, takerQuoteAta.address, authority, 10_000e6); // 10k USDC
    console.log('  ✓ Minted 100 base tokens to maker');
    console.log('  ✓ Minted 10,000 quote tokens to taker');
  } catch (e) {
    console.warn('  ⚠ Could not mint — authority may not be mint authority:', e instanceof Error ? e.message : e);
  }

  console.log('\n✅ Demo wallets ready!\n');
  console.log('Run the demo:');
  console.log(`  Terminal 1: MARKET_ADDRESS=${MARKET_ADDR} npx tsx scripts/demo-maker.ts`);
  console.log(`  Terminal 2: MARKET_ADDRESS=${MARKET_ADDR} MAKER_ADDRESS=${maker.publicKey.toBase58()} npx tsx scripts/demo-taker.ts\n`);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
