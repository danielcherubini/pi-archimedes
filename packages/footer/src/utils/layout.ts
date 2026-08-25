import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * Footer line-packing.
 *
 * Chunks are the individual footer pieces (dir, branch, worktree, model,
 * thinking, stats, context bar). Packing decides how many lines the footer
 * needs so nothing gets silently truncated:
 *
 * - one line, if everything fits
 * - two lines, if the tail (e.g. stats) no longer fits
 * - three or more, if the left sections themselves overflow the terminal
 *
 * Every chunk is atomic — it is never cut in half. A single chunk wider
 * than the terminal occupies a line of its own; the caller is responsible
 * for clamping it (last-resort truncation of one irreducibly long item).
 */

/** Visible width of the " · " footer separator. */
export const SEP_W = 3;
/** The footer section separator string (without ANSI colouring — colour it at the call site). */
export const SEPARATOR = " · ";

/**
 * Total visible columns of chunks joined by a separator of `sepWidth`
 * visible characters.
 */
function measureChunks(chunks: string[], sepWidth = 3): number {
  let w = 0;
  for (let i = 0; i < chunks.length; i++) {
    w += (i > 0 ? sepWidth : 0) + visibleWidth(chunks[i]!);
  }
  return w;
}

/**
 * Greedily pack chunks into groups of lines, each guaranteed to satisfy
 * `sum(chunkWidth) + sepWidth * (count - 1) <= width` when joined — with the
 * sole exception of a single chunk wider than `width` (own line).
 *
 * @param chunks atomic footer pieces, in desired display order
 * @param width  terminal width in visible columns
 * @param sepWidth visible width of the join separator (default 3, for " · ")
 */
export function packFooterLines(chunks: string[], width: number, sepWidth = 3): string[][] {
  if (chunks.length === 0) return [];
  if (width <= 0) return chunks.map((c) => [c]);

  const groups: string[][] = [];
  let group: string[] = [];
  let groupW = 0;

  for (const chunk of chunks) {
    const w = visibleWidth(chunk);
    if (group.length === 0) {
      group = [chunk];
      groupW = w;
    } else if (groupW + sepWidth + w <= width) {
      group.push(chunk);
      groupW += sepWidth + w;
    } else {
      groups.push(group);
      group = [chunk];
      groupW = w;
    }
  }
  if (group.length > 0) groups.push(group);

  return groups;
}
