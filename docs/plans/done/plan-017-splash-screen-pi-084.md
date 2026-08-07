# Splash Screen Pi 0.84.0 Compatibility Plan

**Goal:** Restore the centered splash screen (logo + resource sections) after Pi 0.84.0 moved resource sections from `chatContainer` to `loadedResourcesContainer`.

**Architecture:** Navigate the new TUI hierarchy (`documentContainer` → `loadedResourcesContainer`) to find and patch the correct container. Capture the TUI reference during `session_start` (via header factory) for shutdown cleanup. Patch `loadedResourcesContainer.addChild` to intercept `ExpandableText` section components and render them in archimedes' custom centered header.

**Tech Stack:** TypeScript, Pi Extension API (`ctx.ui.setHeader`), pi-tui Component types

---

### Task 1: Add `findLoadedResourcesContainer` and update `patchStartupListing`

**Why:** Pi 0.84.0 moved resource sections (`[Context]`, `[Skills]`, `[Extensions]`, `[Themes]`) from `chatContainer` to a new `loadedResourcesContainer` (child of `documentContainer`). The existing `findChatContainer()` searches `tui.children` using heuristics (Scrollable name, middle child, most children) that break with the new 7-child TUI layout. Resource sections are now `ExpandableText` components (extends `Text`) added via `loadedResourcesContainer.addChild()`.

**Files:**
- Modify: `packages/core/src/startup/index.ts`

**What to implement:**

1. **New `findLoadedResourcesContainer(tui: TUI): Container | undefined` function** (place after `findChatContainer`):

   Strategy (Pi 0.84.0+ has 7 top-level TUI children in regular mode):
   - Find `documentContainer`: iterate `tui.children`, find the first `Container` that has sub-children of type `Container` (this is `documentContainer` which contains `headerContainer`, `loadedResourcesContainer`, `chatContainer`)
   - If `documentContainer` found, filter its children for `Container` instances
   - Return `containerChildren[1]` (second Container child = `loadedResourcesContainer` by convention: header=0, resources=1, chat=2)
   - If fewer than 2 Container children, return `undefined`
   - If `documentContainer` not found, return `undefined` (fallback to old behavior)

   Note: the scrollable-heuristic from `findChatContainer` does NOT apply here — on Pi 0.84+, `ScrollView` wraps `documentContainer` as a fullscreen layout root and is never inside `documentContainer`'s subtree. The simple index-based approach (second Container child) is sufficient and matches Pi's initialization order (`interactive-mode.js:347-352`).

   ```typescript
   function findLoadedResourcesContainer(tui: TUI): Container | undefined {
     // Find documentContainer: first tui child that has Container sub-children
     const docContainer = tui.children.find(
       (c) => c instanceof Container && c.children.some((child) => child instanceof Container)
     ) as Container | undefined;
     if (!docContainer) return undefined;

     const containerChildren = docContainer.children.filter(
       (c): c is Container => c instanceof Container
     );
     // Pi 0.84+: [headerContainer(0), loadedResourcesContainer(1), chatContainer(2)]
     if (containerChildren.length < 2) return undefined;
     return containerChildren[1]; // loadedResourcesContainer
   }
   ```

2. **Update `patchStartupListing`** to use the new container discovery:

   - Replace `const chat = findChatContainer(tui)` with:
     ```typescript
     const resourcesContainer = findLoadedResourcesContainer(tui) ?? findChatContainer(tui);
     if (!resourcesContainer) {
       console.warn("[archimedes] Could not find resources container...");
       return;
     }
     const rc = resourcesContainer as any;
     ```
   - Replace all references to `chat` with `resourcesContainer` and `cc` with `rc` in the rest of the function
   - The Symbol keys (`LISTING_REF`, `ANIM_INTERVAL`, `DEBOUNCE_TIMER`, `PATCHED_CLEAR`, `PATCHED_LISTING`, `ORIG_ADD_CHILD`) stay the same — they are stored on whichever container is patched
   - The `ExpandableText` component handling is already correct: `ExpandableText` extends `Text`, and the existing code checks `(component as any).getExpandedText` which exists on `ExpandableText`

3. **Do NOT change:**
   - `findChatContainer()` — keep it for backward compat fallback
   - `renderHeader()` — no changes needed
   - Section parsing (`parseSectionText`, `detectSection`, etc.) — `ExpandableText` collapsed format (`[SectionName]\n  item1, item2, item3`) is already handled by existing parser
   - Animation logic, debounce, reveal timing

**Steps:**
- [ ] Add `findLoadedResourcesContainer()` function after `findChatContainer()` in `packages/core/src/startup/index.ts`
- [ ] Update `patchStartupListing()` to use `findLoadedResourcesContainer()` with fallback to `findChatContainer()`
- [ ] Replace all `chat` variable references with `resourcesContainer` and `cc` with `rc`
- [ ] Run `npx tsc --noEmit` in `packages/core/`
  - Did it succeed? If not, fix type errors and re-run
- [ ] Commit with message: "fix(core): navigate new TUI hierarchy for Pi 0.84.0 splash screen"

**Acceptance criteria:**
- [ ] `findLoadedResourcesContainer()` returns the correct container on Pi 0.84.0+ (the one receiving ExpandableText sections)
- [ ] `findLoadedResourcesContainer()` returns `undefined` on unrecognized structures (triggers fallback)
- [ ] `patchStartupListing()` patches `loadedResourcesContainer.addChild()` on Pi 0.84.0+
- [ ] `patchStartupListing()` falls back to `findChatContainer()` on older Pi versions
- [ ] Type-check passes with `npx tsc --noEmit`

---

