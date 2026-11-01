import { beforeEach, describe, expect, it, vi } from "vitest";

// `archimedes.imagePaste.preview: false` skips the inline preview message on
// submit; the image still attaches and the paste-time notify still fires.
//
// Settings: `core/settings-io` captures `join(getAgentDir(), "settings.json")`
// at module load, hence one scratch dir for the whole file, rewritten per case.
// Clipboard: the readers are mocked so a paste yields image bytes without
// shelling out.

const { tempDir, fs, join, mockReadClipboardImage } = vi.hoisted(() => {
  const fs = require("node:fs");
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { randomUUID } = require("node:crypto");
  const dir = join(tmpdir(), `image-paste-preview-setting-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return { tempDir: dir, fs, join, mockReadClipboardImage: vi.fn() };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempDir,
  convertToPng: () => undefined,
}));

vi.mock("./clipboard.js", () => ({
  readClipboardImage: mockReadClipboardImage,
  readClipboardFilePaths: vi.fn(async () => null),
  readClipboardText: vi.fn(async () => null),
  buildPathInsertion: vi.fn(),
  clipboardTextForEditor: vi.fn(),
}));

const { registerImagePaste, initImagePasteSession, shutdownImagePaste } = await import("./index.js");

const NAMESPACE = "archimedes.imagePaste";
const settingsPath = (): string => join(tempDir, "settings.json");

function writeSettings(imagePaste: Record<string, unknown> | undefined): void {
  const settings: Record<string, unknown> = {};
  if (imagePaste !== undefined) settings[NAMESPACE] = imagePaste;
  fs.writeFileSync(settingsPath(), JSON.stringify(settings), "utf-8");
}

type Handler = (...args: unknown[]) => unknown;

/** Register, paste one image through the shortcut, submit it; report what happened. */
async function pasteAndSubmit() {
  const pi = {
    on: vi.fn(),
    registerShortcut: vi.fn(),
    registerMessageRenderer: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
  };
  const notify = vi.fn();
  const ctx = { hasUI: true, ui: { notify, pasteToEditor: vi.fn() } };

  registerImagePaste(pi as never);
  initImagePasteSession(ctx as never);

  const paste = pi.registerShortcut.mock.calls[0]![1].handler as Handler;
  await paste(ctx);

  const input = pi.on.mock.calls.find((call) => call[0] === "input")![1] as Handler;
  const result = (await input({ text: "[Image #1] look", source: "interactive" })) as {
    action: string;
    images?: unknown[];
  };

  return { pi, notify, result };
}

beforeEach(() => {
  fs.rmSync(settingsPath(), { force: true });
  shutdownImagePaste();
  mockReadClipboardImage.mockReset();
  mockReadClipboardImage.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
});

describe("archimedes.imagePaste.preview", () => {
  it("sends the preview when the setting is absent", async () => {
    const { pi, result } = await pasteAndSubmit();
    expect(result.action).toBe("transform");
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends the preview when preview is true", async () => {
    writeSettings({ preview: true });
    const { pi } = await pasteAndSubmit();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("skips the preview when preview is false, but still notifies and attaches", async () => {
    writeSettings({ preview: false });
    const { pi, notify, result } = await pasteAndSubmit();

    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Image attached from clipboard.", "info");
    expect(result.action).toBe("transform");
    expect(result.images).toHaveLength(1);
  });

  it("treats a value that is not the boolean false as on", async () => {
    for (const value of ["false", 0]) {
      writeSettings({ preview: value });
      shutdownImagePaste();
      const { pi } = await pasteAndSubmit();
      expect(pi.sendMessage, `preview=${JSON.stringify(value)}`).toHaveBeenCalledTimes(1);
    }
  });
});
