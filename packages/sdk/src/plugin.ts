/**
 * plugin.ts — MakerShield plugin control helpers.
 *
 * Provides typed wrappers for interacting with the plugin_active flag
 * on the MicroCLOB Market account, and utilities for building
 * MAKER-tagged instructions that MakerShield will prioritize.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOGGLE_PLUGIN_DISCRIMINATOR, MICRO_CLOB_PROGRAM_ID } from './constants.js';
import type { SequenceKitConfig, SpreadInfo } from './types.js';

/**
 * Build a toggle_plugin instruction for the MicroCLOB program.
 *
 * This instruction sets market.plugin_active = active on-chain.
 * When active = true, MakerShield enforces MAKER_PRIORITY ordering
 * for cancel_order and update_quote transactions on this market.
 *
 * Must be signed by the market authority.
 */
export function buildTogglePluginInstruction(params: {
  marketAddress: PublicKey;
  authority: PublicKey;
  active: boolean;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? new PublicKey(MICRO_CLOB_PROGRAM_ID);

  // Instruction data: discriminator(8) + active(1)
  const data = Buffer.alloc(9);
  Buffer.from(TOGGLE_PLUGIN_DISCRIMINATOR).copy(data, 0);
  data.writeUInt8(params.active ? 1 : 0, 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.marketAddress, isSigner: false, isWritable: true },
      { pubkey: params.authority,     isSigner: true,  isWritable: false },
    ],
    data,
  });
}

/**
 * Activate MakerShield for a market.
 *
 * Sends a toggle_plugin(true) transaction signed by the market authority.
 * After this call, all cancel_order and update_quote transactions on
 * this market will be tagged MAKER_PRIORITY by the BAM plugin.
 *
 * @returns On-chain transaction signature
 */
export async function activateMakerShield(params: {
  connection: Connection;
  marketAddress: PublicKey;
  authority: Keypair;
  programId?: PublicKey;
}): Promise<string> {
  return sendTogglePlugin({ ...params, active: true });
}

/**
 * Deactivate MakerShield for a market.
 * MakerShield plugin will revert to pass-through (NEUTRAL) mode.
 */
export async function deactivateMakerShield(params: {
  connection: Connection;
  marketAddress: PublicKey;
  authority: Keypair;
  programId?: PublicKey;
}): Promise<string> {
  return sendTogglePlugin({ ...params, active: false });
}

/**
 * Check whether MakerShield is currently active for a market.
 * Reads the on-chain Market account directly.
 */
export async function isMakerShieldActive(params: {
  connection: Connection;
  marketAddress: PublicKey;
}): Promise<boolean> {
  const info = await params.connection.getAccountInfo(params.marketAddress);
  if (!info) throw new Error(`Market not found: ${params.marketAddress.toBase58()}`);

  // Market account layout (after 8-byte discriminator):
  // authority(32) + base_mint(32) + quote_mint(32) + tick_size(8) + lot_size(8) + plugin_active(1)
  const PLUGIN_ACTIVE_OFFSET = 8 + 32 + 32 + 32 + 8 + 8;
  return info.data[PLUGIN_ACTIVE_OFFSET] === 1;
}

/**
 * Derive the Market PDA address from base and quote mint addresses.
 *
 * Seeds: ["market", baseMint, quoteMint]
 * This is the canonical way to find a market address.
 */
export function deriveMarketAddress(params: {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  programId?: PublicKey;
}): [PublicKey, number] {
  const programId = params.programId ?? new PublicKey(MICRO_CLOB_PROGRAM_ID);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), params.baseMint.toBuffer(), params.quoteMint.toBuffer()],
    programId,
  );
}

/**
 * Derive the vault PDA addresses for a market.
 * These hold locked collateral for open orders.
 */
export function deriveVaultAddresses(params: {
  marketAddress: PublicKey;
  programId?: PublicKey;
}): { baseVault: PublicKey; quoteVault: PublicKey } {
  const programId = params.programId ?? new PublicKey(MICRO_CLOB_PROGRAM_ID);
  const [baseVault]  = PublicKey.findProgramAddressSync(
    [Buffer.from('base_vault'),  params.marketAddress.toBuffer()], programId,
  );
  const [quoteVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('quote_vault'), params.marketAddress.toBuffer()], programId,
  );
  return { baseVault, quoteVault };
}

/**
 * Derive the Order PDA address for a specific order.
 */
export function deriveOrderAddress(params: {
  marketAddress: PublicKey;
  owner: PublicKey;
  orderId: bigint;
  programId?: PublicKey;
}): [PublicKey, number] {
  const programId = params.programId ?? new PublicKey(MICRO_CLOB_PROGRAM_ID);
  const orderIdBuf = Buffer.alloc(8);
  orderIdBuf.writeBigUInt64LE(params.orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('order'), params.marketAddress.toBuffer(), params.owner.toBuffer(), orderIdBuf],
    programId,
  );
}

/**
 * Derive the UserPosition PDA for a (market, owner) pair.
 */
export function derivePositionAddress(params: {
  marketAddress: PublicKey;
  owner: PublicKey;
  programId?: PublicKey;
}): [PublicKey, number] {
  const programId = params.programId ?? new PublicKey(MICRO_CLOB_PROGRAM_ID);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), params.marketAddress.toBuffer(), params.owner.toBuffer()],
    programId,
  );
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function sendTogglePlugin(params: {
  connection: Connection;
  marketAddress: PublicKey;
  authority: Keypair;
  active: boolean;
  programId?: PublicKey;
}): Promise<string> {
  const ix = buildTogglePluginInstruction({
    marketAddress: params.marketAddress,
    authority: params.authority.publicKey,
    active: params.active,
    programId: params.programId,
  });

  const { blockhash, lastValidBlockHeight } =
    await params.connection.getLatestBlockhash('confirmed');

  const message = new TransactionMessage({
    payerKey: params.authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([params.authority]);

  const signature = await params.connection.sendTransaction(tx, {
    skipPreflight: false,
    maxRetries: 3,
  });

  await params.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  );

  return signature;
}