### Task 2: Capture TUI reference and fix shutdown cleanup

**Why:** The `session_shutdown` handler in `packages/core/src/index.ts` needs the TUI reference to find and restore patched containers. Two problems: (1) `(coreCtx.ui as any).tui` is `undefined` on Pi 0.84+ — `createExtensionUIContext()` does NOT expose `tui` on the extension UI context (the existing shutdown loop is already a silent no-op for this reason). (2) `TUI` is a type-only interface in pi-tui 0.84 (no runtime value), so `instanceof TUI` would throw `TypeError`. Fix: capture the real TUI reference during `session_start` (the header factory receives it as a parameter) and store it in module scope for shutdown use.

**Files:**
- Modify: `packages/core/src/index.ts`

**What to implement:**

1. **Add module-level `coreTui` variable** (next to existing `coreRef` and `coreCtx`):
   ```typescript
   let coreRef: ListingRef | undefined;
   let coreCtx: ExtensionContext | undefined;
   let coreTui: TUI | undefined;
   ```

2. **Capture TUI in header factory** — the header factory receives `tui` as its first parameter. Store it:
   ```typescript
   const headerFactory = (tui: TUI, theme: Theme): Component & { dispose?(): void } => {
     coreTui = tui; // Capture for shutdown cleanup
     const comp: Component & { dispose?(): void } = {
       // ... existing render logic
     };
     patchStartupListing(tui, theme, ref);
     return comp;
   };
   ```

3. **Rewrite `session_shutdown` handler** — replace the entire handler body. Use `coreTui` instead of `(coreCtx.ui as any).tui`. Scan both direct TUI children (old Pi) AND nested children (Pi 0.84+):
   ```typescript
   pi.on("session_shutdown", (_event, _ctx) => {
     if (coreRef) { coreRef.settled = true; }
     const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;
     const listingRef = g["listingRef"] as ListingRef | undefined;
     if (listingRef) { listingRef.settled = true; }

     // Restore patched addChild
     const PATCHED_LISTING = Symbol.for("splashscreen:listingPatched");
     const ORIG_ADD_CHILD = Symbol.for("splashscreen:origAddChild");
     if (coreTui) {
       try {
         // Direct TUI children (old Pi: chatContainer was a direct child)
         for (const child of coreTui.children) {
           const cc = child as any;
           if (cc[PATCHED_LISTING] && cc[ORIG_ADD_CHILD]) {
             child.addChild = cc[ORIG_ADD_CHILD];
             cc[PATCHED_LISTING] = false;
             cc[ORIG_ADD_CHILD] = undefined;
           }
         }
         // Nested children (Pi 0.84+: loadedResourcesContainer is inside documentContainer)
         for (const topChild of coreTui.children) {
           const tc = topChild as any;
           if (!tc.children) continue;
           for (const child of tc.children) {
             const cc = child as any;
             if (cc[PATCHED_LISTING] && cc[ORIG_ADD_CHILD]) {
               child.addChild = cc[ORIG_ADD_CHILD];
               cc[PATCHED_LISTING] = false;
               cc[ORIG_ADD_CHILD] = undefined;
             }
           }
         }
       } catch {
         /* TUI structure may have changed — ignore */
       }
     }

     // Clear editor component override
     if (coreCtx) { coreCtx.ui.setEditorComponent(undefined); }
   });
   ```

   Key changes from existing code:
   - Use `coreTui` (captured at session_start) instead of `(coreCtx.ui as any).tui` (which is undefined)
   - Added nested scan: iterate `topChild.children` for each direct TUI child
   - NO `instanceof TUI` check (TUI is type-only in pi-tui 0.84, would throw TypeError)
   - Keep `coreRef.settled`, global listingRef settle, and `setEditorComponent(undefined)` unchanged

**Do NOT change:**
- `coreRef.settled = true` marking
- Global `listingRef` settling
- Editor component clearing (`coreCtx.ui.setEditorComponent(undefined)`)
- Do NOT use `instanceof TUI` — TUI is a type-only interface in pi-tui 0.84+ (no runtime constructor)

**Steps:**
- [ ] Add `let coreTui: TUI | undefined` module-level variable (next to `coreRef` and `coreCtx`)
- [ ] Capture TUI in header factory: add `coreTui = tui` as first line
- [ ] Rewrite `session_shutdown` handler: use `coreTui` instead of `(coreCtx.ui as any).tui`, add nested container scan, remove `instanceof TUI` check
- [ ] Run `npx tsc --noEmit` in `packages/core/`
  - Did it succeed? If not, fix type errors and re-run
- [ ] Update `docs/plans/README.md`: add plan-017 row to Done table with status "🔄 IN PROGRESS", increment Total Plans to 17
- [ ] Commit with message: "fix(core): capture TUI reference and fix shutdown cleanup for Pi 0.84.0+"

**Acceptance criteria:**
- [ ] `coreTui` is captured during `session_start` via header factory
- [ ] Shutdown cleanup uses `coreTui` (not `(coreCtx.ui as any).tui`) and finds nested containers
- [ ] No `instanceof TUI` checks that would throw TypeError
- [ ] Shutdown cleanup still works for older Pi versions (direct tui.children scan unchanged)
- [ ] No errors thrown if TUI structure is unrecognized
- [ ] Type-check passes with `npx tsc --noEmit`

---

## Verification

After both tasks:
1. Start Pi with archimedes symlinked: `pi` in the project directory
2. Observe the splash screen: logo centered, resource sections ([Context], [Skills], [Extensions], [Themes]) rendered below the logo in the center
3. Use `/reload` and verify the splash screen re-renders correctly
4. Verify no console warnings about "Could not find resources container"
