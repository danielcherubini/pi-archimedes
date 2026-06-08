const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;

const MODEL_SCOPE_RE = /Model scope:\s*(.+)/;
export const CAPTURED_MODELS = Symbol.for("splashscreen:capturedModels");
export const PATCHED_LOG = Symbol.for("splashscreen:logPatched");

// Store original console.log for restoration
let _origLog: typeof console.log | undefined;

export function patchConsoleLog(): void {
  if (g[PATCHED_LOG]) return;
  g[PATCHED_LOG] = true;
  _origLog = console.log;

  console.log = (...args: unknown[]) => {
    try {
      if (args.length === 1 && typeof args[0] === "string") {
        const plain = (args[0] as string).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const m = MODEL_SCOPE_RE.exec(plain);
        if (m) {
          const raw = m[1]!.replace(/\s*\(Ctrl\+\w[\w\s]*\)/gi, "");
          g[CAPTURED_MODELS] = raw
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
          // Unpatch once captured — no need to keep intercepting
          unpatchConsoleLog();
          return;
        }
      }
    } catch (err) {
      // Log the error but don't suppress the original call
      console.error("[archimedes] Error in console.log patch:", err);
    }
    _origLog!.apply(console, args);
  };
}

/** Restore original console.log — call on session_shutdown. */
export function unpatchConsoleLog(): void {
  if (!g[PATCHED_LOG]) return;
  g[PATCHED_LOG] = false;
  if (_origLog) {
    console.log = _origLog;
    _origLog = undefined;
  }
}
