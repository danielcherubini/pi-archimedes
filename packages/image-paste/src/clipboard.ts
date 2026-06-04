import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import type { ClipboardImage } from "./types.js";

const require = createRequire(import.meta.url);

const LIST_TYPES_TIMEOUT_MS = 1000;
const READ_TIMEOUT_MS = 5000;
const MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
] as const;

let cachedClipboardModule: ClipboardModule | null | undefined;

interface ClipboardModule {
  hasImage: () => boolean;
  getImageBinary: () => Promise<Array<number> | Uint8Array>;
}

interface CommandResult {
  ok: boolean;
  stdout: Buffer;
  missingCommand: boolean;
}

interface ClipboardReadResult {
  available: boolean;
  image: ClipboardImage | null;
}

function isErrnoException(error: Error): error is NodeJS.ErrnoException {
  return "code" in error;
}

function hasGraphicalSession(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): boolean {
  return platform !== "linux" || Boolean(environment.DISPLAY || environment.WAYLAND_DISPLAY);
}

function isWaylandSession(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.WAYLAND_DISPLAY) || environment.XDG_SESSION_TYPE === "wayland";
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function selectPreferredImageMimeType(mimeTypes: readonly string[]): string | null {
  const normalized = mimeTypes
    .map((mimeType) => mimeType.trim())
    .filter((mimeType) => mimeType.length > 0)
    .map((mimeType) => ({ raw: mimeType, normalized: normalizeMimeType(mimeType) }));

  for (const preferredMimeType of SUPPORTED_IMAGE_MIME_TYPES) {
    const match = normalized.find((mimeType) => mimeType.normalized === preferredMimeType);
    if (match) {
      return match.raw;
    }
  }

  const firstImage = normalized.find((mimeType) => mimeType.normalized.startsWith("image/"));
  return firstImage?.raw ?? null;
}

function loadClipboardModule(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): ClipboardModule | null {
  if (cachedClipboardModule !== undefined) {
    return cachedClipboardModule;
  }

  if (environment.TERMUX_VERSION || !hasGraphicalSession(platform, environment)) {
    cachedClipboardModule = null;
    return cachedClipboardModule;
  }

  try {
    cachedClipboardModule = require("@mariozechner/clipboard") as ClipboardModule;
  } catch {
    cachedClipboardModule = null;
  }

  return cachedClipboardModule;
}

async function readClipboardImageViaNativeModule(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): Promise<ClipboardReadResult> {
  const clipboard = loadClipboardModule(platform, environment);
  if (!clipboard) {
    return { available: false, image: null };
  }

  if (!clipboard.hasImage()) {
    return { available: true, image: null };
  }

  const imageData = await clipboard.getImageBinary();
  if (!imageData || imageData.length === 0) {
    return { available: true, image: null };
  }

  const bytes = imageData instanceof Uint8Array ? imageData : Uint8Array.from(imageData);
  return {
    available: true,
    image: {
      bytes,
      mimeType: "image/png",
    },
  };
}

function runCommand(
  command: string,
  args: string[],
  timeout: number,
): CommandResult {
  const result = spawnSync(command, args, {
    timeout,
    maxBuffer: MAX_BUFFER_BYTES,
  });

  if (result.error) {
    return {
      ok: false,
      stdout: Buffer.alloc(0),
      missingCommand: isErrnoException(result.error) && result.error.code === "ENOENT",
    };
  }

  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? "", typeof result.stdout === "string" ? "utf8" : undefined);

  return {
    ok: result.status === 0,
    stdout,
    missingCommand: false,
  };
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function readClipboardImageViaPowerShell(): ClipboardReadResult {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  return
}

$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
  return
}

