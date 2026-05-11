// Main client
export { SequenceKit } from './client.js';

// Sub-clients (for advanced usage)
export { BundleClient } from './bundle.js';
export { LatencyClient } from './latency.js';
export { MEVClient } from './mev.js';

// Plugin control helpers
export {
  activateMakerShield,
  deactivateMakerShield,
  isMakerShieldActive,
  buildTogglePluginInstruction,
  deriveMarketAddress,
  deriveVaultAddresses,
  deriveOrderAddress,
  derivePositionAddress,
} from './plugin.js';

// All types
export type {
  BundleResult,
  LatencyEvent,
  MakerBundleParams,
  MEVStats,
  OrderFilledEvent,
  SequenceKitConfig,
  SpreadChangedEvent,
  SpreadInfo,
  Unsubscribe,
} from './types.js';

// Constants (useful for integration testing and building instructions)
export {
  BAM_EXPLORER_BASE,
  CANCEL_ORDER_DISCRIMINATOR,
  DEFAULT_TIP_LAMPORTS,
  DISCRIMINATORS,
  JITO_TIP_ACCOUNTS,
  MICRO_CLOB_PROGRAM_ID,
  TOGGLE_PLUGIN_DISCRIMINATOR,
  UPDATE_QUOTE_DISCRIMINATOR,
} from './constants.js';
