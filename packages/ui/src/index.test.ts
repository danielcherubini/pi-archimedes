import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { TUI, EditorTheme, Component } from "@earendil-works/pi-tui";

// ── Mock modules ─────────────────────────────────────────────────────────────

vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  removeConfig: vi.fn(),
}));

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    loadUIConfig: vi.fn(),
  };
});

vi.mock("./startup/capture.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startup/capture.js")>();
  return {
    ...actual,
    patchConsoleLog: vi.fn(),
    unpatchConsoleLog: vi.fn(),
  };
});

vi.mock("./thinking/patch.js", () => ({
  patchThinkingRenderer: vi.fn(),
}));

vi.mock("./thinking/transform.js", () => ({
  transformThinkingContent: vi.fn(),
}));

vi.mock("./startup/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startup/index.js")>();
  return {
    ...actual,
    renderHeader: vi.fn(() => ["header line"]),
    patchStartupListing: vi.fn(),
  };
});

vi.mock("./migration.js", () => ({
  migrateCoreToUIConfig: vi.fn(),
  UI_CONFIG_KEYS: [],
}));

vi.mock("./bash/index.js", () => ({
  registerBashToolOverride: vi.fn(),
  clearActiveBashIntervals: vi.fn(),
}));

import defaultExport, {
  registerUI,
  unpatchConsoleLog,
  getUISettingsItems,
  loadUIConfig,
  saveUIConfig,
  DEFAULT_UI_CONFIG,
  ANIMATION_STYLES,
} from "./index.js";
import { patchConsoleLog } from "./startup/capture.js";
import { migrateCoreToUIConfig } from "./migration.js";
import { registerBashToolOverride } from "./bash/index.js";
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import { renderHeader, patchStartupListing } from "./startup/index.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

interface UiSpies {
  setHeader: ReturnType<typeof vi.fn>;
  setEditorComponent: ReturnType<typeof vi.fn>;
  setWorkingVisible: ReturnType<typeof vi.fn>;
}

function makeCtx(hasUI = true): { ctx: ExtensionContext; ui: UiSpies } {
  const ui: UiSpies = {
    setHeader: vi.fn(),
    setEditorComponent: vi.fn(),
    setWorkingVisible: vi.fn(),
  };
  const ctx = {
    hasUI,
    cwd: "/workspace/test-project",
    ui: { ...ui, theme: {} as Theme },
    isIdle: vi.fn(() => true),
    shutdown: vi.fn(),
  } as unknown as ExtensionContext;
  return { ctx, ui };
}

function setupHarness(): {
  pi: ExtensionAPI;
  triggerStart: (ctx: ExtensionContext) => void;
  triggerShutdown: (ctx: ExtensionContext) => void;
  triggerMessageEnd: (msg: unknown) => void;
} {
  const listeners: Record<string, ((event: any, ctx: any) => void)[]> = {};
  const pi = {
    on: vi.fn((event: string, handler: (event: any, ctx: any) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event]!.push(handler);
    }),
    registerTool: vi.fn(),
  } as unknown as ExtensionAPI;

  registerUI(pi);

  return {
    pi,
    triggerStart: (ctx: ExtensionContext) => {
      for (const h of listeners["session_start"] ?? []) {
        h(null, ctx);
      }
    },
    triggerShutdown: (ctx: ExtensionContext) => {
      for (const h of listeners["session_shutdown"] ?? []) {
        h(null, ctx);
      }
    },
    triggerMessageEnd: (msg: unknown) => {
      for (const h of listeners["message_end"] ?? []) {
        h({ message: msg }, {} as any);
      }
    },
  };
}

