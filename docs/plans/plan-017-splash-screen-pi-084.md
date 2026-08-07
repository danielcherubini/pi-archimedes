# Splash Screen Pi 0.84.0 Compatibility Plan

**Goal:** Restore the centered splash screen (logo + resource sections) after Pi 0.84.0 moved resource sections from `chatContainer` to `loadedResourcesContainer`.

**Architecture:** Navigate the new TUI hierarchy (`documentContainer` → `loadedResourcesContainer`) to find and patch the correct container. Patch its `addChild` to intercept `ExpandableText` section components and render them in archimedes' custom centered header.

**Tech Stack:** TypeScript, Pi Extension API (`ctx.ui.setHeader`), pi-tui Component types

---

### Task 1: Add `findLoadedResourcesContainer` and update `patchStartupListing`

**Why:** Pi 0.84.0 moved resource sections (`[Context]`, `[Skills]`, `[Extensions]`, `[Themes]`) from `chatContainer` to a new `loadedResourcesContainer` (child of `documentContainer`). The existing `findChatContainer()` searches `tui.children` using heuristics (Scrollable name, middle child, most children) that break with the new 8-child TUI layout. Resource sections are now `ExpandableText` components (extends `Text`) added via `loadedResourcesContainer.addChild()`.

**Files:**
- Modify: `packages/core/src/startup/index.ts`

**What to implement:**

1. **New `findLoadedResourcesContainer(tui: TUI): Container | undefined` function** (place after `findChatContainer`):

   Strategy:
   - Find `documentContainer`: iterate `tui.children`, find the first `Container` that has sub-children of type `Container` (this is `documentContainer` which contains `headerContainer`, `loadedResourcesContainer`, `chatContainer`)
   - If `documentContainer` found, iterate its children:
     - Skip the first child (header container — contains the built-in header ExpandableText)
     - Search remaining children recursively (depth-first) for a Container whose constructor name includes `"Scrollable"` — this is the chat/transcript container
     - Return the first Container child that is neither the header (index 0) nor the scrollable/chat container
     - If no scrollable found, return the second Container child (index 1 = `loadedResourcesContainer` by convention)
   - If `documentContainer` not found, return `undefined` (fallback to old behavior)

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
     if (containerChildren.length < 2) return undefined;

     // Find scrollable/chat container (recursive search)
     let scrollable: Container | undefined;
     function findScrollable(container: Container): void {
       for (const child of container.children) {
         const cc = child as any;
         if (cc.constructor?.name?.includes("Scrollable")) {
           scrollable = container;
           return;
         }
         if (child instanceof Container) findScrollable(child);
       }
     }
     findScrollable(docContainer);

     // First non-header, non-chat Container = loadedResourcesContainer
     const headerContainer = containerChildren[0];
     for (const child of containerChildren) {
       if (child !== headerContainer && child !== scrollable) {
         return child;
       }
     }
     // Fallback: second Container child
     return containerChildren[1];
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

### Task 2: Update shutdown cleanup to scan nested containers

**Why:** The `session_shutdown` handler in `packages/core/src/index.ts` iterates `tui.children` to find patched containers and restore their `addChild`. With Pi 0.84.0, `loadedResourcesContainer` is a child of `documentContainer` (a child of `tui`), not a direct `tui.child`. The cleanup scan must also check nested containers.

**Files:**
- Modify: `packages/core/src/index.ts`

**What to implement:**

In the `session_shutdown` handler, after the existing `tui.children` loop, add a second loop that scans `documentContainer.children`:

```typescript
// After the existing tui.children loop:
// Also scan documentContainer.children (Pi 0.84.0+ nested structure)
try {
  const tui = (coreCtx.ui as any).tui;
  if (tui?.children) {
    for (const topChild of tui.children) {
      const tc = topChild as any;
      if (tc instanceof (TUI as any) || !tc.children) continue;
      // This is documentContainer or similar nested Container
      for (const child of tc.children) {
        const cc = child as any;
        if (cc[PATCHED_LISTING] && cc[ORIG_ADD_CHILD]) {
          child.addChild = cc[ORIG_ADD_CHILD];
          cc[PATCHED_LISTING] = false;
          cc[ORIG_ADD_CHILD] = undefined;
        }
      }
    }
  }
} catch {
  /* TUI structure may have changed — ignore */
}
```

The existing `tui.children` loop stays unchanged (backward compat for older Pi).

**Do NOT change:**
- `coreRef.settled = true` marking
- Global `listingRef` settling
- Editor component clearing (`coreCtx.ui.setEditorComponent(undefined)`)

**Steps:**
- [ ] Add nested container scan to `session_shutdown` handler in `packages/core/src/index.ts`
- [ ] Run `npx tsc --noEmit` in `packages/core/`
  - Did it succeed? If not, fix type errors and re-run
- [ ] Commit with message: "fix(core): scan nested containers in shutdown cleanup for Pi 0.84.0+"

**Acceptance criteria:**
- [ ] Shutdown cleanup finds and restores `loadedResourcesContainer.addChild` on Pi 0.84.0+
- [ ] Shutdown cleanup still works for older Pi versions (tui.children scan unchanged)
- [ ] No errors thrown if TUI structure is unrecognized
- [ ] Type-check passes with `npx tsc --noEmit`

---

## Verification

After both tasks:
1. Start Pi with archimedes symlinked: `pi` in the project directory
2. Observe the splash screen: logo centered, resource sections ([Context], [Skills], [Extensions], [Themes]) rendered below the logo in the center
3. Use `/reload` and verify the splash screen re-renders correctly
4. Verify no console warnings about "Could not find resources container"
