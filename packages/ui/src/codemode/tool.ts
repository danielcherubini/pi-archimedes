import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCodemodeModule } from "./loader.js";
import {
  renderCodemodeCall,
  renderCodemodeResult,
  clearActiveCodemodeIntervals,
} from "./renderer.js";

export { clearActiveCodemodeIntervals } from "./renderer.js";

/**
 * Register an Archimedes-styled override of the `codemode` tool.
 *
 * `codemode` is a replaceable pi built-in extension: registering a tool with
 * the same name takes over completely (pi omits the built-in one), so the
 * override must reproduce the built-in's full definition — the QuickJS
 * sandbox executor, the dynamic `prepareLoadout` description, the
 * `model-only` exposure, and `defaultActive: false` (the built-in registers
 * codemode inactive; it is activated via `--tools`, `defaultTools`, or MCP
 * auto-enable). Only the presentation is replaced.
 *
 * The definition is built from the running CLI's own copy of the codemode
 * module (see {@link loadCodemodeModule}) so the executor matches what the
 * CLI expects. The `parameters` reference is preserved from the built-in's
 * registration when it is still visible (`pi.getAllTools()`): the CLI's
 * MCP and tool-search extensions recognise the codemode tool by schema
 * identity (`isCodemodeTool`), and a fresh schema object from a second
 * module instance would defeat those checks.
 *
 * Returns `false` when the codemode module cannot be loaded (e.g. a pi
 * version without the codemode extension) — pi's native rendering then
 * stands in.
 *
 * Note: the take-over makes pi print a startup notice ("built-in extension
 * `codemode` was not loaded") — the same notice a third-party MCP extension
 * triggers when it replaces the built-in MCP extension. It is informational:
 * the tool still works, now with this package's renderers. Set
 * `codemodeToolStyling` to `false` to run the native tool instead.
 */
export async function registerCodemodeToolOverride(
  pi: ExtensionAPI,
): Promise<boolean> {
  const mod = await loadCodemodeModule();
  if (!mod) return false;

  const def = mod.createCodemodeToolDefinition({
    appendEntry: (customType: string, data: unknown) =>
      pi.appendEntry(customType, data),
    models: true,
    getToolNamespace: (name: string) =>
      (pi.getAllTools().find((t) => t.name === name) as {
        namespace?: unknown;
      } | undefined)?.namespace,
    // `getSettings` is newer than the oldest pi this package type-checks
    // against; read it defensively (the built-in extension's wiring).
    getMode: () =>
      readSettings(pi)?.codemode?.mode === "only" ? "only" : "on",
    getInlineBudget: () => {
      const budget = readSettings(pi)?.codemode?.inlineBudget;
      return typeof budget === "number" && Number.isFinite(budget) && budget >= 0
        ? budget
        : undefined;
    },
  }) as Record<string, unknown>;

  // The built-in (when loaded) is still registered at this point: keep its
  // schema object reference so `isCodemodeTool` identity checks keep working.
  const native = pi.getAllTools().find((t) => t.name === "codemode");
  if (native?.parameters !== undefined) {
    def.parameters = native.parameters;
  }

  pi.registerTool({
    ...def,
    renderCall: renderCodemodeCall,
    renderResult: renderCodemodeResult,
    defaultActive: false,
  } as never);
  return true;
}

function readSettings(
  pi: ExtensionAPI,
): { codemode?: { mode?: string; inlineBudget?: unknown } } | undefined {
  const getSettings = (
    pi as unknown as { getSettings?: () => unknown }
  ).getSettings;
  if (typeof getSettings !== "function") return undefined;
  try {
    return getSettings.call(pi) as
      | { codemode?: { mode?: string; inlineBudget?: unknown } }
      | undefined;
  } catch {
    return undefined;
  }
}
