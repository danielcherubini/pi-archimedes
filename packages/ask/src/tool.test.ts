import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Events } from "@pi-archimedes/core/bus";
import { registerAskTool } from "./tool.js";
import { registerIpcRelay } from "./ipc-relay.js";

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// Bus: an in-memory pub/sub whose `emit` is a spy (records + dispatches), so
// tests can assert on emitted payloads while still letting the relay's
// `on(ASK_REQUEST)` subscription receive them.
// Bridge: a mutable state object — `active` flips per test, `ask` is a vi.fn.
// Picker/dialog: mocked so the TUI branch never touches the real TUI.

const { busState, bridgeState } = vi.hoisted(() => {
	const listeners: Record<string, Array<(p: unknown) => void>> = {};
	const emit = vi.fn((event: string, payload: unknown) => {
		for (const fn of listeners[event] ?? []) {
			Promise.resolve(fn(payload)).catch(() => {
				/* listener errors are not under test here */
			});
		}
	});
	const on = (event: string, fn: (p: unknown) => void) => {
		(listeners[event] ??= []).push(fn);
		return () => {
			const subs = listeners[event] ?? [];
			const i = subs.indexOf(fn);
			if (i !== -1) subs.splice(i, 1);
		};
	};
	const ask = vi.fn();
	return {
		busState: { listeners, emit, on },
		bridgeState: {
			active: false,
			ask,
			confirm: vi.fn(),
			password: vi.fn(),
			state: vi.fn(() => "idle"),
		},
	};
});

vi.mock("@pi-archimedes/core/bus", async (importOriginal) => {
	const actual = await importOriginal() as typeof import("@pi-archimedes/core/bus");
	return { ...actual, getBus: () => ({ emit: busState.emit, on: busState.on }) };
});

vi.mock("@pi-archimedes/core/bridge", () => ({
	getBridge: () => bridgeState,
}));

vi.mock("./picker.js", () => ({
	askSingleQuestionWithInlineNote: vi.fn(),
}));

vi.mock("./dialog.js", () => ({
	askQuestionsWithTabs: vi.fn(),
}));

const { askSingleQuestionWithInlineNote } = await import("./picker.js");
const { askQuestionsWithTabs } = await import("./dialog.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function captureTool(): {
	execute: (
		id: string,
		params: { questions: unknown[] },
		signal: unknown,
		onUpdate: unknown,
		ctx: unknown,
	) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
} {
	const registered: Array<Record<string, unknown>> = [];
	registerAskTool({ registerTool: (t: Record<string, unknown>) => registered.push(t) } as unknown as ExtensionAPI);
	return registered[0] as ReturnType<typeof captureTool>;
}

function makeParams(): { questions: unknown[] } {
	return {
		questions: [
			{
				id: "q1",
				question: "Which option?",
				description: "Some context",
				options: [{ label: "A" }, { label: "B" }],
			},
		],
	};
}

/** The payloads of the recorded `emit` calls for the given event. */
function emitted(event: string): Record<string, unknown>[] {
	return busState.emit.mock.calls
		.filter((c) => c[0] === event)
		.map((c) => c[1]!) as Record<string, unknown>[];
}

// Relay subscriptions are tracked file-wide and torn down in afterEach (not at
// the end of each test body) so a failing assertion cannot leak a live relay
// handler into the next test (double registration → double ASK_RESPONSE).
const relayUnsubs: Array<() => void> = [];

afterEach(() => {
	relayUnsubs.splice(0).forEach((u) => u());
});

beforeEach(() => {
	busState.emit.mockClear();
	bridgeState.active = false;
	bridgeState.ask.mockReset();
	vi.mocked(askSingleQuestionWithInlineNote).mockReset();
	vi.mocked(askQuestionsWithTabs).mockReset();
});

// ── Bridge branch (checked first) ────────────────────────────────────────────

