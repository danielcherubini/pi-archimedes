import { describe, it, expect, vi, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// pi-tui — Text/Spacer/Container must be real classes for the instanceof checks
vi.mock("@earendil-works/pi-tui", () => ({
	Text: class Text {
		render(): string[] {
			return ["rendered"];
		}
	},
	Spacer: class Spacer {},
	Container: class Container {
		children: unknown[] = [];
		addChild(c: unknown) {
			this.children.push(c);
			return this;
		}
		clear() {
			this.children = [];
			return this;
		}
	},
	truncateToWidth: (s: string, w: number) => s.slice(0, w),
	visibleWidth: (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length,
}));

// version — no network in tests
vi.mock("./version.js", () => ({
	fetchLatestVersion: vi.fn().mockResolvedValue(undefined),
	compareVersions: () => 0,
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { Text, Container } from "@earendil-works/pi-tui";
import { patchStartupListing, renderHeader, type ListingRef } from "./index.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeTui(): { tui: any; resources: any; header: any } {
	// pi ≥0.84 layout: documentContainer → [headerContainer, loadedResourcesContainer, chatContainer]
	const header = new Container();
	const resources = new Container();
	const chat = new Container();
	const doc = new Container();
	doc.children.push(header, resources, chat);
	const tui = {
		terminal: { rows: 24 },
		children: [doc],
		requestRender: vi.fn(),
	};
	return { tui, resources, header };
}

function makeRef(): ListingRef {
	return {
		sections: [],
		frame: 0,
		revealed: true, // skip the debounce timer path
		revealedAt: 0,
		scaffoldAt: 0,
		settled: false,
	};
}

/** Fake ExpandableText: render() returns whatever the current state yields. */
function makeSectionComponent(renderLines: string[], opts: { setExpanded?: ReturnType<typeof vi.fn>; getExpandedText?: () => string } = {}): any {
	const comp: any = new (Text as any)();
	comp.render = () => renderLines;
	if (opts.setExpanded) comp.setExpanded = opts.setExpanded;
	if (opts.getExpandedText) comp.getExpandedText = opts.getExpandedText;
	return comp;
}

const THEME = {
	fg: (_token: string, t: string) => t,
	getFgAnsi: (_token: string) => "",
} as any;

let lastResources: any;
const after = () => {
	// Stop the animation interval + any pending debounce timer
	const ANIM_INTERVAL = Symbol.for("splashscreen:animInterval");
	const DEBOUNCE_TIMER = Symbol.for("splashscreen:debounceTimer");
	if (lastResources?.[ANIM_INTERVAL]) clearInterval(lastResources[ANIM_INTERVAL]);
	if (lastResources?.[DEBOUNCE_TIMER]) clearTimeout(lastResources[DEBOUNCE_TIMER]);
	lastResources = undefined;
};
afterEach(after);

// ── patchStartupListing: section text extraction ─────────────────────────────

describe("patchStartupListing section parsing", () => {
	it("forces expansion via setExpanded when the getExpandedText method is absent (pi ≥0.99)", () => {
		const { tui, resources } = makeTui();
		lastResources = resources;
		const ref = makeRef();
		patchStartupListing(tui, THEME, ref);

		// pi ≥0.99 ExpandableText: text builders live in the constructor,
		// the component starts collapsed. render() after setExpanded(true)
		// returns the full per-item body.
		const setExpanded = vi.fn();
		const comp = makeSectionComponent(
			["[Skills]", "  /home/u/skills/alpha/SKILL.md", "  /home/u/skills/beta/SKILL.md"],
			{ setExpanded },
		);
		resources.addChild(comp);

		expect(setExpanded).toHaveBeenCalledWith(true);
		expect(ref.sections).toEqual([{ name: "Skills", items: ["alpha", "beta"] }]);
		// Section consumed by the splash — original component not added
		expect((resources as any).children.length).toBe(0);
	});

	it("prefers the getExpandedText method when present (older pi)", () => {
		const { tui, resources } = makeTui();
		lastResources = resources;
		const ref = makeRef();
		patchStartupListing(tui, THEME, ref);

		const setExpanded = vi.fn();
		const comp = makeSectionComponent(
			["[Skills]", "  collapsed-should-not-be-read"],
			{
				setExpanded,
				getExpandedText: () => "[Skills]\n  /home/u/skills/alpha/SKILL.md",
			},
		);
		resources.addChild(comp);

		expect(setExpanded).not.toHaveBeenCalled();
		expect(ref.sections).toEqual([{ name: "Skills", items: ["alpha"] }]);
	});

	it("splits a collapsed comma-joined body when no expansion API exists (safety net)", () => {
		const { tui, resources } = makeTui();
		lastResources = resources;
		const ref = makeRef();
		patchStartupListing(tui, THEME, ref);

		// No setExpanded, no getExpandedText — render() yields the collapsed body
		const comp = makeSectionComponent(["[Skills]", "  alpha, beta, gamma"]);
		resources.addChild(comp);

		expect(ref.sections).toEqual([{ name: "Skills", items: ["alpha", "beta", "gamma"] }]);
		expect((resources as any).children.length).toBe(0);
	});

	it("passes non-section text through to the original addChild", () => {
		const { tui, resources } = makeTui();
		lastResources = resources;
		const ref = makeRef();
		patchStartupListing(tui, THEME, ref);

		const comp = makeSectionComponent(["some random text"]);
		resources.addChild(comp);

		expect((resources as any).children).toContain(comp);
		expect(ref.sections).toEqual([]);
	});

	it("merges items from repeated section components", () => {
		const { tui, resources } = makeTui();
		lastResources = resources;
		const ref = makeRef();
		patchStartupListing(tui, THEME, ref);

		resources.addChild(makeSectionComponent(["[Skills]", "  alpha, beta"]));
		resources.addChild(makeSectionComponent(["[Skills]", "  beta, gamma"]));

		expect(ref.sections).toEqual([{ name: "Skills", items: ["alpha", "beta", "gamma"] }]);
	});
});

describe("patchStartupListing animation timer", () => {
	afterEach(() => vi.useRealTimers());

	it("stops redrawing once the logo settles when no sections arrive (quietStartup)", () => {
		vi.useFakeTimers();
		const { tui, resources } = makeTui();
		lastResources = resources;
		patchStartupListing(tui, THEME, { ...makeRef(), revealed: false });

		vi.advanceTimersByTime(3_000);
		const renderCountAfterSettle = tui.requestRender.mock.calls.length;
		vi.advanceTimersByTime(3_000);
		expect(tui.requestRender.mock.calls.length).toBe(renderCountAfterSettle);
	});

	it("restarts the timer when sections are revealed after the logo settled", () => {
		vi.useFakeTimers();
		const { tui, resources } = makeTui();
		lastResources = resources;
		const ref: ListingRef = { ...makeRef(), revealed: false };
		// Real renders settle the listing, which is what stops the restarted timer
		tui.requestRender.mockImplementation(() => renderHeader(THEME, ref, 200, 60));
		patchStartupListing(tui, THEME, ref);
		vi.advanceTimersByTime(3_000);

		resources.addChild(makeSectionComponent(["[Skills]", "  tdd"]));
		vi.advanceTimersByTime(500);
		expect(ref.revealed).toBe(true);
		const renderCountAfterReveal = tui.requestRender.mock.calls.length;
		vi.advanceTimersByTime(200);
		expect(tui.requestRender.mock.calls.length).toBeGreaterThan(renderCountAfterReveal);

		vi.advanceTimersByTime(2_000); // past the text fade-in
		const renderCountAfterFade = tui.requestRender.mock.calls.length;
		vi.advanceTimersByTime(2_000);
		expect(tui.requestRender.mock.calls.length).toBe(renderCountAfterFade);
	});
});
