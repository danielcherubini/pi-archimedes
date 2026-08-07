import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { streamEvents } from "./stream.js";

type FakeChild = ChildProcess & { stdout: PassThrough; stderr: PassThrough };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  return child;
}

async function finishWith(events: Array<Record<string, unknown>>) {
  const child = fakeChild();
  const result = streamEvents(child);
  for (const event of events) {
    child.stdout.write(`${JSON.stringify(event)}\n`);
  }
  child.emit("close", 0);
  return result;
}

describe("streamEvents session identity", () => {
  it("returns the logical child Pi session ID", async () => {
    const result = await finishWith([{
      type: "session",
      id: "00000000-0000-7000-8000-000000000003",
    }]);

    expect(result.childSessionId).toBe("00000000-0000-7000-8000-000000000003");
  });

  it("omits the child session ID when no valid session event arrives", async () => {
    const result = await finishWith([
      { type: "session" },
      { type: "session", id: 42 },
    ]);

    expect(result.childSessionId).toBeUndefined();
  });
});
