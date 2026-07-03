import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseGitStatusLine } from "../utils/git.js";

describe("parseGitStatusLine", () => {
  it("should parse scored format (porcelain v2)", () => {
    const result = parseGitStatusLine("1 AM filepath.txt");
    assert.deepStrictEqual(result, { indexField: "A", workTreeField: "M" });
  });

  it("should parse untracked files in unscored format", () => {
    // In porcelain v2, untracked is "??" (no space)
    const result = parseGitStatusLine("?? untracked.txt");
    assert.deepStrictEqual(result, { indexField: "?", workTreeField: "?" });
  });

  it("should parse staged and unstaged changes", () => {
    const result1 = parseGitStatusLine("1 AM file1.txt");
    assert.deepStrictEqual(result1, { indexField: "A", workTreeField: "M" });

    const result2 = parseGitStatusLine("M  file2.txt");
    assert.deepStrictEqual(result2, { indexField: "M", workTreeField: " " });
  });

  it("should return null for unrecognized format", () => {
    assert.strictEqual(parseGitStatusLine("invalid line"), null);
  });

  it("should handle rename entries in v2 (if applicable)", () => {
    // In porcelain v2, renames can be: "R old.txt -> new.txt"
    // This is a simplified check; actual format may vary
    const result = parseGitStatusLine("R  old.txt -> new.txt");
    // R entries have indexField="R", workTreeField would be second char of "  " or "-"
    assert.strictEqual(result?.indexField, "R");
  });

  it("should handle space in filenames (porcelain v2)", () => {
    // In v2, untracked is ?? followed by space and path
    const result = parseGitStatusLine("?? file with spaces.txt");
    assert.deepStrictEqual(result, { indexField: "?", workTreeField: "?" });
  });

  it("should correctly identify staged (A), unstaged (M), and untracked (??) files", () => {
    const staged = parseGitStatusLine("1 AM file.txt"); // staged add + modified
    assert.strictEqual(staged?.indexField, "A");
    assert.strictEqual(staged?.workTreeField, "M");

    const unstaged = parseGitStatusLine("M  file.txt"); // unstaged modify
    assert.strictEqual(unstaged?.indexField, "M");
    assert.strictEqual(unstaged?.workTreeField, " ");

    const untracked = parseGitStatusLine("?? file.txt"); // untracked
    assert.strictEqual(untracked?.indexField, "?");
    assert.strictEqual(untracked?.workTreeField, "?");
  });
});
