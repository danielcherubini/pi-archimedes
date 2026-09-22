import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetImage, mockGetNativeClipboard, mockConvertToPng, mockSpawn, mockSpawnSync } = vi.hoisted(() => {
  return {
    mockGetImage: vi.fn(),
    mockGetNativeClipboard: vi.fn(),
    mockConvertToPng: vi.fn(),
    mockSpawn: vi.fn(),
    mockSpawnSync: vi.fn(),
  };
});

vi.mock("@earendil-works/pi-tui", () => ({
  getNativeClipboard: mockGetNativeClipboard,
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  convertToPng: mockConvertToPng,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: mockSpawn,
    spawnSync: mockSpawnSync,
  };
});

import { readClipboardImage, readClipboardImageViaNativeModule } from "./clipboard.js";

function createMockChildProcess(stdoutData = "", exitCode = 0) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => {
    if (stdoutData) {
      child.stdout.emit("data", Buffer.from(stdoutData));
    }
    child.emit("close", exitCode);
  }, 5);
  return child;
}

describe("readClipboardImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("macOS path", () => {
    it("returns PNG image when getNativeClipboard() returns PNG bytes", async () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      mockGetImage.mockResolvedValue(pngBytes);
      mockGetNativeClipboard.mockReturnValue({ getImage: mockGetImage });

      const result = await readClipboardImage({ platform: "darwin", environment: {} });

      expect(mockGetNativeClipboard).toHaveBeenCalled();
      expect(mockGetImage).toHaveBeenCalled();
      expect(result).toEqual({
        bytes: pngBytes,
        mimeType: "image/png",
      });
    });

    it("returns null when getNativeClipboard() returns empty (null)", async () => {
      mockGetImage.mockResolvedValue(null);
      mockGetNativeClipboard.mockReturnValue({ getImage: mockGetImage });

      const result = await readClipboardImage({ platform: "darwin", environment: {} });

      expect(mockGetNativeClipboard).toHaveBeenCalled();
      expect(mockGetImage).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("returns null when getNativeClipboard() returns empty Uint8Array", async () => {
      mockGetImage.mockResolvedValue(new Uint8Array(0));
      mockGetNativeClipboard.mockReturnValue({ getImage: mockGetImage });

      const result = await readClipboardImage({ platform: "darwin", environment: {} });

      expect(mockGetNativeClipboard).toHaveBeenCalled();
      expect(mockGetImage).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("Windows path", () => {
    it("converts BMP bytes to PNG via convertToPng and returns { bytes, mimeType }", async () => {
      const bmpBytes = new Uint8Array([0x42, 0x4d, 0x10, 0x20, 0x30]);
      mockGetImage.mockResolvedValue(bmpBytes);
      mockGetNativeClipboard.mockReturnValue({ getImage: mockGetImage });

      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      const base64Png = Buffer.from(pngBytes).toString("base64");
      mockConvertToPng.mockResolvedValue({ data: base64Png, mimeType: "image/png" });

      const result = await readClipboardImage({ platform: "win32", environment: {} });

      expect(mockGetNativeClipboard).toHaveBeenCalled();
      expect(mockGetImage).toHaveBeenCalled();
      expect(mockConvertToPng).toHaveBeenCalledWith(
        Buffer.from(bmpBytes).toString("base64"),
        "image/bmp",
      );
      expect(result).toEqual({
        bytes: pngBytes,
        mimeType: "image/png",
      });
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("returns non-BMP bytes directly as image/png without convertToPng", async () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      mockGetImage.mockResolvedValue(pngBytes);
      mockGetNativeClipboard.mockReturnValue({ getImage: mockGetImage });

      const result = await readClipboardImage({ platform: "win32", environment: {} });

      expect(mockConvertToPng).not.toHaveBeenCalled();
      expect(result).toEqual({
        bytes: pngBytes,
        mimeType: "image/png",
      });
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("falls back to PowerShell when convertToPng returns null", async () => {
      const bmpBytes = new Uint8Array([0x42, 0x4d, 0x10, 0x20]);
      mockGetImage.mockResolvedValue(bmpBytes);
      mockGetNativeClipboard.mockReturnValue({ getImage: mockGetImage });
      mockConvertToPng.mockResolvedValue(null);

      const fallbackBytes = new Uint8Array([1, 2, 3, 4]);
      mockSpawn.mockImplementation(() =>
        createMockChildProcess(Buffer.from(fallbackBytes).toString("base64"), 0),
      );

      const result = await readClipboardImage({ platform: "win32", environment: {} });

      expect(mockConvertToPng).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalled();
      expect(result).toEqual({
        bytes: fallbackBytes,
        mimeType: "image/png",
      });
    });

    it("falls back to PowerShell when native.getImage() throws", async () => {
      mockGetImage.mockRejectedValue(new Error("Native failure"));
      mockGetNativeClipboard.mockReturnValue({ getImage: mockGetImage });

      const fallbackBytes = new Uint8Array([5, 6, 7, 8]);
      mockSpawn.mockImplementation(() =>
        createMockChildProcess(Buffer.from(fallbackBytes).toString("base64"), 0),
      );

      const result = await readClipboardImage({ platform: "win32", environment: {} });

      expect(mockSpawn).toHaveBeenCalled();
      expect(result).toEqual({
        bytes: fallbackBytes,
        mimeType: "image/png",
      });
    });

    it("falls back to PowerShell when getNativeClipboard() returns undefined", async () => {
      mockGetNativeClipboard.mockReturnValue(undefined);

      const fallbackBytes = new Uint8Array([9, 10, 11]);
      mockSpawn.mockImplementation(() =>
        createMockChildProcess(Buffer.from(fallbackBytes).toString("base64"), 0),
      );

      const result = await readClipboardImage({ platform: "win32", environment: {} });

      expect(mockSpawn).toHaveBeenCalled();
      expect(result).toEqual({
        bytes: fallbackBytes,
        mimeType: "image/png",
      });
    });

    it("logs a console.warn when PowerShell stdout exceeds MAX_BUFFER_BYTES", async () => {
      mockGetNativeClipboard.mockReturnValue(undefined);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.kill = vi.fn();
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          child.stdout.emit("data", Buffer.alloc(50 * 1024 * 1024 + 1));
          child.emit("close", 0);
        }, 5);
        return child;
      });

      const result = await readClipboardImage({ platform: "win32", environment: {} });

      expect(warnSpy).toHaveBeenCalledWith(
        "[archimedes] Clipboard image exceeded maximum buffer size (50MB)",
      );
      expect(result).toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe("Unavailable reader error messages", () => {
    it("reports pi-tui native clipboard or CLI tools instead of @mariozechner/clipboard on darwin", async () => {
      mockGetNativeClipboard.mockReturnValue(undefined);

      await expect(
        readClipboardImage({ platform: "darwin", environment: {} }),
      ).rejects.toThrow(/@earendil-works\/pi-tui native clipboard or CLI tools/);
    });

    it("reports pi-tui native clipboard or CLI tools instead of @mariozechner/clipboard on win32", async () => {
      mockGetNativeClipboard.mockReturnValue(undefined);
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.kill = vi.fn();
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          const err = new Error("Command not found") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          child.emit("error", err);
        }, 5);
        return child;
      });

      await expect(
        readClipboardImage({ platform: "win32", environment: {} }),
      ).rejects.toThrow(/@earendil-works\/pi-tui native clipboard or CLI tools/);
    });
  });

  describe("Linux paths", () => {
    it("prefers Wayland (wl-paste attempted first) when WAYLAND_DISPLAY is set", async () => {
      mockSpawnSync.mockImplementation((command: string, args: string[]) => {
        if (command === "wl-paste" && args[0] === "--list-types") {
          return { status: 0, stdout: Buffer.from("image/png\n"), error: undefined };
        }
        if (command === "wl-paste" && args[0] === "--type") {
          return { status: 0, stdout: Buffer.from([1, 2, 3, 4]), error: undefined };
        }
        return { status: 1, stdout: Buffer.alloc(0), error: undefined };
      });

      const result = await readClipboardImage({
        platform: "linux",
        environment: { WAYLAND_DISPLAY: "wayland-0" },
      });

      expect(mockSpawnSync).toHaveBeenCalled();
      expect(mockSpawnSync.mock.calls[0]![0]).toBe("wl-paste");
      expect(result).toEqual({
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: "image/png",
      });
    });

    it("prefers X11 (xclip attempted first) when DISPLAY is set without Wayland", async () => {
      mockSpawnSync.mockImplementation((command: string, args: string[]) => {
        if (command === "xclip" && args.includes("TARGETS")) {
          return { status: 0, stdout: Buffer.from("image/png\n"), error: undefined };
        }
        if (command === "xclip" && args.includes("image/png")) {
          return { status: 0, stdout: Buffer.from([5, 6, 7]), error: undefined };
        }
        return { status: 1, stdout: Buffer.alloc(0), error: undefined };
      });

      const result = await readClipboardImage({
        platform: "linux",
        environment: { DISPLAY: ":0" },
      });

      expect(mockSpawnSync).toHaveBeenCalled();
      expect(mockSpawnSync.mock.calls[0]![0]).toBe("xclip");
      expect(result).toEqual({
        bytes: new Uint8Array([5, 6, 7]),
        mimeType: "image/png",
      });
    });

    it("throws appropriate graphical session error when DISPLAY and WAYLAND_DISPLAY are missing", async () => {
      await expect(
        readClipboardImage({ platform: "linux", environment: {} }),
      ).rejects.toThrow(
        "Clipboard image paste requires a graphical desktop session with DISPLAY or WAYLAND_DISPLAY.",
      );
    });

    it("TERMUX_VERSION returns { available: false, image: null } from native module and null from readClipboardImage", async () => {
      const nativeResult = await readClipboardImageViaNativeModule("linux", {
        TERMUX_VERSION: "0.118.0",
        DISPLAY: ":0",
      });
      expect(nativeResult).toEqual({ available: false, image: null });

      const result = await readClipboardImage({
        platform: "linux",
        environment: { TERMUX_VERSION: "0.118.0", DISPLAY: ":0" },
      });
      expect(result).toBeNull();
    });
  });
});
