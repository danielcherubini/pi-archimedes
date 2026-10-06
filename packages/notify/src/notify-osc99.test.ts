import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyOSC99 } from "./index.js";

describe("notifyOSC99", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("emits the body text as the OSC 99 body payload, not as the payload type", () => {
		vi.stubEnv("TMUX", "");
		const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		notifyOSC99("Pi", "Task complete — waiting for input");

		expect(write.mock.calls.map(([chunk]) => chunk)).toEqual([
			"\x1b]99;i=1:d=0;Pi\x1b\\",
			"\x1b]99;i=1:p=body;Task complete — waiting for input\x1b\\",
		]);
	});
});
