#!/usr/bin/env npx tsx
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';

const RPC_URL    = process.env.NEXT_PUBLIC_RPC_URL    ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ?? 'D2hmjC142DkGTZg8u8EXig3Kxci3nU7Qo8WLvwzrfoie';
const WALLET     = process.env.ANCHOR_WALLET           ?? `${process.env.HOME}/.config/solana/id.json`;

const WSOL_MINT  = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT  = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const TICK_SIZE  = 1_000n;
const LOT_SIZE   = 100_000n;

const INIT_DISC = Buffer.from([35, 35, 189, 193, 155, 48, 170, 203]);
const CREATE_VAULTS_DISC = Buffer.from([79, 9, 204, 64, 64, 120, 98, 137]);

async function main() {
  if (!fs.existsSync(WALLET)) {
    console.error(`Wallet not found: ${WALLET}`);
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const authority  = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET, 'utf-8')) as number[]),
  );
  const programId  = new PublicKey(PROGRAM_ID);

  console.log('\n SequenceKit — Init Market\n');
  console.log(`Program:    ${PROGRAM_ID}`);
  console.log(`Authority:  ${authority.publicKey.toBase58()}`);
  console.log(`RPC:        ${RPC_URL}`);

  const balance = await connection.getBalance(authority.publicKey);
  if (balance < 0.05e9) {
    console.error(`\n Insufficient SOL: ${balance / 1e9}. Need at least 0.05 SOL.`);
    process.exit(1);
  }
  console.log(`Balance:    ${(balance / 1e9).toFixed(4)} SOL\n`);

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), WSOL_MINT.toBuffer(), USDC_MINT.toBuffer()],
    programId,
  );
  const [baseVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('base_vault'), marketPda.toBuffer()], programId,
  );
  const [quoteVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('quote_vault'), marketPda.toBuffer()], programId,
  );

  console.log(`Market PDA:      ${marketPda.toBase58()}`);
  console.log(`Base vault PDA:  ${baseVaultPda.toBase58()}`);
  console.log(`Quote vault PDA: ${quoteVaultPda.toBase58()}\n`);

  const existing = await connection.getAccountInfo(marketPda);
  if (existing) {
    console.log('Market already initialised.\n');
    printEnvInstructions(marketPda.toBase58(), authority.publicKey.toBase58());
    return;
  }

  const initData = Buffer.alloc(24);
  INIT_DISC.copy(initData, 0);
  initData.writeBigUInt64LE(TICK_SIZE, 8);
  initData.writeBigUInt64LE(LOT_SIZE, 16);

  const initIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: marketPda,           isSigner: false, isWritable: true  },
      { pubkey: WSOL_MINT,           isSigner: false, isWritable: false },
      { pubkey: USDC_MINT,           isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initData,
  });

  const vaultsIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: marketPda,           isSigner: false, isWritable: true  },
      { pubkey: baseVaultPda,        isSigner: false, isWritable: true  },
      { pubkey: quoteVaultPda,       isSigner: false, isWritable: true  },
      { pubkey: WSOL_MINT,           isSigner: false, isWritable: false },
      { pubkey: USDC_MINT,           isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,  isSigner: false, isWritable: false },
    ],
    data: CREATE_VAULTS_DISC,
  });

  console.log('Sending initialize_market + create_vaults transaction…\n');

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [initIx, vaultsIx],
    }).compileToV0Message(),
  );
  tx.sign([authority]);

  const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  console.log(`Market + vaults initialised!`);
  console.log(`   Tx: https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);

  printEnvInstructions(marketPda.toBase58(), authority.publicKey.toBase58());
}

function printEnvInstructions(marketAddr: string, authorityAddr: string) {
  console.log('Add to apps/dashboard/.env.local:');
  console.log(`  NEXT_PUBLIC_MARKET_ADDRESS=${marketAddr}`);
  console.log(`  NEXT_PUBLIC_DEMO_MAKER_ADDRESS=${authorityAddr}`);
  console.log('');
  console.log('Next steps:');
  console.log('  make fund-demo');
  console.log('  make dev');
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