describe("bridge branch", () => {
	it("emits ASK_REQUEST (main) with toolCallId, then a paired ASK_RESPONSE, and returns the built results", async () => {
		bridgeState.active = true;
		bridgeState.ask.mockResolvedValue({
			cancelled: false,
			results: [{ id: "q1", selectedOptions: ["B"], customInput: "extra" }],
		});

		const tool = captureTool();
		const result = await tool.execute("tool-1", makeParams(), undefined, undefined, { hasUI: true, ui: {} });

		// bridge.ask was called with the params + toolCallId + the turn's AbortSignal
		// (undefined here — the test passes no signal)
		expect(bridgeState.ask).toHaveBeenCalledTimes(1);
		expect(bridgeState.ask).toHaveBeenCalledWith({ questions: makeParams().questions }, "tool-1", undefined);

		// ASK_REQUEST (main) with toolCallId
		expect(emitted(Events.ASK_REQUEST).length).toBe(1);
		const req = emitted(Events.ASK_REQUEST)[0]!;
		expect(req.source).toBe("main");
		expect(req.toolCallId).toBe("tool-1");
		expect(req.questions).toEqual(makeParams().questions);
		expect(typeof req.requestId).toBe("string");

		// Paired ASK_RESPONSE (same requestId, the bridge's response verbatim)
		expect(emitted(Events.ASK_RESPONSE).length).toBe(1);
		const resp = emitted(Events.ASK_RESPONSE)[0]!;
		expect(resp.requestId).toBe(req.requestId);
		expect(resp.cancelled).toBe(false);
		expect(resp.results).toEqual([{ id: "q1", selectedOptions: ["B"], customInput: "extra" }]);

		// Built results in the returned content
		expect(result.content[0]!.text).toContain("q1: B + Other: \"extra\"");
	});

	it("a rejected bridge.ask() still emits the paired ASK_RESPONSE (cancelled) and returns the cancel text", async () => {
		bridgeState.active = true;
		bridgeState.ask.mockRejectedValue(new Error("bridge is not active"));

		const tool = captureTool();
		const result = await tool.execute("tool-1", makeParams(), undefined, undefined, { hasUI: true, ui: {} });

		expect(emitted(Events.ASK_REQUEST).length).toBe(1);
		expect(emitted(Events.ASK_RESPONSE).length).toBe(1);
		const resp = emitted(Events.ASK_RESPONSE)[0]!;
		expect(resp.requestId).toBe(emitted(Events.ASK_REQUEST)[0]!.requestId);
		expect(resp.cancelled).toBe(true);
		expect(resp.results).toEqual([{ id: "q1", selectedOptions: [] }]);
		expect(result.content[0]!.text).toBe("User cancelled the question.");
	});

	it("a pre-aborted signal → cancelled content + paired cancelled ASK_RESPONSE", async () => {
		bridgeState.active = true;
		// Simulate the cancel-rejection: when the turn's signal is already aborted,
		// bridge.ask() calls handle.cancel() directly (the abort event never fires),
		// which settles the promise via the socket-close handler → a rejection.
		bridgeState.ask.mockRejectedValue(new Error("bridge channel closed before response"));

		const controller = new AbortController();
		controller.abort(); // pre-aborted BEFORE execute() is invoked

		const tool = captureTool();
		const result = await tool.execute("tool-6", makeParams(), controller.signal, undefined, { hasUI: true, ui: {} });

		// bridge.ask was called with the pre-aborted signal (3rd arg)
		expect(bridgeState.ask).toHaveBeenCalledTimes(1);
		expect(bridgeState.ask).toHaveBeenCalledWith(makeParams(), "tool-6", controller.signal);

		// Paired cancelled ASK_RESPONSE (the tool's catch converts the
		// cancel-rejection into a cancelled response so the refcount stays balanced)
		expect(emitted(Events.ASK_REQUEST).length).toBe(1);
		expect(emitted(Events.ASK_RESPONSE).length).toBe(1);
		const resp = emitted(Events.ASK_RESPONSE)[0]!;
		expect(resp.requestId).toBe(emitted(Events.ASK_REQUEST)[0]!.requestId);
		expect(resp.cancelled).toBe(true);
		expect(resp.results).toEqual([{ id: "q1", selectedOptions: [] }]);

		// Cancelled content
		expect(result.content[0]!.text).toBe("User cancelled the question.");
	});
});

