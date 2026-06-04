const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;

const MODEL_SCOPE_RE = /Model scope:\s*(.+)/;
export const CAPTURED_MODELS = Symbol.for("splashscreen:capturedModels");
export const PATCHED_LOG = Symbol.for("splashscreen:logPatched");

export function patchConsoleLog(): void {
  if (g[PATCHED_LOG]) return;
  g[PATCHED_LOG] = true;
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    try {
      if (args.length === 1 && typeof args[0] === "string") {
        const plain = (args[0] as string).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const m = MODEL_SCOPE_RE.exec(plain);
        if (m) {
          const raw = m[1].replace(/\s*\(Ctrl\+\w[\w\s]*\)/gi, "");
          g[CAPTURED_MODELS] = raw
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
          return;
        }
      }
    } catch {
      /* ignore errors in patching logic */
    }
    origLog.apply(console, args);
  };
}