describe("packages/ui lifecycle and registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("exports", () => {
    it("re-exports expected functions and constants", () => {
      expect(typeof unpatchConsoleLog).toBe("function");
      expect(typeof getUISettingsItems).toBe("function");
      expect(typeof loadUIConfig).toBe("function");
      expect(typeof saveUIConfig).toBe("function");
      expect(DEFAULT_UI_CONFIG).toBeDefined();
      expect(ANIMATION_STYLES).toBeDefined();
      expect(typeof defaultExport).toBe("function");
    });

    it("default export delegates to registerUI", () => {
      const pi = { on: vi.fn() } as unknown as ExtensionAPI;
      defaultExport(pi);
      expect(migrateCoreToUIConfig).toHaveBeenCalled();
      expect(patchConsoleLog).toHaveBeenCalled();
    });
  });

  describe("registerUI initialization", () => {
    it("calls migrateCoreToUIConfig and patchConsoleLog", () => {
      const { pi } = setupHarness();
      expect(migrateCoreToUIConfig).toHaveBeenCalledTimes(1);
      expect(patchConsoleLog).toHaveBeenCalledTimes(1);
      expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
      expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    });
  });

  describe("session_start with interactive UI (hasUI: true)", () => {
    it("configures bash tool override, header, editor, and thinking renderer", () => {
      const { triggerStart } = setupHarness();
      const { ctx, ui } = makeCtx(true);

      triggerStart(ctx);

      // Bash tool override
      expect(registerBashToolOverride).toHaveBeenCalledWith(expect.anything(), "/workspace/test-project");

      // Header installation
      expect(ui.setHeader).toHaveBeenCalledTimes(1);
      const headerFactory = ui.setHeader.mock.calls[0]![0];
      const fakeTui = { terminal: { rows: 24 } } as TUI;
      const fakeTheme = {} as Theme;
      const comp = headerFactory(fakeTui, fakeTheme);
      expect(typeof comp.render).toBe("function");
      comp.render(80);
      expect(renderHeader).toHaveBeenCalledWith(fakeTheme, expect.any(Object), 80, 21);
      expect(patchStartupListing).toHaveBeenCalledWith(fakeTui, fakeTheme, expect.any(Object));

      // Working visibility and Editor component
      expect(ui.setWorkingVisible).toHaveBeenCalledWith(false); // spinFlag is true by default
      expect(ui.setEditorComponent).toHaveBeenCalledTimes(1);
      const editorFactory = ui.setEditorComponent.mock.calls[0]![0];
      const editorInstance = editorFactory(fakeTui, { borderColor: (s: string) => s } as EditorTheme, {} as KeybindingsManager);
      expect(editorInstance).toBeDefined();
      (editorInstance as any).dispose?.();

      // Thinking renderer
      expect(patchThinkingRenderer).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          labelText: "Thinking...",
          labelColor: "255,215,0",
          autoCollapseThinking: false,
          compactThinking: "Off",
        }),
      );
    });

    it("respects editorSpinBorder: false by leaving workingVisible=true and not installing editor component", () => {
      vi.mocked(loadUIConfig).mockReturnValue({
        ...DEFAULT_UI_CONFIG,
        editorSpinBorder: false,
      });

      const { triggerStart } = setupHarness();
      const { ctx, ui } = makeCtx(true);

      triggerStart(ctx);

      expect(ui.setWorkingVisible).toHaveBeenCalledWith(true);
      expect(ui.setEditorComponent).not.toHaveBeenCalled();
    });

    it("skips bashToolOverride when bashToolStyling is false", () => {
      vi.mocked(loadUIConfig).mockReturnValue({
        ...DEFAULT_UI_CONFIG,
        bashToolStyling: false,
      });

      const { triggerStart } = setupHarness();
      const { ctx } = makeCtx(true);

      triggerStart(ctx);

      expect(registerBashToolOverride).not.toHaveBeenCalled();
    });

    it("triggers transformThinkingContent on message_end if codeUnindent is enabled", () => {
      vi.mocked(loadUIConfig).mockReturnValue({
        ...DEFAULT_UI_CONFIG,
        codeUnindent: true,
      });

      const { triggerStart, triggerMessageEnd } = setupHarness();
      const { ctx } = makeCtx(true);

      triggerStart(ctx);

      const msg = { role: "assistant", content: [] };
      triggerMessageEnd(msg);

      expect(transformThinkingContent).toHaveBeenCalledWith(msg);
    });

    it("skips transformThinkingContent on message_end if codeUnindent is false", () => {
      vi.mocked(loadUIConfig).mockReturnValue({
        ...DEFAULT_UI_CONFIG,
        codeUnindent: false,
      });

      const { triggerStart, triggerMessageEnd } = setupHarness();
      const { ctx } = makeCtx(true);

      triggerStart(ctx);

      const msg = { role: "assistant", content: [] };
      triggerMessageEnd(msg);

      expect(transformThinkingContent).not.toHaveBeenCalled();
    });
  });

  describe("session_start in non-interactive mode (hasUI: false)", () => {
    it("still registers bashToolOverride but skips UI setup", () => {
      const { triggerStart } = setupHarness();
      const { ctx, ui } = makeCtx(false);

      triggerStart(ctx);

      expect(registerBashToolOverride).toHaveBeenCalledWith(expect.anything(), "/workspace/test-project");
      expect(ui.setHeader).not.toHaveBeenCalled();
      expect(ui.setEditorComponent).not.toHaveBeenCalled();
      expect(patchThinkingRenderer).not.toHaveBeenCalled();
    });
  });

  describe("session_shutdown teardown", () => {
    it("restores unpatchConsoleLog, workingVisible, and clears editor component", () => {
      const { triggerStart, triggerShutdown } = setupHarness();
      const { ctx, ui } = makeCtx(true);

      triggerStart(ctx);

      // Verify startup
      expect(ui.setWorkingVisible).toHaveBeenCalledWith(false);

      // Now trigger shutdown
      triggerShutdown(ctx);

      expect(unpatchConsoleLog).toHaveBeenCalledTimes(1);
      expect(ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
      expect(ui.setEditorComponent).toHaveBeenLastCalledWith(undefined);
    });

    it("cleans up patched TUI container children on shutdown", () => {
      const { triggerStart, triggerShutdown } = setupHarness();
      const { ctx, ui } = makeCtx(true);

      triggerStart(ctx);

      const headerFactory = ui.setHeader.mock.calls[0]![0];
      const PATCHED_LISTING = Symbol.for("splashscreen:listingPatched");
      const ORIG_ADD_CHILD = Symbol.for("splashscreen:origAddChild");
      const ANIM_INTERVAL = Symbol.for("splashscreen:animInterval");
      const DEBOUNCE_TIMER = Symbol.for("splashscreen:debounceTimer");

      const origAddChildFn = vi.fn();
      const patchedChild = {
        [PATCHED_LISTING]: true,
        [ORIG_ADD_CHILD]: origAddChildFn,
        [ANIM_INTERVAL]: setInterval(() => {}, 10000),
        [DEBOUNCE_TIMER]: setTimeout(() => {}, 10000),
        addChild: vi.fn(),
      };

      const fakeTui = {
        terminal: { rows: 24 },
        children: [patchedChild],
      } as unknown as TUI;

      headerFactory(fakeTui, {} as Theme);

      // Now trigger shutdown
      triggerShutdown(ctx);

      expect(patchedChild.addChild).toBe(origAddChildFn);
      expect(patchedChild[PATCHED_LISTING]).toBe(false);
      expect(patchedChild[ORIG_ADD_CHILD]).toBeUndefined();
    });
  });
});