// ── Child (headless) branch — unchanged except toolCallId on the socket payload ──

describe("child branch (bridge inactive, no UI)", () => {
	it("writes ask_request with toolCallId to PI_SUBAGENT_SOCKET and returns the response results", async () => {
		bridgeState.active = false;
		const socketPath = path.join(os.tmpdir(), `ask-tool-test-${randomUUID()}.sock`);
		const received: Array<Record<string, unknown>> = [];
		const server = net.createServer((socket) => {
			let buffer = "";
			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf-8");
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					try {
						const msg = JSON.parse(trimmed) as Record<string, unknown>;
						if (msg.type === "ask_request") {
							received.push(msg);
							socket.write(
								JSON.stringify({
									type: "ask_response",
									requestId: msg.requestId,
									cancelled: false,
									results: [{ id: "q1", selectedOptions: ["A"], customInput: "from-parent" }],
								}) + "\n",
							);
						}
					} catch {
						/* malformed — ignore */
					}
				}
			});
			socket.on("error", () => {
				/* connection dropped */
			});
		});
		await new Promise<void>((resolve) => server.listen(socketPath, resolve));
		process.env.PI_SUBAGENT_SOCKET = socketPath;

		try {
			const tool = captureTool();
			const result = await tool.execute("tool-2", makeParams(), undefined, undefined, { hasUI: false });

			expect(received.length).toBe(1);
			expect(received[0]!.type).toBe("ask_request");
			expect(received[0]!.toolCallId).toBe("tool-2");
			expect(received[0]!.questions).toEqual(makeParams().questions);
			expect(typeof received[0]!.requestId).toBe("string");

			// The response results are built into the returned content
			expect(result.content[0]!.text).toContain("q1: A + Other: \"from-parent\"");
		} finally {
			delete process.env.PI_SUBAGENT_SOCKET;
			server.close();
			try {
				fs.unlinkSync(socketPath);
			} catch {
				/* already gone */
			}
		}
	});

	it("no PI_SUBAGENT_SOCKET → immediate cancelled response (unchanged behavior)", async () => {
		bridgeState.active = false;
		delete process.env.PI_SUBAGENT_SOCKET;

		const tool = captureTool();
		const result = await tool.execute("tool-2", makeParams(), undefined, undefined, { hasUI: false });

		expect(result.content[0]!.text).toBe("User cancelled the question.");
		// The child branch does not emit on the bus
		expect(busState.emit).not.toHaveBeenCalled();
	});
});

// ── TUI branch — unchanged except toolCallId on the ASK_REQUEST emit ────────

