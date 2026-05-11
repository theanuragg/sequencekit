//! MakerShield BAM Plugin
//!
//! Enforces cancel-before-fill transaction ordering inside AMD SEV-SNP TEE.
//! Loaded by BAM node via dlopen — entry point is create_plugin().

pub mod attestation;
pub mod classifier;
pub mod orderer;
pub mod types;

use crate::{
    attestation::Attestation,
    classifier::{build_maker_discriminator_set, classify_transaction},
    orderer::order_transactions_by_priority,
    types::{Block, Priority, SchedulerPlugin, Transaction, TxMetadata},
};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use std::str::FromStr;

pub struct MakerShieldPlugin {
    protected_program: Pubkey,
    maker_discriminators: HashSet<[u8; 8]>,
}

impl MakerShieldPlugin {
    pub fn new(protected_program: Pubkey) -> Self {
        Self {
            protected_program,
            maker_discriminators: build_maker_discriminator_set(),
        }
    }

    pub fn from_env() -> Self {
        let program_id = std::env::var("MAKERSHIELD_PROGRAM_ID")
            .ok()
            .and_then(|s| Pubkey::from_str(&s).ok())
            .unwrap_or_else(|| {
                log::warn!("MAKERSHIELD_PROGRAM_ID not set — plugin will pass all txs through");
                Pubkey::default()
            });
        log::info!("MakerShield protecting program: {}", program_id);
        Self::new(program_id)
    }
}

impl SchedulerPlugin for MakerShieldPlugin {
    fn on_tx_received(&self, tx: &Transaction) -> TxMetadata {
        TxMetadata {
            priority: classify_transaction(tx, &self.protected_program, &self.maker_discriminators),
        }
    }

    fn order_transactions(&self, txs: Vec<(Transaction, TxMetadata)>) -> Vec<Transaction> {
        order_transactions_by_priority(txs)
    }

    fn on_block_produced(&self, block: &Block) -> Attestation {
        Attestation::build(block, env!("CARGO_PKG_VERSION"), &self.protected_program)
    }
}

/// C-ABI entry point called by BAM node's dlopen loader.
/// Returns raw pointer — BAM node owns the lifetime.
#[no_mangle]
pub extern "C" fn create_plugin() -> *mut MakerShieldPlugin {
    env_logger::try_init().ok();
    Box::into_raw(Box::new(MakerShieldPlugin::from_env()))
}

/// Called by BAM node when session ends.
/// # Safety: ptr must have come from create_plugin and not been freed.
#[no_mangle]
pub unsafe extern "C" fn destroy_plugin(ptr: *mut MakerShieldPlugin) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}
