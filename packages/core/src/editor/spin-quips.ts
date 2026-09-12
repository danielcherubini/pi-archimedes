/** The spinner quip pool — fun (≤ 64 visible chars, printable-ASCII-only) status labels shown instead of the default "Working" per busy episode (see plan-037). Mixed nerdy: compute/OS, CS/programmer folklore, math/physics. Invariants (20–60 entries, 1–64 chars, printable ASCII, no edge/double spaces, unique, frozen) are enforced by `spin-quips.test.ts`. */
export const SPIN_QUIPS: readonly string[] = Object.freeze([
  "Working...",
  "Compiling a list of excuses for the next stand-up...",
  "Containerizing the 'it works on my machine' anomaly...",
  "Consulting a 10-year-old Stack Overflow thread...",
  "Explaining the entire architecture to a rubber duck...",
  "Force-pushing a rebase onto objective reality...",
  "Pretending the linter warnings are just polite suggestions...",
  "Wrangling a regex that no mortal can actually comprehend...",
  "Slipping a $20 bill to the CPU's branch predictor...",
  "Waiting for a cosmic ray to flip exactly the right bit...",
  "Convincing floating-point math that 0.1 + 0.2 equals 0.3...",
  "Quantizing the vibes from FP32 all the way down to INT4...",
  "Performing evasive maneuvers to dodge a thread deadlock...",
  "Politely asking the borrow checker for permission to live...",
  "Deep-sea mining in the codebase for a missing semicolon...",
  "Blaming a mysterious DNS issue like we always do...",
  "Downloading more RAM from a highly suspicious website...",
  "Collapsing quantum wavefunctions just by looking at them...",
  "Hunting for rogue gravitons inside the server rack...",
  "Paging memory to disk because we refused to optimize...",
  "Optimizing the optimizer so it can optimize faster...",
  "Searching the entire keyboard for the legendary 'Any' key...",
  "Reticulating multi-dimensional splines...",
  "Running gradient ascent until we reach enlightenment...",
  "Pruning decision trees before autumn sets in...",
  "Desugaring the syntax until it's completely flavorless...",
  "Checking for starvation in the dining philosophers...",
  "Negotiating a peace treaty between competing threads..."
]);

/** Uniformly pick a quip; `exclude` (the previous episode's quip) is never returned — if the first draw lands on it, exactly one re-roll restricted to entries ≠ `exclude` (no loops). `rand` is injectable for deterministic tests. */
export function pickQuip(exclude?: string, rand: () => number = Math.random): string {
  const pick = (customPool: readonly string[]): string =>
    customPool[Math.floor(rand() * customPool.length)]!;
  const first = pick(SPIN_QUIPS);
  if (exclude === undefined || first !== exclude) return first;
  return pick(SPIN_QUIPS.filter((q) => q !== exclude));
}
