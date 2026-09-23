import { describe, it, expect } from 'vitest';
import { findPassages } from './find';

describe('find', () => {
  it('should find passages with context windows', () => {
    const text = "The quick brown fox jumps over the lazy dog. The quick brown fox is fast.";
    const queries = ["fox"];
    const results = findPassages(text, queries, { windowChars: 10 });
    
    expect(results.length).toBeGreaterThan(0);
    const r0 = results[0];
    if (!r0) throw new Error("Result missing");
    expect(r0.match).toBe("fox");
    expect(r0.passage).toContain("fox");
    // Should have about 10 chars around it
    expect(r0.passage.length).toBeLessThanOrEqual(23); // "fox" + 10 before + 10 after
  });
});
