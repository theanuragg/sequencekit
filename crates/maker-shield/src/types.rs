//! Core types for the MakerShield plugin.
//!
//! In production these come from `bam-plugin-sdk` (Jito private crate).
//! We define compatible types here so the plugin logic compiles and tests
//! independently. The real BAM node ABI uses extern "C" with concrete
//! structs — see lib.rs create_plugin().

use crate::attestation::Attestation;
use solana_sdk::{pubkey::Pubkey, signature::Signature};

// ─── Transaction (mirrors solana_sdk VersionedTransaction fields the plugin needs) ──

#[derive(Debug, Clone)]
pub struct Transaction {
    pub signature: Signature,
    pub instructions: Vec<Instruction>,
    pub account_keys: Vec<Pubkey>,
}

#[derive(Debug, Clone)]
pub struct Instruction {
    /// Index into Transaction.account_keys for the program being called.
    pub program_id_index: usize,
    /// Raw instruction data. First 8 bytes = Anchor discriminator.
    pub data: Vec<u8>,
    pub accounts: Vec<u8>,
}

// ─── Priority ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Priority {
    /// cancel_order or update_quote calling the protected program.
    /// Sequenced FIRST in the block.
    MakerFirst,
    /// Any other instruction calling the protected program (fill_order etc).
    /// Sequenced AFTER all MakerFirst.
    Taker,
    /// Unrelated program — pass through without reordering.
    Neutral,
}

impl Default for Priority {
    fn default() -> Self { Priority::Neutral }
}

// ─── TxMetadata ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct TxMetadata {
    pub priority: Priority,
}

// ─── Block ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Block {
    pub slot: u64,
    pub transactions: Vec<Transaction>,
    pub block_time: i64,
}

// ─── SchedulerPlugin ──────────────────────────────────────────────────────────
// This trait models what the BAM plugin SDK expects.
// Send + Sync required — BAM node may call from multiple threads.

pub trait SchedulerPlugin: Send + Sync {
    fn on_tx_received(&self, tx: &Transaction) -> TxMetadata;
    fn order_transactions(&self, txs: Vec<(Transaction, TxMetadata)>) -> Vec<Transaction>;
    fn on_block_produced(&self, block: &Block) -> Attestation;
}
