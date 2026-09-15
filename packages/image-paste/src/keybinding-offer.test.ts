import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ── hoisted: must use require() since vi.hoisted runs before imports ────────

const { tempDir, fs, join, existsSyncSpy } = vi.hoisted(() => {
  const fs = require("node:fs");
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { randomUUID } = require("node:crypto");
  const dir = join(tmpdir(), `keybinding-offer-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  // Pass-through by default; specific tests re-target it (the concurrent-file
  // case needs keybindings.json to appear between gate 4 and the pre-rename
  // re-check).
  const existsSyncSpy = vi.fn((p: unknown) => fs.existsSync(String(p)));
  return { tempDir: dir, fs, join, existsSyncSpy };
});

// ── mocks: registered before the module under test is first imported ─────────
// The mock MUST be registered before keybinding-offer.js (and the settings-io
// it pulls in) is loaded: module-scope path constants capture getAgentDir() at
// load time (settings-io.ts:5).

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempDir,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: existsSyncSpy };
});

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// Identical to the package's ExtensionMode (dist types:208-209), which is not
// re-exported from the package root.
type Mode = "tui" | "rpc" | "json" | "print";

const { offerKeybindingFix, CREATED_NOTIFY, CREATED_RELOAD_HINT } = await import("./keybinding-offer.js");

// ── fixtures ─────────────────────────────────────────────────────────────────

const NAMESPACE = "archimedes.imagePaste";
/** The exact snippet from packages/image-paste/README.md → "Paste shortcuts". */
const SNIPPET = '{ "app.clipboard.pasteImage": [] }';
/** What a concurrent process writes into keybindings.json at rename time. */
const CONCURRENT_CONTENT = '{ "app.clipboard.pasteImage": ["ctrl+v"] }';


const settingsPath = (): string => join(tempDir, "settings.json");
const keybindingsPath = (): string => join(tempDir, "keybindings.json");
const tmpPath = (): string => `${keybindingsPath()}.${process.pid}.tmp`;

function writeSettings(obj: object): void {
  fs.writeFileSync(settingsPath(), JSON.stringify(obj), "utf-8");
}

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(settingsPath())) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readFlag(): boolean {
  const ns = readSettings()[NAMESPACE] as Record<string, unknown> | undefined;
  return ns?.keybindingsPromptDone === true;
}

function cleanupArtifacts(): void {
  for (const p of [settingsPath(), settingsPath() + ".tmp", keybindingsPath(), tmpPath()]) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function makeCtx(mode: Mode, opts?: { withReload?: boolean }) {
  const confirm = vi.fn();
  const notify = vi.fn();
  // Intentionally mirrors the base ExtensionContext the real session_start
  // handler receives: no command-only methods like `reload` (Pi 0.85.1
  // attaches reload to the command context only), so tests stay honest about
  // what the real ctx provides. The auto-reload branch is covered separately
  // by passing { withReload: true }, which simulates a future Pi version
  // that puts reload() on the event ctx.
  const reload = opts?.withReload ? vi.fn(async () => {}) : undefined;
  const ctx = {
    mode,
    hasUI: true,
    ui: { confirm, notify },
    ...(reload ? { reload } : {}),
  } as unknown as ExtensionContext;
  return { ctx, confirm, notify, reload };
}

function callArgs(m: ReturnType<typeof vi.fn>): unknown[][] {
  return m.mock.calls as unknown[][];
}

beforeEach(() => {
  cleanupArtifacts();
  existsSyncSpy.mockReset();
  existsSyncSpy.mockImplementation((p: unknown) => fs.existsSync(String(p)));
});

afterAll(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── gate matrix ──────────────────────────────────────────────────────────────
// isConfigEnabled × {t,f} × ctx.mode ∈ {tui, rpc, json, print} × file {absent,
// present} × flag {unset, set} × confirm outcome {yes, no, cancel-resolves-false}
// (Esc/timeout: `confirm` resolves `false` either way → counts as decline).

interface Case {
  enabled: boolean;
  mode: Mode;
  file: "absent" | "present";
  flag: "unset" | "set";
  outcome: "yes" | "no" | "cancel-resolves-false";
}

const CASES: Case[] = (() => {
  const cases: Case[] = [];
  for (const enabled of [false, true]) {
    for (const mode of ["tui", "rpc", "json", "print"] as Mode[]) {
      for (const file of ["absent", "present"] as const) {
        for (const flag of ["unset", "set"] as const) {
          for (const outcome of ["yes", "no", "cancel-resolves-false"] as const) {
            cases.push({ enabled, mode, file, flag, outcome });
          }
        }
      }
    }
  }
  return cases;
})();

describe("offerKeybindingFix — gate matrix", () => {
  it.each(CASES)(
    "$enabled/$mode/$file/$flag → $outcome",
    async ({ enabled, mode, file, flag, outcome }) => {
      // ── setup ──
      const ns: Record<string, unknown> = {};
      if (enabled === false) ns.enabled = false;
      if (flag === "set") ns.keybindingsPromptDone = true;
      const settingsBefore = { ...ns };
      if (Object.keys(settingsBefore).length > 0) {
        writeSettings({ [NAMESPACE]: settingsBefore });
      }
      const settingsBeforeJson = readSettings();

      if (file === "present") {
        fs.writeFileSync(keybindingsPath(), CONCURRENT_CONTENT, "utf-8");
      }

      const { ctx, confirm, notify } = makeCtx(mode);
      if (outcome === "yes") confirm.mockResolvedValue(true);
      else confirm.mockResolvedValue(false); // no + cancel: confirm resolves false

      await offerKeybindingFix(ctx);

      const shouldAsk =
        enabled === true &&
        mode === "tui" &&
        flag === "unset" &&
        file === "absent";

      // ── gate behavior ──
      expect(confirm).toHaveBeenCalledTimes(shouldAsk ? 1 : 0);
      // never fires when the plugin is disabled
      if (enabled === false) expect(confirm).not.toHaveBeenCalled();
      // never fires when the file already exists
      if (file === "present") expect(confirm).not.toHaveBeenCalled();
      // never fires when the flag is already consumed
      if (flag === "set") expect(confirm).not.toHaveBeenCalled();
      // never fires in non-TUI modes
      if (mode !== "tui") expect(confirm).not.toHaveBeenCalled();

      if (shouldAsk) {
        // confirm is called with the TITLE FIRST (docs/extensions.md:165)
        const [title, message] = callArgs(confirm)[0] as [string, string];
        expect(title).toBe("First run");
        expect(typeof message).toBe("string");
        expect(message).toContain("keybindings.json");
      }

      // ── file effects ──
      const kbExists = fs.existsSync(keybindingsPath());
      if (shouldAsk && outcome === "yes") {
        // yes → file written with the exact snippet content
        expect(kbExists).toBe(true);
        expect(fs.readFileSync(keybindingsPath(), "utf-8")).toBe(SNIPPET);
      } else {
        // never written when the offer never fires; the pre-existing file is never
        // clobbered
        expect(kbExists).toBe(file === "present");
      }

      // ── flag effects ──
      if (shouldAsk) {
        // offer fires once and sets the flag on every outcome (yes, no, cancel → decline)
        expect(readFlag()).toBe(true);
      } else {
        // non-TUI / non-offer rows never consume the flag — settings byte-identical
        expect(readSettings()).toEqual(settingsBeforeJson);
        expect(readFlag()).toBe(flag === "set");
      }

      // ── notifications ──
      if (shouldAsk && outcome === "yes") {
        // Base-shape ctx has no reload, so the offer emits the /reload hint
        expect(
          callArgs(notify).some(
            (c) => c[0] === CREATED_RELOAD_HINT && c[1] === "info",
          ),
        ).toBe(true);
      } else {
        expect(notify).not.toHaveBeenCalled();
      }
    },
  );
});

// ── flag persistence regression: load-modify-save preserves other keys ──────
// saveConfig REPLACES the namespace object (settings-io.ts:29-33), so a bare
// saveConfig(ns, { keybindingsPromptDone: true }) would erase other keys under
// archimedes.imagePaste.

describe("flag write preserves existing settings", () => {
  async function run(outcome: "yes" | "no") {
    writeSettings({
      [NAMESPACE]: { enabled: true, someOtherKey: 42, nested: { a: 1 } },
      "other.ns": { z: 1 },
    });
    const { ctx, confirm } = makeCtx("tui");
    confirm.mockResolvedValue(outcome === "yes");
    await offerKeybindingFix(ctx);
  }

  it("yes: snippet file written; other archimedes.imagePaste keys survive the flag set", async () => {
    await run("yes");
    expect(fs.readFileSync(keybindingsPath(), "utf-8")).toBe(SNIPPET);
    const data = readSettings();
    const ns = data[NAMESPACE] as Record<string, unknown>;
    expect(ns).toEqual({
      enabled: true,
      someOtherKey: 42,
      nested: { a: 1 },
      keybindingsPromptDone: true,
    });
    expect(data["other.ns"]).toEqual({ z: 1 });
  });

  it("no: decline sets the flag via load-modify-save; keys survive, file untouched", async () => {
    await run("no");
    expect(fs.existsSync(keybindingsPath())).toBe(false);
    const ns = readSettings()[NAMESPACE] as Record<string, unknown>;
    expect(ns).toEqual({
      enabled: true,
      someOtherKey: 42,
      nested: { a: 1 },
      keybindingsPromptDone: true,
    });
  });
});

// ── error paths ──────────────────────────────────────────────────────────────

describe("file write throws → flag stays false (self-heals next session)", () => {
  it("yes with an unwritable tmp target: no file, flag unset, error notified, no throw", async () => {
    // Make the (pid-predictable) tmp path unwritable: a directory.
    fs.mkdirSync(tmpPath(), { recursive: true });

    const { ctx, confirm, notify } = makeCtx("tui");
    confirm.mockResolvedValue(true);

    await expect(offerKeybindingFix(ctx)).resolves.toBeUndefined();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(keybindingsPath())).toBe(false);
    expect(readFlag()).toBe(false);
    expect(
      readSettings()[NAMESPACE] ?? {},
    ).toEqual({}); // nothing persisted to settings

    expect(notify).toHaveBeenCalledTimes(1);
    const [msg, type] = notify.mock.calls[0] as [string, string];
    expect(type).toBe("warning");
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe("flag write throws → notify, no crash (file write already succeeded)", () => {
  it("yes with an unwritable settings target: file kept, flag unset, both notifies, no throw", async () => {
    // Make settings.json an unwritable target: a directory (rename + direct
    // write onto it both fail with EISDIR).
    fs.mkdirSync(settingsPath(), { recursive: true });

    const { ctx, confirm, notify } = makeCtx("tui");
    confirm.mockResolvedValue(true);

    await expect(offerKeybindingFix(ctx)).resolves.toBeUndefined();

    // The file write strictly precedes the flag set and survived:
    expect(fs.readFileSync(keybindingsPath(), "utf-8")).toBe(SNIPPET);
    // Flag persistence failed: settings.json is still the directory, no flag
    expect(fs.statSync(settingsPath()).isDirectory()).toBe(true);
    expect(readFlag()).toBe(false);
    // Gate 4 blocks the re-offer anyway (file now exists) — by design

    const args = callArgs(notify);
    expect(
      args.some((c) => c[0] === CREATED_RELOAD_HINT && c[1] === "info"),
    ).toBe(true); // the file WAS created (base-shape ctx → /reload hint)
    expect(args.some((c) => c[1] === "warning" && String(c[0]).length > 0)).toBe(true); // flag save error: non-empty warning message
  });
});

// ── accept with base-shape ctx (no reload — Pi 0.85.1 event ctx) ──────────
// The real session_start ctx has no reload property (Pi 0.85.1 attaches it
// to the command context only), so the offer must fall back to a /reload
// hint instead of claiming it reloaded.

describe("accept with base-shape ctx (no reload)", () => {
  it("yes: fallback /reload hint notified, file written, flag persisted, no throw", async () => {
    const { ctx, confirm, notify } = makeCtx("tui");
    confirm.mockResolvedValue(true);

    await expect(offerKeybindingFix(ctx)).resolves.toBeUndefined();

    // File written with the exact snippet
    expect(fs.readFileSync(keybindingsPath(), "utf-8")).toBe(SNIPPET);
    // Flag persisted
    expect(readFlag()).toBe(true);
    // The truthful fallback message — no "reloading now" claim
    expect(
      callArgs(notify).some(
        (c) => c[0] === CREATED_RELOAD_HINT && c[1] === "info",
      ),
    ).toBe(true);
    expect(callArgs(notify).some((c) => c[0] === CREATED_NOTIFY)).toBe(false);
  });

  it("no path: no created notification at all", async () => {
    const { ctx, confirm, notify } = makeCtx("tui");
    confirm.mockResolvedValue(false);
    await offerKeybindingFix(ctx);
    expect(
      callArgs(notify).some(
        (c) => c[0] === CREATED_NOTIFY || c[0] === CREATED_RELOAD_HINT,
      ),
    ).toBe(false);
  });
});

// ── auto-reload branch: simulates a future Pi version that puts ────────────
// reload() on the event ctx. A reload-carrying ctx (makeCtx with
// { withReload: true }) covers that branch; the base-shape tests above
// cover current Pi.

describe("auto-reload branch (future Pi with reload on the event ctx)", () => {
  it("yes path: reload called exactly once after flag is persisted and CREATED_NOTIFY emitted", async () => {
    // Track invocation order so we can assert flag is persisted before reload.
    const order: string[] = [];
    const { ctx, confirm, notify, reload } = makeCtx("tui", { withReload: true });
    confirm.mockResolvedValue(true);
    // Wrap the reload spy to record when it's called relative to flag write.
    reload!.mockImplementation(async () => {
      // At this point the flag must already be persisted to disk.
      order.push(readFlag() ? "flag-then-reload" : "reload-before-flag");
    });
    notify.mockImplementation((...args: unknown[]) => {
      if ((args[0] as string) === CREATED_NOTIFY) order.push("notify");
    });

    await offerKeybindingFix(ctx);

    // reload called exactly once
    expect(reload).toHaveBeenCalledTimes(1);
    // flag was already set when reload ran
    expect(order).toContain("flag-then-reload");
    expect(order).not.toContain("reload-before-flag");
    // CREATED_NOTIFY emitted before reload
    const notifyIdx = order.indexOf("notify");
    const reloadIdx = order.indexOf("flag-then-reload");
    expect(notifyIdx).toBeGreaterThanOrEqual(0);
    expect(reloadIdx).toBeGreaterThan(notifyIdx);
    // File written
    expect(fs.readFileSync(keybindingsPath(), "utf-8")).toBe(SNIPPET);
    // CREATED_NOTIFY contains "reloading now"
    expect(CREATED_NOTIFY).toContain("reloading now");
  });

  it("no path: reload NOT called", async () => {
    const { ctx, confirm, reload } = makeCtx("tui", { withReload: true });
    confirm.mockResolvedValue(false);
    await offerKeybindingFix(ctx);
    expect(reload).not.toHaveBeenCalled();
  });

  it("cancel (resolves false) path: reload NOT called", async () => {
    const { ctx, confirm, reload } = makeCtx("tui", { withReload: true });
    confirm.mockResolvedValue(false); // Esc/timeout: same as no
    await offerKeybindingFix(ctx);
    expect(reload).not.toHaveBeenCalled();
  });

  it("file-write-fails path: reload NOT called", async () => {
    // Block the file write by making the tmp path a directory
    fs.mkdirSync(tmpPath(), { recursive: true });
    const { ctx, confirm, reload } = makeCtx("tui", { withReload: true });
    confirm.mockResolvedValue(true);
    await offerKeybindingFix(ctx);
    expect(reload).not.toHaveBeenCalled();
  });

  it("TOCTOU path: reload NOT called (file appeared before the rename)", async () => {
    // Same spy materialization as the concurrent-creation test: the file
    // appears between gate 4 and the pre-rename re-check, so the offer ends
    // before the reload step is ever reached.
    let kbHits = 0;
    existsSyncSpy.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === keybindingsPath()) {
        kbHits += 1;
        if (kbHits >= 2) {
          if (!fs.existsSync(s)) fs.writeFileSync(s, CONCURRENT_CONTENT, "utf-8");
          return true;
        }
      }
      return fs.existsSync(s);
    });

    const { ctx, confirm, reload } = makeCtx("tui", { withReload: true });
    confirm.mockResolvedValue(true);
    await offerKeybindingFix(ctx);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reload rejects: offer still resolves, flag persisted, file present, CREATED_NOTIFY emitted", async () => {
    const { ctx, confirm, notify, reload } = makeCtx("tui", { withReload: true });
    confirm.mockResolvedValue(true);
    reload!.mockRejectedValue(new Error("Reload failed"));

    await expect(offerKeybindingFix(ctx)).resolves.toBeUndefined();

    // File must have been written
    expect(fs.readFileSync(keybindingsPath(), "utf-8")).toBe(SNIPPET);
    // Flag must have been set (reload runs after flag)
    expect(readFlag()).toBe(true);
    // CREATED_NOTIFY must have been emitted (fires before reload)
    expect(
      (notify.mock.calls as unknown[][]).some(
        (c) => c[0] === CREATED_NOTIFY && c[1] === "info",
      ),
    ).toBe(true);
    // reload was still attempted once
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent creation is never clobbered", () => {
  it("file created between gate 4 and the pre-rename re-check: left intact, flag set", async () => {
    // Simulate: the first keybindings.json check (gate 4) sees nothing; the
    // second (pre-rename re-check) sees a file that a concurrent process just
    // created — the spy materializes it on that hit.
    let kbHits = 0;
    existsSyncSpy.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === keybindingsPath()) {
        kbHits += 1;
        // NOTE: coupled to the module's two existsSync calls — gate-4 check,
        // then the pre-rename re-check (keybinding-offer.ts). If the module
        // de-duplicates or adds an existence check, update kbHits accordingly.
        if (kbHits >= 2) {
          if (!fs.existsSync(s)) {
            fs.writeFileSync(s, CONCURRENT_CONTENT, "utf-8");
          }
          return true;
        }
      }
      return fs.existsSync(s);
    });

    const { ctx, confirm, notify } = makeCtx("tui");
    confirm.mockResolvedValue(true);

    await expect(offerKeybindingFix(ctx)).resolves.toBeUndefined();

    // The concurrently created file is never clobbered by the snippet
    expect(fs.readFileSync(keybindingsPath(), "utf-8")).toBe(CONCURRENT_CONTENT);
    expect(fs.readFileSync(keybindingsPath(), "utf-8")).not.toBe(SNIPPET);
    // The tmp file is cleaned up
    expect(fs.existsSync(tmpPath())).toBe(false);
    // The offer ends: the offer was made and the fix is in force (file exists)
    expect(readFlag()).toBe(true);
    // We did not create the file, so we do not claim to — and the offer
    // ends before any reload step (no "reloading now" / /reload-hint
    // notification either)
    expect(
      callArgs(notify).some(
        (c) => c[0] === CREATED_NOTIFY || c[0] === CREATED_RELOAD_HINT,
      ),
    ).toBe(false);
  });
});
