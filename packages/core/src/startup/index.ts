import { VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { getShinedLogo, TRUECOLOR, LOGO_PAD, LOGO_SETTLE_FRAME } from "./logo.js";
import { loadCoreConfig } from "../config.js";
import { detectSection, parseSectionText, parseModelScope, formatColumns, buildItemWrapper, type ParsedSection, SECTION_KEYS } from "./sections.js";
import { fetchLatestVersion, compareVersions } from "./version.js";
import { stripAnsi } from "../text.js";
import { Text, Spacer, Container, TUI, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

// Symbol keys (survive hot-reload)
const LISTING_REF = Symbol.for("splashscreen:listingRef");
const ANIM_INTERVAL = Symbol.for("splashscreen:animInterval");
const DEBOUNCE_TIMER = Symbol.for("splashscreen:debounceTimer");
const PATCHED_CLEAR = Symbol.for("splashscreen:clearPatched");
const PATCHED_LISTING = Symbol.for("splashscreen:listingPatched");
const ORIG_ADD_CHILD = Symbol.for("splashscreen:origAddChild");

// Animation constants
const MAX_RENDER_WIDTH = 9999;
const MIN_HEADER_LINES = 11;
const REVEAL_DEBOUNCE_MS = 150;
const RAMP_FRAMES = 22;
const STAGGER_FRAMES = 0;
const BASE_FADE_DELAY = 3;
const MAX_STAGGER = BASE_FADE_DELAY + 5 * STAGGER_FRAMES;

export interface ListingRef {
  sections: ParsedSection[];
  frame: number;
  revealed: boolean;
  revealedAt: number;
  scaffoldAt: number;
  latestVersion?: string;
  settled: boolean;
  cachedLines?: string[];
  cachedWidth?: number;
  cachedHeight?: number;
  maxHeaderHeight?: number;
}

// ── renderHeader() — composes logo + sections + padding ────────────────

export function renderHeader(theme: Theme, ref: ListingRef, width: number, height: number): string[] {
  const dim = (t: string) => theme.fg("dim", t);
  const accent = (t: string) => theme.fg("accent", t);
  const logoLines = getShinedLogo(ref.frame, loadCoreConfig().animationStyle);

  // Use cached text lines if settled (no more animations)
  let listingLines: string[];

  if (ref.settled && ref.cachedLines && ref.cachedWidth === width && ref.cachedHeight === height) {
    listingLines = ref.cachedLines;
  } else {
    const sectionsToRender: { name: "Version" | ParsedSection["name"]; items: string[] }[] = [];

    if (!ref.revealed) {
      // Logo only — sections appear together on reveal
    } else {
      const latest = ref.latestVersion ?? VERSION;
      const hasUpdate = compareVersions(latest, VERSION) > 0;
      const latestStr = hasUpdate ? `Latest: ${accent("v" + latest)}` : `Latest: v${latest}`;
      sectionsToRender.push({ name: "Version", items: [`Local: v${VERSION}`, latestStr] });

      // Display sections in SECTION_KEYS order, skip empty
      const byName = new Map(ref.sections.map(s => [s.name, s]));
      for (const key of SECTION_KEYS) {
        const sec = byName.get(key);
        if (sec && sec.items.length > 0) sectionsToRender.push(sec);
      }
    }

    const listingMaxW = Math.floor(width * 0.7);
    listingLines = formatColumns(sectionsToRender, theme, listingMaxW, ref);

    // Cache once text animations are done
    const textAge = ref.revealed ? ref.frame - ref.revealedAt : 0;
    const textDone = ref.revealed && textAge > RAMP_FRAMES + MAX_STAGGER;
    const logoDone = ref.frame >= LOGO_SETTLE_FRAME;

    if (textDone && logoDone) {
      ref.settled = true;
      ref.cachedLines = listingLines;
      ref.cachedWidth = width;
      ref.cachedHeight = height;
    }
  }

  // Build content: logo + separator + listing
  const contentLines: string[] = [];

  // Logo centered above listing (same center as listing text)
  const listingMaxW = Math.floor(width * 0.7);
  const listingLeftPad = Math.floor((width - listingMaxW) / 2);
  for (const logoRow of logoLines) {
    const pad = Math.floor((listingMaxW - visibleWidth(logoRow)) / 2);
    contentLines.push(" ".repeat(LOGO_PAD) + " ".repeat(listingLeftPad + pad) + logoRow);
  }

  // Separator
  contentLines.push("");

  // Listing
  for (const listRow of listingLines) {
    contentLines.push(" ".repeat(LOGO_PAD) + " ".repeat(listingLeftPad) + listRow);
  }

  // Pad top and bottom to fill height (+5 top bias for visual centering)
  const VERTICAL_CENTER_BIAS = 5; // Shift content slightly upward for visual balance
  const contentHeight = contentLines.length;
  const remaining = Math.max(0, height - contentHeight);
  const topPad = Math.floor(remaining / 2) + VERTICAL_CENTER_BIAS;
  const bottomPad = remaining - topPad;

  const result: string[] = [];
  for (let i = 0; i < topPad; i++) result.push("");
  for (const line of contentLines) result.push(line);
  for (let i = 0; i < bottomPad; i++) result.push("");

  return result;
}

// ── Chat container discovery ────────────────────────────────────────────

// Fragile: relies on TUI child ordering (header, chat, footer) which is an
// internal layout detail of pi's InteractiveMode. If upstream changes the
// child structure, this will need updating.
//
// Strategy (most specific → least specific):
// 1. Container with "Scrollable" in constructor name
// 2. Container with most children (chat usually has the most)
// 3. Middle child if exactly 3 children (header, chat, footer)
// 4. First Container found
function findChatContainer(tui: TUI): Container | undefined {
  // Strategy 1: Look for Scrollable container
  for (const child of tui.children) {
    if (child instanceof Container && child.constructor.name.includes("Scrollable")) {
      return child;
    }
  }

  // Strategy 2: Find the Container with the most children (chat area)
  const containers = tui.children.filter((c): c is Container => c instanceof Container);
  if (containers.length > 1) {
    const largest = containers.reduce((best, c) =>
      c.children.length > best.children.length ? c : best,
    );
    if (largest.children.length > 0) return largest;
  }

  // Strategy 3: Middle child if exactly 3 children
  if (tui.children.length >= 3) {
    const middle = tui.children[1];
    if (middle instanceof Container) return middle;
  }

  // Strategy 4: First Container
  if (containers.length > 0) return containers[0];

  return undefined;
}

export function patchStartupListing(
  tui: TUI,
  _theme: Theme,
  ref: ListingRef,
): void {
  const chat = findChatContainer(tui);
  if (!chat) {
    // Graceful degradation: if we can't find the chat container,
    // the startup listing won't render but the extension continues.
    console.warn("[archimedes] Could not find chat container — startup listing disabled. This may indicate a pi TUI structure change.");
    return;
  }
  const cc = chat as any;

  // Always update ref + restart animation (critical for /reload)
  cc[LISTING_REF] = ref;
  ref.frame = 0;
  ref.revealed = false;
  ref.revealedAt = 0;
  ref.scaffoldAt = 0;
  ref.settled = false;
  delete ref.cachedLines;
  delete ref.cachedWidth;
  delete ref.maxHeaderHeight;

  if (cc[ANIM_INTERVAL]) clearInterval(cc[ANIM_INTERVAL]);
  if (cc[DEBOUNCE_TIMER]) clearTimeout(cc[DEBOUNCE_TIMER]);

  const interval = setInterval(() => {
    try {
      const current: ListingRef = cc[LISTING_REF];
      if (!current) {
        clearInterval(interval);
        return;
      }
      current.frame++;
      if (current.settled && current.frame >= LOGO_SETTLE_FRAME) {
        clearInterval(interval);
        cc[ANIM_INTERVAL] = null;
        return;
      }
      tui.requestRender();
    } catch {
      clearInterval(interval);
    }
  }, 16);

  cc[ANIM_INTERVAL] = interval;

  // Fetch latest version from npm
  fetchLatestVersion().then(v => {
    if (v) {
      const current: ListingRef = cc[LISTING_REF];
      current.latestVersion = v;
      // Invalidate cache so version updates on next render
      delete current.cachedLines;
      current.settled = false;
    }
  });

  // Patch clear() to intercept container rebuild
  if (!cc[PATCHED_CLEAR]) {
    cc[PATCHED_CLEAR] = true;
    const origClear = chat.clear.bind(chat);
    chat.clear = () => {
      return origClear();
    };
  }

  // Only patch addChild once — the closure reads cc[LISTING_REF] dynamically
  if (cc[PATCHED_LISTING]) {
    chat.clear();
    return;
  }
  cc[PATCHED_LISTING] = true;

  const origAddChild = chat.addChild.bind(chat);
  cc[ORIG_ADD_CHILD] = origAddChild; // Store for cleanup on shutdown
  chat.clear();

  chat.addChild = (component: Component) => {
    try {
      const currentRef: ListingRef = cc[LISTING_REF];

      if (component instanceof Text) {
      // pi ≥0.67.6 wraps startup sections in ExpandableText; collapsed body
      // is a lossy comma-joined base-name list. Parse the expanded text so
      // Extensions keep real names instead of "index.ts/index.js/index".
      const getExpanded = (component as any).getExpandedText;
      const plain = typeof getExpanded === "function"
        ? stripAnsi(getExpanded.call(component))
        : stripAnsi(component.render(MAX_RENDER_WIDTH).join("\n"));

      const section = parseSectionText(plain) ?? parseModelScope(plain);
      if (section) {
        const existing = currentRef.sections.find(s => s.name === section.name);
        if (existing) {
          existing.items = [...new Set([...existing.items, ...section.items])];
        } else {
          currentRef.sections.push(section);
        }

        // Invalidate cache so late-arriving sections show up
        currentRef.settled = false;
        delete currentRef.cachedLines;

        if (currentRef.revealed) {
          // Already revealed — show new section immediately
          tui.requestRender();
        } else {
          // Batch initial sections — reset debounce on each arrival
          if (cc[DEBOUNCE_TIMER]) clearTimeout(cc[DEBOUNCE_TIMER]);
          cc[DEBOUNCE_TIMER] = setTimeout(() => {
            const ref: ListingRef = cc[LISTING_REF];
            ref.revealed = true;
            ref.revealedAt = ref.frame;
            ref.scaffoldAt = ref.frame;
            tui.requestRender();
            cc[DEBOUNCE_TIMER] = null;
          }, REVEAL_DEBOUNCE_MS);
        }

        return;
      }

      if (
        plain.includes("Listing all available commands") ||
        plain.includes("(Source: extension)") ||
        plain.trim().startsWith("/skill:")
      ) {
        return;
      }
    }

    if (component instanceof Spacer && !currentRef.revealed) return;
    try {
      origAddChild(component);
    } catch (err) {
      console.error("[archimedes] Error in chat.addChild:", err);
    }
  } catch (err) {
    console.error("[archimedes] Error in startup listing addChild handler:", err);
  }
  };
}
