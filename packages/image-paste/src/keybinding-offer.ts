import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isConfigEnabled, loadConfig, updateConfig } from "@pi-archimedes/core/settings-io";

const NAMESPACE = "archimedes.imagePaste";

const CONFIRM_TITLE = "First run";
const CONFIRM_MESSAGE =
  "~/.pi/agent/keybindings.json is missing. Without it, Pi's built-in " +
  "app.clipboard.pasteImage binding (Ctrl+V on Linux/macOS, Alt+V on Windows) " +
  "double-fires with image-paste's Ctrl+V handler. Create the file now with the " +
  "docs snippet? It clears the built-in binding (/reload applies it).";

/** Exactly the snippet from packages/image-paste/README.md → "Paste shortcuts". */
const SNIPPET_JSON = '{ "app.clipboard.pasteImage": [] }';

export const CREATED_NOTIFY = "Created ~/.pi/agent/keybindings.json — /reload applies it";

interface PromptConfig {
  keybindingsPromptDone: boolean;
}

const PROMPT_DEFAULTS: PromptConfig = { keybindingsPromptDone: false };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Persist `keybindingsPromptDone: true` via updateConfig: optimistic re-read
 * check + bounded retry, so a concurrent write to settings.json (e.g. another
 * session's /plugins toggle) is detected and re-read — the flag save cannot
 * clobber a newer `enabled` value. Never throws: a failed save notifies and
 * leaves the flag unset (gate 4 blocks the re-offer once the file exists anyway).
 */
function markPromptDone(ctx: ExtensionContext): void {
  try {
    updateConfig<PromptConfig>(
      NAMESPACE,
      PROMPT_DEFAULTS,
      (cfg) => ({ ...cfg, keybindingsPromptDone: true }),
    );
  } catch (error) {
    ctx.ui.notify(
      `Could not persist keybinding prompt flag: ${messageOf(error)}`,
      "warning",
    );
  }
}

/**
 * First-run keybinding offer (once ever, all platforms).
 *
 * On the first TUI session, if `~/.pi/agent/keybindings.json` does not exist,
 * offer to create it with the docs snippet so Pi's built-in clipboard paste
 * doesn't double-fire with image-paste's Ctrl+V handler. Accepting writes the
 * file (atomic tmp+rename, pre-rename existence re-check) and then sets the
 * one-shot flag; declining or cancelling (Esc/timeout — `confirm` resolves
 * `false` either way) sets the flag without touching the file. A failed file
 * write leaves the flag unset, so the offer self-heals next session.
 *
 * **Concurrent-session edge:** if the user runs `/new` or `/reload` while the
 * confirm dialog is still open, `ctx.ui.confirm` resolves `false` (the TUI
 * tears down). This counts as a decline — the flag is set and the offer will
 * not appear again. To reset it, delete `archimedes.imagePaste.keybindingsPromptDone`
 * from `~/.pi/agent/settings.json`.
 */
export async function offerKeybindingFix(ctx: ExtensionContext): Promise<void> {
  // Gate 1: extension on.
  // NOTE: reading archimedes.imagePaste.enabled in-package is a sanctioned
  // exception to the AGENTS.md "Plugin on/off" rule and ADR 0012 — this
  // function runs from the meta session_start handler before plugin
  // registration, so there is no registration gate to catch it here.
  // See docs/decisions/0012-plugin-gate-in-package-namespace.md § Exception.
  if (!isConfigEnabled(NAMESPACE)) {
    return;
  }

  // Gate 2: interactive TUI only. Deliberate: the flag is NOT consumed in
  // non-TUI modes, so a later TUI session still gets the offer.
  if (ctx.mode !== "tui") {
    return;
  }

  // Gate 3: not yet consumed
  if (loadConfig<PromptConfig>(NAMESPACE, { ...PROMPT_DEFAULTS }).keybindingsPromptDone === true) {
    return;
  }

  // Gate 4: file absent — never merge into or rewrite an existing user file
  const keybindingsPath = join(getAgentDir(), "keybindings.json");
  if (existsSync(keybindingsPath)) {
    return;
  }

  // Gate 5: ask (confirm signature is TITLE first — docs/extensions.md:165)
  const confirmed = await ctx.ui.confirm(CONFIRM_TITLE, CONFIRM_MESSAGE);

  // No, or cancel (Esc/timeout — `confirm` resolves `false` either way counts
  // as decline): set the flag and do nothing else.
  if (!confirmed) {
    markPromptDone(ctx);
    return;
  }

  // Yes: write the file atomically (tmp + rename) — strictly BEFORE the flag
  // is set, so a failed write leaves both gates open and the offer self-heals.
  const tmpPath = `${keybindingsPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, SNIPPET_JSON, "utf-8");
    // Re-check immediately before the rename so a concurrently created file is
    // never clobbered (TOCTOU).
    if (existsSync(keybindingsPath)) {
      // Someone created the file in the meantime: leave it intact, clean up
      // our tmp, and end the offer (gate 4 blocks re-offer anyway).
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      markPromptDone(ctx);
      return;
    }
    renameSync(tmpPath, keybindingsPath);
  } catch (error) {
    // File write (or rename) failed: do NOT set the flag — the offer self-
    // heals next session. Best-effort tmp cleanup first.
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    ctx.ui.notify(
      `Could not create keybindings.json: ${messageOf(error)}`,
      "warning",
    );
    return;
  }

  // File written successfully → THEN set the flag (deliberately after the
  // write, per the design).
  markPromptDone(ctx);
  ctx.ui.notify(CREATED_NOTIFY, "info");
}
