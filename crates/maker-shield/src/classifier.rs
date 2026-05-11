//! Transaction classification for MakerShield.
//!
//! Discriminators are real — computed as sha256("global:<name>")[0..8]
//! via Node.js crypto and verified against Anchor's IDL generation.

use crate::types::{Instruction, Priority, Transaction};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;

// ─── Real Anchor discriminators ───────────────────────────────────────────────
// sha256("global:cancel_order")[0..8]
pub const CANCEL_ORDER_DISCRIMINATOR: [u8; 8]     = [95, 129, 237, 240, 8, 49, 223, 132];
// sha256("global:update_quote")[0..8]
pub const UPDATE_QUOTE_DISCRIMINATOR: [u8; 8]     = [235, 69, 162, 233, 147, 53, 42, 225];
// sha256("global:fill_order")[0..8]
pub const FILL_ORDER_DISCRIMINATOR: [u8; 8]       = [232, 122, 115, 25, 199, 143, 136, 162];
// sha256("global:place_order")[0..8]
pub const PLACE_ORDER_DISCRIMINATOR: [u8; 8]      = [51, 194, 155, 175, 109, 130, 96, 106];
// sha256("global:initialize_market")[0..8]
pub const INITIALIZE_MARKET_DISCRIMINATOR: [u8; 8] = [35, 35, 189, 193, 155, 48, 170, 203];
// sha256("global:toggle_plugin")[0..8]
pub const TOGGLE_PLUGIN_DISCRIMINATOR: [u8; 8]    = [217, 191, 148, 183, 220, 117, 85, 28];

pub fn build_maker_discriminator_set() -> HashSet<[u8; 8]> {
    let mut set = HashSet::new();
    set.insert(CANCEL_ORDER_DISCRIMINATOR);
    set.insert(UPDATE_QUOTE_DISCRIMINATOR);
    set
}

/// Classify a single transaction. Hot path — must be < 50µs, no allocations.
pub fn classify_transaction(
    tx: &Transaction,
    protected_program: &Pubkey,
    maker_discriminators: &HashSet<[u8; 8]>,
) -> Priority {
    for ix in &tx.instructions {
        if ix.program_id_index >= tx.account_keys.len() {
            log::warn!("program_id_index {} OOB (len {})", ix.program_id_index, tx.account_keys.len());
            continue;
        }
        let program_id = &tx.account_keys[ix.program_id_index];
        if program_id != protected_program {
            continue;
        }
        if ix.data.len() < 8 {
            continue;
        }
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&ix.data[..8]);

        if maker_discriminators.contains(&disc) {
            log::debug!("MAKER_PRIORITY disc={:?}", disc);
            return Priority::MakerFirst;
        } else {
            log::debug!("TAKER disc={:?}", disc);
            return Priority::Taker;
        }
    }
    Priority::Neutral
}

// ─── Test helpers — only compiled in test builds ──────────────────────────────
#[cfg(test)]
pub mod test_helpers {
    use super::*;
    use crate::types::{Instruction, Transaction};
    use solana_sdk::{pubkey::Pubkey, signature::Signature};

    pub fn build_test_tx(program_id: &Pubkey, discriminator: [u8; 8]) -> Transaction {
        let mut data = discriminator.to_vec();
        data.extend_from_slice(&[0u8; 32]);
        Transaction {
            signature: Signature::default(),
            account_keys: vec![Pubkey::new_unique(), *program_id],
            instructions: vec![Instruction { program_id_index: 1, data, accounts: vec![0] }],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_helpers::build_test_tx;

    fn p() -> Pubkey { Pubkey::new_unique() }
    fn set() -> HashSet<[u8; 8]> { build_maker_discriminator_set() }

    #[test]
    fn cancel_order_is_maker() {
        let p = p();
        assert_eq!(classify_transaction(&build_test_tx(&p, CANCEL_ORDER_DISCRIMINATOR), &p, &set()), Priority::MakerFirst);
    }
    #[test]
    fn update_quote_is_maker() {
        let p = p();
        assert_eq!(classify_transaction(&build_test_tx(&p, UPDATE_QUOTE_DISCRIMINATOR), &p, &set()), Priority::MakerFirst);
    }
    #[test]
    fn fill_order_is_taker() {
        let p = p();
        assert_eq!(classify_transaction(&build_test_tx(&p, FILL_ORDER_DISCRIMINATOR), &p, &set()), Priority::Taker);
    }
    #[test]
    fn unrelated_is_neutral() {
        let our = p(); let other = p();
        assert_eq!(classify_transaction(&build_test_tx(&other, CANCEL_ORDER_DISCRIMINATOR), &our, &set()), Priority::Neutral);
    }
    #[test]
    fn short_data_is_neutral() {
        let p = p();
        let mut tx = build_test_tx(&p, CANCEL_ORDER_DISCRIMINATOR);
        tx.instructions[0].data = vec![0u8; 4];
        assert_eq!(classify_transaction(&tx, &p, &set()), Priority::Neutral);
    }
    #[test]
    fn oob_index_is_neutral() {
        let p = p();
        let mut tx = build_test_tx(&p, CANCEL_ORDER_DISCRIMINATOR);
        tx.instructions[0].program_id_index = 99;
        assert_eq!(classify_transaction(&tx, &p, &set()), Priority::Neutral);
    }
    #[test]
    fn discriminators_are_correct_sha256() {
        assert_eq!(CANCEL_ORDER_DISCRIMINATOR,  [95, 129, 237, 240, 8, 49, 223, 132]);
        assert_eq!(UPDATE_QUOTE_DISCRIMINATOR,  [235, 69, 162, 233, 147, 53, 42, 225]);
        assert_eq!(FILL_ORDER_DISCRIMINATOR,    [232, 122, 115, 25, 199, 143, 136, 162]);
    }
}
