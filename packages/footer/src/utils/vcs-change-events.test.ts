import { describe, it, expect, vi } from "vitest";
import { onVcsChange, notifyVcsChange } from "./vcs-change-events.js";

describe("vcs-change-events", () => {
  it("notifies every listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    onVcsChange(a);
    onVcsChange(b);
    notifyVcsChange();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onVcsChange(listener);
    unsubscribe();
    unsubscribe(); // idempotent
    notifyVcsChange();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener does not break the others or the publisher", () => {
    const bad = vi.fn(() => {
      throw new Error("dead footer");
    });
    const good = vi.fn();
    onVcsChange(bad);
    onVcsChange(good);
    expect(() => notifyVcsChange()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