$stream = New-Object System.IO.MemoryStream
try {
  $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.Convert]::ToBase64String($stream.ToArray())
} finally {
  $stream.Dispose()
  $image.Dispose()
}
`;

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-STA",
      "-EncodedCommand",
      encodePowerShell(script),
    ],
    {
      encoding: "utf8",
      timeout: READ_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    },
  );

  if (result.error) {
    return {
      available: !isErrnoException(result.error) || result.error.code !== "ENOENT",
      image: null,
    };
  }

  if (result.status !== 0) {
    return { available: true, image: null };
  }

  const base64 = result.stdout.trim();
  if (!base64) {
    return { available: true, image: null };
  }

  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) {
      return { available: true, image: null };
    }

    return {
      available: true,
      image: {
        bytes: new Uint8Array(bytes),
        mimeType: "image/png",
      },
    };
  } catch {
    return { available: true, image: null };
  }
}

function readClipboardImageViaWlPaste(): ClipboardReadResult {
  const listTypes = runCommand("wl-paste", ["--list-types"], LIST_TYPES_TIMEOUT_MS);
  if (listTypes.missingCommand) {
    return { available: false, image: null };
  }

  if (!listTypes.ok) {
    return { available: true, image: null };
  }

  const mimeTypes = listTypes.stdout
    .toString("utf8")
    .split(/\r?\n/)
    .map((mimeType) => mimeType.trim())
    .filter((mimeType) => mimeType.length > 0);

  const selectedMimeType = selectPreferredImageMimeType(mimeTypes);
  if (!selectedMimeType) {
    return { available: true, image: null };
  }

  const imageData = runCommand(
    "wl-paste",
    ["--type", selectedMimeType, "--no-newline"],
    READ_TIMEOUT_MS,
  );

  if (!imageData.ok || imageData.stdout.length === 0) {
    return { available: true, image: null };
  }

  return {
    available: true,
    image: {
      bytes: new Uint8Array(imageData.stdout),
      mimeType: normalizeMimeType(selectedMimeType),
    },
  };
}

function readClipboardImageViaXclip(): ClipboardReadResult {
  const targets = runCommand(
    "xclip",
    ["-selection", "clipboard", "-t", "TARGETS", "-o"],
    LIST_TYPES_TIMEOUT_MS,
  );

  if (targets.missingCommand) {
    return { available: false, image: null };
  }

  const advertisedMimeTypes = targets.ok
    ? targets.stdout
        .toString("utf8")
        .split(/\r?\n/)
        .map((mimeType) => mimeType.trim())
        .filter((mimeType) => mimeType.length > 0)
    : [];

  const preferredMimeType =
    advertisedMimeTypes.length > 0 ? selectPreferredImageMimeType(advertisedMimeTypes) : null;
  const mimeTypesToTry = preferredMimeType
    ? [preferredMimeType, ...SUPPORTED_IMAGE_MIME_TYPES]
    : [...SUPPORTED_IMAGE_MIME_TYPES];

  for (const mimeType of mimeTypesToTry) {
    const imageData = runCommand(
      "xclip",
      ["-selection", "clipboard", "-t", mimeType, "-o"],
      READ_TIMEOUT_MS,
    );

    if (imageData.ok && imageData.stdout.length > 0) {
      return {
        available: true,
        image: {
          bytes: new Uint8Array(imageData.stdout),
          mimeType: normalizeMimeType(mimeType),
        },
      };
    }
  }

  return { available: true, image: null };
}

function getUnavailableReaderMessage(platform: NodeJS.Platform): string {
  switch (platform) {
    case "linux":
      return "No Linux clipboard image reader is available. Install wl-clipboard or xclip, or ensure @mariozechner/clipboard is installed.";
    case "darwin":
      return "No macOS clipboard image reader is available. Ensure @mariozechner/clipboard is installed.";
    case "win32":
      return "No Windows clipboard image reader is available. Ensure PowerShell is available or @mariozechner/clipboard is installed.";
    default:
      return `Clipboard image paste is not supported on platform: ${platform}`;
  }
}

export async function readClipboardImage(options?: {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<ClipboardImage | null> {
  const environment = options?.environment ?? process.env;
  const platform = options?.platform ?? process.platform;

  if (environment.TERMUX_VERSION) {
    return null;
  }

  if (!hasGraphicalSession(platform, environment)) {
    throw new Error("Clipboard image paste requires a graphical desktop session with DISPLAY or WAYLAND_DISPLAY.");
  }

  const readerResults: ClipboardReadResult[] = [];

  const recordResult = (result: ClipboardReadResult): ClipboardImage | null => {
    readerResults.push(result);
    return result.image;
  };

  if (platform === "win32") {
    const nativeImage = recordResult(await readClipboardImageViaNativeModule(platform, environment));
    if (nativeImage) {
      return nativeImage;
    }

    const powerShellImage = recordResult(readClipboardImageViaPowerShell());
    if (powerShellImage) {
      return powerShellImage;
    }
  } else if (platform === "linux") {
    const sessionReaders = isWaylandSession(environment)
      ? [readClipboardImageViaWlPaste, readClipboardImageViaXclip]
      : [readClipboardImageViaXclip, readClipboardImageViaWlPaste];

    for (const reader of sessionReaders) {
      const image = recordResult(reader());
      if (image) {
        return image;
      }
    }

    const nativeImage = recordResult(await readClipboardImageViaNativeModule(platform, environment));
    if (nativeImage) {
      return nativeImage;
    }
  } else {
    const nativeImage = recordResult(await readClipboardImageViaNativeModule(platform, environment));
    if (nativeImage) {
      return nativeImage;
    }
  }

  if (readerResults.some((result) => result.available)) {
    return null;
  }

  throw new Error(getUnavailableReaderMessage(platform));
}

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export function isImageFilePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(path.toLowerCase().split(".").pop() ?? "");
}

export async function readFileAsImage(filePath: string): Promise<ClipboardImage | null> {
  if (!existsSync(filePath)) return null;
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  const mimeMap: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
  };
  const mimeType = mimeMap[ext];
  if (!mimeType) return null;
  try {
    const bytes = await readFile(filePath);
    if (bytes.length === 0) return null;
    return { bytes: new Uint8Array(bytes), mimeType };
  } catch {
    return null;
  }
}
