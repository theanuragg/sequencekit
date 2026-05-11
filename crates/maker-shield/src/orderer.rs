//! Transaction ordering logic for MakerShield.
//!
//! Takes a batch of classified transactions and returns them in the
//! correct execution order: MAKER_PRIORITY first, then everything else.
//!
//! The sort is STABLE — relative order within each group is preserved.
//! This matters when multiple makers cancel in the same slot; they should
//! execute in the order they arrived, not arbitrarily reordered.

use crate::types::{Priority, Transaction, TxMetadata};

/// Order a batch of transactions for a single slot.
///
/// Algorithm:
///   1. Stable-partition into (MAKER_PRIORITY, rest)
///   2. Concatenate: [makers] ++ [rest]
///   3. Return flattened Vec<Transaction>
///
/// Time complexity: O(n) where n = number of transactions in the slot.
/// Space: O(n) — two temporary Vecs.
///
/// Called once per slot. Must complete in < 2ms.
pub fn order_transactions_by_priority(
    txs: Vec<(Transaction, TxMetadata)>,
) -> Vec<Transaction> {
    let total = txs.len();
    let mut makers: Vec<Transaction> = Vec::with_capacity(total / 4); // makers typically ~25%
    let mut rest: Vec<Transaction> = Vec::with_capacity(total);

    for (tx, meta) in txs {
        match meta.priority {
            Priority::MakerFirst => makers.push(tx),
            Priority::Taker | Priority::Neutral => rest.push(tx),
        }
    }

    log::debug!(
        "Slot ordering: {} MAKER_PRIORITY, {} TAKER/NEUTRAL, {} total",
        makers.len(),
        rest.len(),
        total
    );

    // Stable concatenation — makers first, then takers, then neutrals
    makers.extend(rest);
    makers
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Instruction, Priority, Transaction, TxMetadata};
    use solana_sdk::{pubkey::Pubkey, signature::Signature};

    fn make_tx(label: u8) -> Transaction {
        Transaction {
            // Use the label byte in the signature so we can identify txs
            signature: Signature::new(&[label; 64]),
            account_keys: vec![Pubkey::new_unique()],
            instructions: vec![Instruction {
                program_id_index: 0,
                data: vec![label; 8],
                accounts: vec![],
            }],
        }
    }

    fn tagged(tx: Transaction, priority: Priority) -> (Transaction, TxMetadata) {
        (tx, TxMetadata { priority })
    }

    #[test]
    fn makers_come_before_takers() {
        let taker1 = make_tx(1);
        let maker1 = make_tx(2);
        let taker2 = make_tx(3);
        let maker2 = make_tx(4);

        let input = vec![
            tagged(taker1.clone(), Priority::Taker),
            tagged(maker1.clone(), Priority::MakerFirst),
            tagged(taker2.clone(), Priority::Taker),
            tagged(maker2.clone(), Priority::MakerFirst),
        ];

        let ordered = order_transactions_by_priority(input);

        // First two must be makers, in their original relative order
        assert_eq!(ordered[0].signature, maker1.signature);
        assert_eq!(ordered[1].signature, maker2.signature);
        // Last two are takers, in original relative order
        assert_eq!(ordered[2].signature, taker1.signature);
        assert_eq!(ordered[3].signature, taker2.signature);
    }

    #[test]
    fn neutral_txs_go_after_makers() {
        let neutral = make_tx(10);
        let maker = make_tx(20);

        let input = vec![
            tagged(neutral.clone(), Priority::Neutral),
            tagged(maker.clone(), Priority::MakerFirst),
        ];

        let ordered = order_transactions_by_priority(input);
        assert_eq!(ordered[0].signature, maker.signature);
        assert_eq!(ordered[1].signature, neutral.signature);
    }

    #[test]
    fn stable_within_maker_group() {
        // Three makers — must stay in original order
        let m1 = make_tx(1);
        let m2 = make_tx(2);
        let m3 = make_tx(3);

        let input = vec![
            tagged(m1.clone(), Priority::MakerFirst),
            tagged(m2.clone(), Priority::MakerFirst),
            tagged(m3.clone(), Priority::MakerFirst),
        ];

        let ordered = order_transactions_by_priority(input);
        assert_eq!(ordered[0].signature, m1.signature);
        assert_eq!(ordered[1].signature, m2.signature);
        assert_eq!(ordered[2].signature, m3.signature);
    }

    #[test]
    fn empty_input_returns_empty() {
        let ordered = order_transactions_by_priority(vec![]);
        assert!(ordered.is_empty());
    }

    #[test]
    fn all_makers_no_crash() {
        let input = (0u8..10)
            .map(|i| tagged(make_tx(i), Priority::MakerFirst))
            .collect();
        let ordered = order_transactions_by_priority(input);
        assert_eq!(ordered.len(), 10);
    }

    #[test]
    fn all_takers_no_crash() {
        let input = (0u8..10)
            .map(|i| tagged(make_tx(i), Priority::Taker))
            .collect();
        let ordered = order_transactions_by_priority(input);
        assert_eq!(ordered.len(), 10);
    }
}
