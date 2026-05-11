/**
 * lib/constants.ts
 *
 * Constants used by the dashboard client-side code.
 * These are duplicated from packages/sdk/src/constants.ts intentionally —
 * the dashboard cannot import from the SDK source directly in the browser.
 * All discriminators are verified by scripts/compute-discriminators.ts.
 */

// ─── Anchor instruction discriminators ───────────────────────────────────────
// Computed: sha256("global:<name>")[0..8]

export const DISCRIMINATORS = {
  initialize_market: [35,  35,  189, 193, 155, 48,  170, 203],
  place_order:       [51,  194, 155, 175, 109, 130, 96,  106],
  cancel_order:      [95,  129, 237, 240, 8,   49,  223, 132],
  update_quote:      [235, 69,  162, 233, 147, 53,  42,  225],
  fill_order:        [232, 122, 115, 25,  199, 143, 136, 162],
  toggle_plugin:     [217, 191, 148, 183, 220, 117, 85,  28 ],
} as const;

// ─── Jito tip accounts ────────────────────────────────────────────────────────
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

export const DEFAULT_TIP_LAMPORTS = 50_000;