describe("TUI branch (bridge inactive, has UI)", () => {
	it("emits ASK_REQUEST (main) with toolCallId and does NOT emit ASK_RESPONSE", async () => {
		bridgeState.active = false;
		vi.mocked(askSingleQuestionWithInlineNote).mockResolvedValue({ selectedOptions: ["A"] });

		const tool = captureTool();
		const result = await tool.execute("tool-3", makeParams(), undefined, undefined, { hasUI: true, ui: {} });

		expect(emitted(Events.ASK_REQUEST).length).toBe(1);
		const req = emitted(Events.ASK_REQUEST)[0]!;
		expect(req.source).toBe("main");
		expect(req.toolCallId).toBe("tool-3");
		expect(typeof req.requestId).toBe("string");

		// The TUI path settles the picker inline — no ASK_RESPONSE on the bus
		expect(emitted(Events.ASK_RESPONSE).length).toBe(0);

		expect(vi.mocked(askSingleQuestionWithInlineNote)).toHaveBeenCalledTimes(1);
		expect(result.content[0]!.text).toContain("q1: A");
	});

	it("multi-question TUI path routes through the tabs dialog (unchanged)", async () => {
		bridgeState.active = false;
		vi.mocked(askQuestionsWithTabs).mockResolvedValue({
			cancelled: false,
			selections: [
				{ selectedOptions: ["A"] },
				{ selectedOptions: ["B"], customInput: "note" },
			],
		});

		const tool = captureTool();
		const result = await tool.execute(
			"tool-4",
			{
				questions: [
					{ id: "q1", question: "First?", options: [{ label: "A" }, { label: "B" }] },
					{ id: "q2", question: "Second?", multi: true, options: [{ label: "A" }, { label: "B" }] },
				],
			},
			undefined,
			undefined,
			{ hasUI: true, ui: {} },
		);

		expect(vi.mocked(askQuestionsWithTabs)).toHaveBeenCalledTimes(1);
		expect(emitted(Events.ASK_REQUEST).length).toBe(1);
		expect(emitted(Events.ASK_RESPONSE).length).toBe(0);
		expect(result.content[0]!.text).toContain("q1: A");
		expect(result.content[0]!.text).toContain("q2: [B] + Other: \"note\"");
	});

	it("the empty-questions guard still returns the error text (before any bus emit)", async () => {
		bridgeState.active = false;

		const tool = captureTool();
		const result = await tool.execute("tool-5", { questions: [] }, undefined, undefined, { hasUI: true, ui: {} });

		expect(result.content[0]!.text).toBe("Error: questions must not be empty");
		expect(busState.emit).not.toHaveBeenCalled();
	});
});

// ── ipc-relay: per-message bridge gate ───────────────────────────────────────

describe("ipc-relay", () => {
	it("bridge active: a subagent ASK_REQUEST is NOT consumed (no picker, no ASK_RESPONSE)", async () => {
		bridgeState.active = true;
		const unsubscribes: Array<() => void> = [];
		registerIpcRelay({} as unknown as ExtensionAPI, () => ({ ui: {} } as unknown as ExtensionContext), unsubscribes);
		relayUnsubs.push(...unsubscribes);

		busState.emit(Events.ASK_REQUEST, {
			source: "subagent:x",
			requestId: "relay-1",
			questions: [{ id: "q1", question: "Which?", options: [{ label: "A" }] }],
		});
		// The relay defers via setImmediate before handling — give it a moment
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(vi.mocked(askSingleQuestionWithInlineNote)).not.toHaveBeenCalled();
		expect(vi.mocked(askQuestionsWithTabs)).not.toHaveBeenCalled();
		expect(emitted(Events.ASK_RESPONSE).length).toBe(0);
	});

	it("bridge inactive: a subagent ASK_REQUEST is consumed and answered via ASK_RESPONSE (existing behavior)", async () => {
		bridgeState.active = false;
		vi.mocked(askSingleQuestionWithInlineNote).mockResolvedValue({ selectedOptions: ["A"] });
		const unsubscribes: Array<() => void> = [];
		registerIpcRelay({} as unknown as ExtensionAPI, () => ({ ui: {} } as unknown as ExtensionContext), unsubscribes);
		relayUnsubs.push(...unsubscribes);

		busState.emit(Events.ASK_REQUEST, {
			source: "subagent:x",
			requestId: "relay-2",
			questions: [{ id: "q1", question: "Which?", options: [{ label: "A" }] }],
		});
		await vi.waitFor(() => {
			expect(emitted(Events.ASK_RESPONSE).length).toBe(1);
		});

		const resp = emitted(Events.ASK_RESPONSE)[0]!;
		expect(resp.requestId).toBe("relay-2");
		expect(resp.cancelled).toBe(false);
		expect(resp.results).toEqual([{ id: "q1", selectedOptions: ["A"], customInput: undefined }]);
	});
});
