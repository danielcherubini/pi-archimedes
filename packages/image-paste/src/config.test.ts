import { describe, expect, it, vi } from "vitest";

vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: vi.fn(),
}));

const {
  DEFAULT_IMAGE_PASTE_CONFIG,
  loadImagePasteConfig,
  resolveImagePasteShortcuts,
} = await import("./config.js");
const { loadConfig } = await import("@pi-archimedes/core/settings-io");

describe("resolveImagePasteShortcuts", () => {
  it("uses the established Linux defaults", () => {
    expect(resolveImagePasteShortcuts("linux", undefined)).toEqual([
      "ctrl+v",
      "alt+v",
      "ctrl+alt+v",
    ]);
  });

  it("uses the established Windows defaults", () => {
    expect(resolveImagePasteShortcuts("win32", undefined)).toEqual([
      "alt+v",
      "ctrl+alt+v",
    ]);
  });

  it("uses configured shortcuts exactly", () => {
    expect(resolveImagePasteShortcuts("linux", ["ctrl+shift+v", "ctrl+alt+v"])).toEqual([
      "ctrl+shift+v",
      "ctrl+alt+v",
    ]);
  });

  it("allows an empty array to disable shortcuts", () => {
    expect(resolveImagePasteShortcuts("linux", [])).toEqual([]);
  });

  it("falls back to platform defaults for non-string configuration entries", () => {
    expect(resolveImagePasteShortcuts("linux", ["ctrl+shift+v", 42])).toEqual([
      "ctrl+v",
      "alt+v",
      "ctrl+alt+v",
    ]);
  });

  it("falls back to platform defaults for unsupported shortcut identifiers", () => {
    expect(resolveImagePasteShortcuts("linux", ["ctrl+zzz"])).toEqual([
      "ctrl+v",
      "alt+v",
      "ctrl+alt+v",
    ]);
  });

  it("falls back to platform defaults when valid and invalid shortcuts are mixed", () => {
    expect(resolveImagePasteShortcuts("linux", ["ctrl+shift+v", "ctrl+zzz"])).toEqual([
      "ctrl+v",
      "alt+v",
      "ctrl+alt+v",
    ]);
  });
});

describe("loadImagePasteConfig", () => {
  it("uses the established image-paste namespace", () => {
    vi.mocked(loadConfig).mockReturnValue(DEFAULT_IMAGE_PASTE_CONFIG);

    expect(loadImagePasteConfig()).toEqual(DEFAULT_IMAGE_PASTE_CONFIG);
    expect(loadConfig).toHaveBeenCalledWith(
      "archimedes.imagePaste",
      DEFAULT_IMAGE_PASTE_CONFIG,
    );
  });
});
