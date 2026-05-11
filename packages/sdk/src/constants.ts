/** Deployed MicroCLOB program ID on Solana devnet */
export const MICRO_CLOB_PROGRAM_ID = '93bKGD7STjvA2h4if8cs4sVxJqtUmxmh8tYFBaRhEgsn';

/**
 * Jito tip accounts — one chosen at random per bundle.
 * Source: https://docs.jito.wtf/lowlatencytxnsend/#tip-payment-instructions
 */
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
] as const;

// ─── Defaults ─────────────────────────────────────────────────────────────────
export const DEFAULT_TIP_LAMPORTS      = 10_000;
export const DEFAULT_COMPUTE_UNITS     = 200_000;
export const DEFAULT_COMPUTE_UNIT_PRICE = 1;
export const DEFAULT_STAKE_POOL_API    = 'https://kobe.mainnet.jito.network';
export const BAM_EXPLORER_BASE         = 'https://bam.dev/explorer/slot';

/**
 * Anchor instruction discriminators for MicroCLOB.
 * Computed: sha256("global:<name>")[0..8]
 * Verified by scripts/compute-discriminators.ts
 * Must match crates/maker-shield/src/classifier.rs
 */
export const DISCRIMINATORS = {
  initialize_market: [35,  35,  189, 193, 155, 48,  170, 203],
  place_order:       [51,  194, 155, 175, 109, 130, 96,  106],
  cancel_order:      [95,  129, 237, 240, 8,   49,  223, 132],
  update_quote:      [235, 69,  162, 233, 147, 53,  42,  225],
  fill_order:        [232, 122, 115, 25,  199, 143, 136, 162],
  toggle_plugin:     [217, 191, 148, 183, 220, 117, 85,  28 ],
} as const;

// Convenience named exports used by plugin.ts and bundle.ts
export const CANCEL_ORDER_DISCRIMINATOR  = DISCRIMINATORS.cancel_order;
export const UPDATE_QUOTE_DISCRIMINATOR  = DISCRIMINATORS.update_quote;
export const FILL_ORDER_DISCRIMINATOR    = DISCRIMINATORS.fill_order;
export const PLACE_ORDER_DISCRIMINATOR   = DISCRIMINATORS.place_order;
export const TOGGLE_PLUGIN_DISCRIMINATOR = DISCRIMINATORS.toggle_plugin;
