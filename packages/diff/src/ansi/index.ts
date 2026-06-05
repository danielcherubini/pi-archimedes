/** ANSI utilities — barrel re-export. */

export {
	RST, BOLD, DIM,
	FG_ADD, FG_DEL, FG_DIM, FG_LNUM, FG_RULE, FG_SAFE_MUTED, FG_STRIPE,
	BORDER_BAR,
	DEFAULT_DIFF_BG,
	BG_ADD, BG_DEL, BG_ADD_W, BG_DEL_W, BG_GUTTER_ADD, BG_GUTTER_DEL, BG_EMPTY, BG_BASE, DIVIDER,
	ANSI_RE, ANSI_CAPTURE_RE, ANSI_PARAM_CAPTURE_RE,
	DEFAULT_DIFF_COLORS,
	resetDiffColors, themeCacheKey, resolveDiffColors,
	deriveBgFromTheme,
	type DiffBg,
	type DiffColors,
} from "./codes.js";

export {
	strip, tabs, fit, ansiState,
	isLowContrastShikiFg, normalizeShikiContrast,
	stripes, lnum, rule, shortPath, summarize,
} from "./manip.js";
