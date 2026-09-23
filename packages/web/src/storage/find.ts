export interface PassageResult {
  passage: string;
  offset: number;
  match: string;
}

export function findPassages(
  text: string,
  queries: string[],
  options?: { mode?: "case-insensitive" | "exact" | "fuzzy"; windowChars?: number }
): PassageResult[] {
  const mode = options?.mode ?? "case-insensitive";
  const windowChars = options?.windowChars ?? 200;
  const results: PassageResult[] = [];

  for (const query of queries) {
    let index = -1;
    const searchIn = mode === "case-insensitive" ? text.toLowerCase() : text;
    const searchFor = mode === "case-insensitive" ? query.toLowerCase() : query;

    while ((index = searchIn.indexOf(searchFor, index + 1)) !== -1) {
      const start = Math.max(0, index - windowChars);
      const end = Math.min(text.length, index + searchFor.length + windowChars);
      results.push({
        passage: text.substring(start, end),
        offset: index,
        match: text.substring(index, index + searchFor.length),
      });
    }
  }

  return results;
}
