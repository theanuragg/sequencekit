//! OrderBook state module.
//!
//! Design decision: MicroCLOB tracks book state via individual Order PDAs
//! and the Market account's `best_bid` / `best_ask` fields.
//!
//! A production CLOB would maintain a sorted slab (e.g. the critbit tree
//! used by OpenBook/Serum) for O(log n) price level lookups. We omit this
//! because MicroCLOB's purpose is to DEMONSTRATE MakerShield ordering
//! guarantees, not to be a production-grade matching engine.
//!
//! The `best_bid` / `best_ask` fields in `Market` are sufficient to:
//!   1. Calculate spread in basis points (the primary dashboard metric)
//!   2. Emit accurate SpreadChanged events after each fill/cancel
//!   3. Validate that fills execute at or within the quoted prices
//!
//! Limitation: when a top-of-book order is cancelled, best_bid/ask resets
//! to 0/u64::MAX respectively. The client re-reads open orders to find the
//! new best price. This is acceptable for a proof-of-concept.
//!
//! To extend to production: replace best_bid/best_ask with a critbit tree
//! PDA and implement O(log n) insertion/deletion/lookup.
