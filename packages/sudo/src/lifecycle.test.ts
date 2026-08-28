/**
 * Session lifecycle + /sudo command tests.
 *
 * The credential cache is a module singleton that must NEVER outlive a
 * session: session_shutdown drops it from memory, session_start resets it
 * for a fresh session, and `/sudo forget` clears it explicitly (ADR 0010).
 * Handlers must be registered at the TOP level of registerSudo — these
 * fake-`pi` tests double-check that, because a wrapper-building handler
 * (nested registration) would not show up under the expected event key.
 *
 * I/O is mocked out: fake `pi` records `on()`/`registerCommand()` calls,
 * fake ctx carries a `ui.notify` spy.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { credentialCache } from "./cache.js";
import { registerSudo } from "./index.js";

interface FakePi {
	pi: ExtensionAPI;
	/** event name → handlers in registration order */
	handlers: Map<string, Function[]>;
	commands: Map<string, { description: string; handler: Function }>;
	tools: unknown[];
}

function fakePi(): FakePi {
	const handlers = new Map<string, Function[]>();
	const commands = new Map<string, { description: string; handler: Function }>();
	const tools: unknown[] = [];
	const pi = {
		on(event: string, fn: Function) {
			const list = handlers.get(event) ?? [];
			list.push(fn);
			handlers.set(event, list);
		},
		registerTool(tool: unknown) {
			tools.push(tool);
		},
		registerCommand(name: string, def: { description: string; handler: Function }) {
			commands.set(name, def);
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, commands, tools };
}

function fakeCtx() {
	const notified: string[] = [];
	const ctx = {
		ui: {
			notify(message: string, _kind?: string) {
				notified.push(message);
			},
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, notified };
}

function lastHandler(fake: FakePi, event: string): Function {
	const list = fake.handlers.get(event);
	expect(list, `no handler registered for "${event}"`).toBeDefined();
	const fn = list![list!.length - 1];
	expect(fn, `last handler for "${event}" must be a function`).toBeTypeOf("function");
	if (typeof fn !== "function") throw new Error(`missing handler for "${event}"`);
	return fn;
}

describe("registerSudo — session lifecycle + /sudo command", () => {
	afterEach(() => {
		credentialCache.clear();
	});

	it("registers session_shutdown and session_start at the top level, both clearing the credential cache", () => {
		const fake = fakePi();
		registerSudo(fake.pi);

		// Top-level registration (no accumulation on /reload).
		expect(lastHandler(fake, "session_shutdown")).toBeTypeOf("function");
		expect(lastHandler(fake, "session_start")).toBeTypeOf("function");

		// Sentinel entry survives until either handler runs.
		credentialCache.set("hunter2", 900_000);
		expect(credentialCache.get()).not.toBeNull();

		lastHandler(fake, "session_shutdown")(undefined, undefined);
		expect(credentialCache.get()).toBeNull();

		// A fresh session must not inherit a credential either.
		credentialCache.set("hunter2", 900_000);
		expect(credentialCache.get()).not.toBeNull();

		lastHandler(fake, "session_start")(undefined, undefined);
		expect(credentialCache.get()).toBeNull();
	});

	it("registers the sudo_exec tool whose parameters are exactly {command, reason, timeoutMs}", () => {
		const fake = fakePi();
		registerSudo(fake.pi);

		expect(fake.tools).toHaveLength(1);
		const tool = fake.tools[0] as {
			name: string;
			parameters: { properties: Record<string, unknown>; required?: string[] };
		};
		expect(tool.name).toBe("sudo_exec");
		expect(Object.keys(tool.parameters.properties).sort()).toEqual(["command", "reason", "timeoutMs"]);
		expect(tool.parameters.required?.sort()).toEqual(["command", "reason"]);
	});

	it("registers a /sudo command whose forget subcommand clears the credential cache", async () => {
		const fake = fakePi();
		registerSudo(fake.pi);

		const def = fake.commands.get("sudo");
		expect(def).toBeDefined();
		expect(def!.description).toBe("Manage the sudo credential cache");

		credentialCache.set("hunter2", 900_000);
		expect(credentialCache.get()).not.toBeNull();

		const { ctx, notified } = fakeCtx();
		await def!.handler("forget", ctx);

		expect(credentialCache.get()).toBeNull();
		expect(notified).toEqual(["Sudo credential cleared."]);
	});

	it("responds to an unknown /sudo subcommand with usage info — no exception, cache unchanged", async () => {
		const fake = fakePi();
		registerSudo(fake.pi);
		const def = fake.commands.get("sudo")!;

		credentialCache.set("hunter2", 900_000);
		const { ctx, notified } = fakeCtx();
		await expect(def.handler("noop", ctx)).resolves.toBeUndefined(); // must not throw

		expect(notified).toEqual(["Unknown /sudo subcommand. Usage: /sudo, /sudo forget"]);
		expect(credentialCache.get()).not.toBeNull(); // live credential untouched
	});

	it("bare /sudo reports the cache state (expiry-aware) and does not clear a live credential", async () => {
		const fake = fakePi();
		registerSudo(fake.pi);
		const def = fake.commands.get("sudo")!;

		// Not cached.
		const notCached = fakeCtx();
		await def.handler("", notCached.ctx);
		expect(notCached.notified).toEqual(["No sudo credential cached."]);

		// Cached (live entry).
		credentialCache.set("hunter2", 900_000);
		const cached = fakeCtx();
		await def.handler("", cached.ctx);
		expect(cached.notified).toEqual(["Sudo credential cached."]);
		expect(credentialCache.get()).not.toBeNull();

		// Expired entry reads as not-cached (get() is expiry-aware).
		credentialCache.set("hunter2", 1);
		await new Promise((r) => setTimeout(r, 5));
		const expired = fakeCtx();
		await def.handler("", expired.ctx);
		expect(expired.notified).toEqual(["No sudo credential cached."]);
	});
});
