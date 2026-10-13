/**
 * Registration contract for the Archimedes `edit` / `write` presentation
 * (ADR 0029).
 *
 * Both tools used to be re-registered with `pi.registerTool()` purely to draw
 * them differently and to attach the diff details the renderers read. They are
 * now a renderer resolver plus a `tool_result` handler, so these tests pin:
 * nothing is registered, resolution answers only for the tool each installer
 * owns, the built-in's `renderShell` choice survives resolution, and the result
 * details the rows depend on still arrive.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { installEditTool } from "./edit.js";
import { installWriteTool } from "./write.js";

/** A `pi` handle that records what was registered. */
function fakePi() {
  const renderers: ((name: string, next: () => any) => any)[] = [];
  const handlers: Record<string, ((event: any) => any)[]> = {};
  const pi = {
    registerTool: (t: any) => {
      registered.push(t);
    },
    registerToolRenderer: (r: (name: string, next: () => any) => any) => {
      renderers.push(r);
    },
    on: (event: string, handler: (e: any) => any) => {
      (handlers[event] ??= []).push(handler);
      return () => {};
    },
  } as unknown as ExtensionAPI;
  const registered: any[] = [];
  return { pi, renderers, handlers, registered };
}

const NATIVE = Object.freeze({ native: true, renderShell: "default" });

function resolve(
  resolver: ((name: string, next: () => any) => any) | undefined,
  toolName: string,
) {
  let nextCalls = 0;
  const result = resolver?.(toolName, () => {
    nextCalls++;
    return NATIVE;
  });
  return { result, nextCalls };
}

