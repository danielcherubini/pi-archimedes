/** ANSI utilities — barrel re-export. */

export {
	RST, FG_RST, BOLD, DIM,
	FG_ADD, FG_DEL, FG_DIM, FG_LNUM, FG_RULE, FG_SAFE_MUTED, FG_STRIPE,
	BORDER_BAR,
	DEFAULT_DIFF_BG,
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
