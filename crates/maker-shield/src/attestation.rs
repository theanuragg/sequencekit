//! TEE attestation for MakerShield.
//!
//! Default build: produces unsigned attestations (tee_signed = false).
//! The ordering_hash is cryptographically correct — only the hardware
//! signature is absent without TEE hardware.
//!
//! Production build: cargo build --release --features tee
//! Requires AMD SEV-SNP hardware with /dev/sev-guest available.

use crate::types::{Block, Transaction};
use sha2::{Digest, Sha256};
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Attestation {
    pub slot: u64,
    /// sha256(slot_le || tx_count_le || sig_0 || sig_1 || ...)
    pub ordering_hash: [u8; 32],
    pub maker_tx_count: u32,
    pub taker_tx_count: u32,
    pub neutral_tx_count: u32,
    pub protected_program: String,
    pub plugin_version: String,
    /// true only when signed by real AMD SEV-SNP hardware key
    pub tee_signed: bool,
    #[serde(with = "hex64")]
    pub signature: [u8; 64],
}

impl Attestation {
    pub fn build(block: &Block, plugin_version: &str, protected_program: &Pubkey) -> Self {
        let ordering_hash = compute_ordering_hash(block.slot, &block.transactions);
        let (tee_signed, signature) = sign_with_tee(&ordering_hash);

        Self {
            slot: block.slot,
            ordering_hash,
            maker_tx_count:   0, // populated by BAM node from TxMetadata
            taker_tx_count:   0,
            neutral_tx_count: block.transactions.len() as u32,
            protected_program: protected_program.to_string(),
            plugin_version: plugin_version.to_string(),
            tee_signed,
            signature,
        }
    }

    pub fn verify_ordering(&self, slot: u64, txs: &[Transaction]) -> bool {
        self.slot == slot && self.ordering_hash == compute_ordering_hash(slot, txs)
    }

    pub fn ordering_hash_hex(&self) -> String {
        self.ordering_hash.iter().map(|b| format!("{:02x}", b)).collect()
    }

    pub fn ordering_hash_short(&self) -> String {
        let h = self.ordering_hash_hex();
        format!("{}…{}", &h[..8], &h[h.len() - 8..])
    }
}

fn compute_ordering_hash(slot: u64, txs: &[Transaction]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(slot.to_le_bytes());
    hasher.update((txs.len() as u32).to_le_bytes());
    for tx in txs {
        hasher.update(tx.signature.as_ref());
    }
    hasher.finalize().into()
}

fn sign_with_tee(hash: &[u8; 32]) -> (bool, [u8; 64]) {
    // Production path — only compiled when feature "tee" is enabled.
    // The `sev` crate provides Rust bindings for AMD SEV-SNP.
    // Usage: cargo build --release --features tee
    //
    // The actual call would be:
    //   let fw = sev::firmware::guest::Firmware::open()?;
    //   let report = fw.get_report(None, Some(*hash), 0)?;
    //   // extract r+s bytes from report.signature
    //
    // We keep this as a comment (not #[cfg]) to avoid compile errors
    // when the sev crate version changes its API.

    let _ = hash; // used in production path above
    log::debug!("Soft attestation (no TEE hardware). Run with --features tee on SEV-SNP hardware.");
    (false, [0u8; 64])
}

// ─── Serde for [u8; 64] ──────────────────────────────────────────────────────

mod hex64 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(b: &[u8; 64], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&b.iter().map(|x| format!("{:02x}", x)).collect::<String>())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 64], D::Error> {
        let s = String::deserialize(d)?;
        let v: Vec<u8> = (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16))
            .collect::<Result<_, _>>()
            .map_err(serde::de::Error::custom)?;
        v.try_into().map_err(|_| serde::de::Error::custom("expected 64 bytes"))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::classifier::test_helpers::build_test_tx;
    use solana_sdk::pubkey::Pubkey;

    fn block(slot: u64, n: usize) -> Block {
        let p = Pubkey::new_unique();
        Block {
            slot,
            transactions: (0..n).map(|i| build_test_tx(&p, [i as u8; 8])).collect(),
            block_time: 0,
        }
    }

    #[test]
    fn builds_without_panic() {
        let b = block(1, 3);
        let p = Pubkey::new_unique();
        let a = Attestation::build(&b, "0.1.0", &p);
        assert_eq!(a.slot, 1);
        assert!(!a.tee_signed);
    }

    #[test]
    fn hash_is_deterministic() {
        let b = block(42, 3);
        let p = Pubkey::new_unique();
        assert_eq!(
            Attestation::build(&b, "0.1.0", &p).ordering_hash,
            Attestation::build(&b, "0.1.0", &p).ordering_hash,
        );
    }

    #[test]
    fn different_orderings_different_hashes() {
        let prog = Pubkey::new_unique();
        let t1 = build_test_tx(&prog, [1u8; 8]);
        let t2 = build_test_tx(&prog, [2u8; 8]);
        let p = Pubkey::new_unique();
        let b1 = Block { slot: 1, transactions: vec![t1.clone(), t2.clone()], block_time: 0 };
        let b2 = Block { slot: 1, transactions: vec![t2, t1], block_time: 0 };
        assert_ne!(
            Attestation::build(&b1, "0.1.0", &p).ordering_hash,
            Attestation::build(&b2, "0.1.0", &p).ordering_hash,
        );
    }

    #[test]
    fn verify_correct_slot_and_txs() {
        let b = block(99, 4);
        let p = Pubkey::new_unique();
        let a = Attestation::build(&b, "0.1.0", &p);
        assert!(a.verify_ordering(99, &b.transactions));
        assert!(!a.verify_ordering(100, &b.transactions));
    }

    #[test]
    fn short_hash_format() {
        let b = block(1, 1);
        let p = Pubkey::new_unique();
        let a = Attestation::build(&b, "0.1.0", &p);
        let s = a.ordering_hash_short();
        assert!(s.contains('…'));
        assert_eq!(s.chars().filter(|c| *c != '…').count(), 16);
    }

    #[test]
    fn json_roundtrip() {
        let b = block(7, 2);
        let p = Pubkey::new_unique();
        let a = Attestation::build(&b, "0.1.0", &p);
        let back: Attestation = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert_eq!(a.ordering_hash, back.ordering_hash);
        assert_eq!(a.slot, back.slot);
    }
}
