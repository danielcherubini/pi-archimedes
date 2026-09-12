/** The spinner quip pool — short (≤ 20 visible chars, printable-ASCII-only) status labels shown instead of the default "Working" per busy episode (see plan-037). Mixed nerdy: compute/OS, CS/programmer folklore, math/physics. Invariants (40–60 entries, 1–20 chars, printable ASCII, no edge/double spaces, unique, exactly one "Working", frozen) are enforced by `spin-quips.test.ts`. */
export const SPIN_QUIPS: readonly string[] = Object.freeze([
  "Working",
  "Compiling...",
  "Linking...",
  "Process spawning...",
  "It works on mine...",
  "Stack Overflow...",
  "Rubber ducking...",
  "Thread spinning...",
  "Garbage sweep...",
  "Defragmenting...",
  "Scheduling ticks...",
  "Compiling excuses...",
  "Kernel panic...",
  "Segfaulting...",
  "Desugaring...",
  "Unstaging changes...",
  "Squashing commits...",
  "Rebasing reality...",
  "Merging branches...",
  "Committing WIP...",
  "404 brain found...",
  "Cache warming...",
  "Diffing reality...",
  "Wrangling regex...",
  "Forking away...",
  "Deadlock dodge...",
  "Lock waiters...",
  "Semaphore shuffle...",
  "Starvation check...",
  "Stack smashing...",
  "Hex dancing...",
  "Leapfrogging bits...",
  "Floating point...",
  "Sum indeterminate...",
  "NaN-adjacent...",
  "Bayes is settling...",
  "Gradient ascent...",
  "Pruning branches...",
  "Branch prediction...",
  "Paging memory...",
  "Collapsing wave...",
  "Wavefunction...",
  "Entropy rising...",
  "Interference...",
  "Eigenstates...",
  "Compressing time...",
  "Tensor exploding...",
  "Graviton hunting...",
  "Phase transitions...",
  "Quanta humming...",
  "Quantizing...",
  "Singularities...",
]);

/** Uniformly pick a quip; `exclude` (the previous episode's quip) is never returned — if the first draw lands on it, exactly one re-roll restricted to entries ≠ `exclude` (no loops). `rand` is injectable for deterministic tests. */
export function pickQuip(exclude?: string, rand: () => number = Math.random): string {
  const pick = (customPool: readonly string[]): string =>
    customPool[Math.floor(rand() * customPool.length)]!;
  const first = pick(SPIN_QUIPS);
  if (exclude === undefined || first !== exclude) return first;
  return pick(SPIN_QUIPS.filter((q) => q !== exclude));
}
