import { randomUUID } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { KeyId } from "@earendil-works/pi-tui";

import { readClipboardImage } from "./clipboard.js";
import { registerImagePreview, sendPreviewMessage } from "./preview.js";
import type { ClipboardImage, PendingImage, ImageMarker } from "./types.js";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// ── Queue management ────────────────────────────────────────────

interface ImageQueue {
  images: PendingImage[];
  markers: ImageMarker[];
  nextIndex: number;
}

function createImageQueue(): ImageQueue {
  return { images: [], markers: [], nextIndex: 1 };
}

// Marker key: the visible text WITHOUT trailing space (e.g. "[Image #1]")
// This is used for both detection and replacement — consistent strategy.
function markerKey(marker: ImageMarker): string {
  return marker.text.trim();
}

function queueImage(
  queue: ImageQueue,
  image: ClipboardImage,
  ctx: ExtensionContext,
): ImageMarker {
  const id = randomUUID();
  const placeholder = `[Image #${queue.nextIndex}] `;

  const pending: PendingImage = {
    id,
    base64: Buffer.from(image.bytes).toString("base64"),
    mimeType: image.mimeType,
  };
  queue.images.push(pending);

  const marker: ImageMarker = {
    id,
    text: placeholder,
    index: queue.nextIndex,
  };
  queue.markers.push(marker);
  queue.nextIndex += 1;

  // Insert placeholder into editor
  ctx.ui.pasteToEditor(placeholder);
  return marker;
}

// ── Registration ────────────────────────────────────────────────

function getImagePasteShortcuts(): KeyId[] {
  if (process.platform === "win32") {
    return ["alt+v", "ctrl+alt+v"] as KeyId[];
  }
  return ["ctrl+v", "alt+v", "ctrl+alt+v"] as KeyId[];
}

// Module-level state — registered once, queue reset per session
let _ctx: ExtensionContext | null = null;
let _queue: ImageQueue | null = null;
let _pasting = false;

export function registerImagePaste(pi: ExtensionAPI): void {
  // Register preview renderer (once)
  registerImagePreview(pi);

  // Register shortcuts (once)
  const pasteImage = async (): Promise<void> => {
    if (_pasting) return; // Mutex: prevent concurrent paste operations
    if (!_ctx || !_queue || !_ctx.hasUI) return;
    _pasting = true;
    try {
      const image = await readClipboardImage();
      if (!image) {
        _ctx.ui.notify("No image found in clipboard.", "warning");
        return;
      }
      if (image.bytes.length > MAX_FILE_SIZE_BYTES) {
        _ctx.ui.notify(
          `Image too large (${(image.bytes.length / 1024 / 1024).toFixed(1)}MB > 20MB).`,
          "warning",
        );
        return;
      }
      queueImage(_queue, image, _ctx);
      _ctx.ui.notify("Image attached from clipboard.", "info");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      _ctx.ui.notify(`Image paste failed: ${msg}`, "warning");
    } finally {
      _pasting = false;
    }
  };

  for (const shortcut of getImagePasteShortcuts()) {
    pi.registerShortcut(shortcut, {
      description: "Attach clipboard image to draft",
      handler: pasteImage,
    });
  }

  // Input event handler — attach images on submit (once)
  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return { action: "continue" as const };
    }
    if (!_queue || !_queue.markers.length || !_ctx) {
      return { action: "continue" as const };
    }

    // ── Marker matching: use consistent key (trimmed text) ──
    let hasMarkers = false;
    for (const marker of _queue.markers) {
      if (event.text.includes(markerKey(marker))) {
        hasMarkers = true;
        break;
      }
    }

    if (!hasMarkers) {
      // No markers found — clear queue (user removed them)
      _queue.images.length = 0;
      _queue.markers.length = 0;
      _queue.nextIndex = 1;
      return { action: "continue" as const };
    }

    // Match markers to images using trimmed key
    const imagesToAttach: PendingImage[] = [];

    for (const marker of _queue.markers) {
      const key = markerKey(marker);
      if (event.text.includes(key)) {
        const pending = _queue.images.find((img) => img.id === marker.id);
        if (pending) {
          imagesToAttach.push(pending);
        }
      }
    }

    // Clear queue
    _queue.images.length = 0;
    _queue.markers.length = 0;
    _queue.nextIndex = 1;

    if (imagesToAttach.length === 0) {
      return { action: "continue" as const };
    }

    // Send preview message for TUI display (images are invisible in user messages)
    try {
      sendPreviewMessage(pi, imagesToAttach);
    } catch {
      // Preview is optional — don't fail the submit
    }

    return {
      action: "transform" as const,
      text: event.text,
      images: imagesToAttach.map((img) => ({
        type: "image" as const,
        data: img.base64,
        mimeType: img.mimeType,
      })),
    };
  });
}

// Called on session_start to initialize/reset the queue
export function initImagePasteSession(ctx: ExtensionContext): void {
  _ctx = ctx;
  _queue = createImageQueue();
}

// Called on session_shutdown to clear state
export function shutdownImagePaste(): void {
  _ctx = null;
  _queue = null;
  _pasting = false;
}