function makeWorkspace(contents = "one\ntwo\nthree\n") {
  const dir = mkdtempSync(path.join(tmpdir(), "diff-reg-"));
  const file = path.join(dir, "note.txt");
  writeFileSync(file, contents);
  return { dir, file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const emit = (
  handlers: Record<string, ((event: any) => any)[]>,
  event: string,
  payload: any,
) => handlers[event]?.map((h) => h(payload)).find((r) => r !== undefined);

describe("edit registration", () => {
  it("registers no tool and resolves only `edit`", () => {
    const { pi, renderers, registered } = fakePi();
    installEditTool(pi, "/work", "/home");

    expect(registered).toHaveLength(0);
    expect(renderers).toHaveLength(1);
    expect(typeof resolve(renderers[0], "edit").result).toBe("object");
    expect(resolve(renderers[0], "write")).toEqual({ result: NATIVE, nextCalls: 1 });
  });

  it("keeps the built-in's own renderShell while replacing the renderers", () => {
    const { pi, renderers } = fakePi();
    installEditTool(pi, "/work", "/home");

    const { result } = resolve(renderers[0], "edit");
    expect(typeof result.renderCall).toBe("function");
    expect(typeof result.renderResult).toBe("function");
    // pi's edit definition draws its own shell; resolution must not lose it.
    expect(result.renderShell).toBe("self");
  });

  it("attaches a one-edit summary and the changed line to the result", () => {
    const { dir, file, done } = makeWorkspace("one\ntwo\nthree\n");
    try {
      const { pi, handlers } = fakePi();
      installEditTool(pi, dir, dir);
      writeFileSync(file, "one\n2\nthree\n");

      const out = emit(handlers, "tool_result", {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "c1",
        isError: false,
        input: { path: file, edits: [{ oldText: "two", newText: "2" }] },
        content: [{ type: "text", text: "ok" }],
        details: undefined,
      });

      expect(out?.details?._type).toBe("editInfo");
      expect(out?.details?.editLine).toBe(2);
      expect(out?.details?.summary).toBeTruthy();
    } finally {
      done();
    }
  });

  it("counts several edits in one call", () => {
    const { dir, file, done } = makeWorkspace();
    try {
      const { pi, handlers } = fakePi();
      installEditTool(pi, dir, dir);

      const out = emit(handlers, "tool_result", {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "c2",
        isError: false,
        input: {
          path: file,
          edits: [
            { oldText: "one", newText: "1" },
            { oldText: "two", newText: "2" },
          ],
        },
        content: [{ type: "text", text: "ok" }],
        details: undefined,
      });

      expect(out?.details?._type).toBe("multiEditInfo");
      expect(out?.details?.editCount).toBe(2);
    } finally {
      done();
    }
  });

  it("leaves a failed edit alone", () => {
    const { dir, file, done } = makeWorkspace();
    try {
      const { pi, handlers } = fakePi();
      installEditTool(pi, dir, dir);

      const out = emit(handlers, "tool_result", {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "c3",
        isError: true,
        input: { path: file, edits: [{ oldText: "nope", newText: "x" }] },
        content: [{ type: "text", text: "oldText not found" }],
        details: undefined,
      });

      expect(out).toBeUndefined();
    } finally {
      done();
    }
  });
});

describe("write registration", () => {
  it("registers no tool and resolves only `write`", () => {
    const { pi, renderers, registered } = fakePi();
    installWriteTool(pi, "/work", "/home", Text as any);

    expect(registered).toHaveLength(0);
    expect(resolve(renderers[0], "write").result?.renderShell).toBe("default");
    expect(resolve(renderers[0], "edit")).toEqual({ result: NATIVE, nextCalls: 1 });
  });

  it("diffs the replaced file against the content it displaces", () => {
    const { dir, file, done } = makeWorkspace("one\ntwo\n");
    try {
      const { pi, handlers } = fakePi();
      installWriteTool(pi, dir, dir, Text as any);

      emit(handlers, "tool_call", {
        type: "tool_call",
        toolName: "write",
        toolCallId: "w1",
        input: { path: file, content: "one\n2\n" },
      });
      writeFileSync(file, "one\n2\n");
      const out = emit(handlers, "tool_result", {
        type: "tool_result",
        toolName: "write",
        toolCallId: "w1",
        isError: false,
        input: { path: file, content: "one\n2\n" },
        content: [{ type: "text", text: "wrote" }],
        details: undefined,
      });

      expect(out?.details?._type).toBe("diff");
      expect(out?.details?.summary).toBeTruthy();
    } finally {
      done();
    }
  });

  it("reports a new file by line count", () => {
    const { dir, done } = makeWorkspace("");
    try {
      const fresh = path.join(dir, "fresh.txt");
      const { pi, handlers } = fakePi();
      installWriteTool(pi, dir, dir, Text as any);

      emit(handlers, "tool_call", {
        type: "tool_call",
        toolName: "write",
        toolCallId: "w2",
        input: { path: fresh, content: "a\nb\nc\n" },
      });
      const out = emit(handlers, "tool_result", {
        type: "tool_result",
        toolName: "write",
        toolCallId: "w2",
        isError: false,
        input: { path: fresh, content: "a\nb\nc\n" },
        content: [{ type: "text", text: "wrote" }],
        details: undefined,
      });

      expect(out?.details?._type).toBe("new");
      expect(out?.details?.lines).toBe(4);
    } finally {
      done();
    }
  });

  it("says so when the written content matches what was there", () => {
    const { dir, file, done } = makeWorkspace("same\n");
    try {
      const { pi, handlers } = fakePi();
      installWriteTool(pi, dir, dir, Text as any);

      emit(handlers, "tool_call", {
        type: "tool_call",
        toolName: "write",
        toolCallId: "w3",
        input: { path: file, content: "same\n" },
      });
      const out = emit(handlers, "tool_result", {
        type: "tool_result",
        toolName: "write",
        toolCallId: "w3",
        isError: false,
        input: { path: file, content: "same\n" },
        content: [{ type: "text", text: "wrote" }],
        details: undefined,
      });

      expect(out?.details?._type).toBe("noChange");
    } finally {
      done();
    }
  });
});
