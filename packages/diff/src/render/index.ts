/** Barrel — re-export all render modules. */

// Shared constants, config, and helpers
export {
  MAX_PREVIEW_LINES,
  MAX_RENDER_LINES,
  MAX_HL_CHARS,
  WORD_DIFF_MIN_SIM,
  DEFAULT_TERM_WIDTH,
  getConfig,
  setConfigGetter,
  adaptiveWrapRows,
  wrapAnsi,
  shouldUseSplit,
} from "./shared.js";

// Unified view
export { renderUnified, renderUnifiedLines } from "./unified.js";

// Split view
export { renderSplit, renderSplitLines } from "./split.js";
