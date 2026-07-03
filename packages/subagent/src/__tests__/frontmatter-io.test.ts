import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateAgentName, AGENT_NAME_REGEX, SINGLE_CHAR_NAME_REGEX } from "../frontmatter-io.js";

describe("validateAgentName", () => {
  it("should accept single-char names", () => {
    assert.strictEqual(validateAgentName("a"), null);
    assert.strictEqual(validateAgentName("z"), null);
    assert.strictEqual(validateAgentName("1"), null);
  });

  it("should accept two-char names", () => {
    // This is the fix: previously 2-char names were rejected!
    assert.strictEqual(validateAgentName("ab"), null);
    assert.strictEqual(validateAgentName("cd"), null);
    assert.strictEqual(validateAgentName("1a"), null);
    assert.strictEqual(validateAgentName("a1"), null);
  });

  it("should accept three-char names", () => {
    assert.strictEqual(validateAgentName("abc"), null);
    assert.strictEqual(validateAgentName("123"), null);
    assert.strictEqual(validateAgentName("a-b"), null);
  });

  it("should accept names with hyphens", () => {
    assert.strictEqual(validateAgentName("a-b"), null);
    assert.strictEqual(validateAgentName("test-name"), null);
    assert.strictEqual(validateAgentName("my-long-name"), null);
  });

  it("should reject names starting with hyphen", () => {
    const result = validateAgentName("-abc");
    assert.notStrictEqual(result, null);
    assert.ok(result!.includes("must be"));
  });

  it("should reject names ending with hyphen", () => {
    const result = validateAgentName("abc-");
    assert.notStrictEqual(result, null);
    assert.ok(result!.includes("must be"));
  });

  it("should reject empty string", () => {
    const result = validateAgentName("");
    assert.strictEqual(result, "Name is required");
  });

  it("should reject names with uppercase letters", () => {
    const result = validateAgentName("Abc");
    assert.notStrictEqual(result, null);
    assert.ok(result!.includes("must be"));
  });

  it("should reject names with spaces", () => {
    const result = validateAgentName("abc def");
    assert.notStrictEqual(result, null);
    assert.ok(result!.includes("must be"));
  });

  it("should reject names longer than 50 chars", () => {
    const longName = "a".repeat(51);
    const result = validateAgentName(longName);
    assert.notStrictEqual(result, null);
    assert.ok(result!.includes("must be"));
  });

  it("should accept exactly 50 char names", () => {
    const fiftyChars = "a".repeat(50);
    assert.strictEqual(validateAgentName(fiftyChars), null);
  });

  it("should have correct regex patterns", () => {
    // AGENT_NAME_REGEX should accept 2-char names
    assert.ok(AGENT_NAME_REGEX.test("ab"));
    assert.ok(AGENT_NAME_REGEX.test("1a"));
    assert.ok(AGENT_NAME_REGEX.test("a-1"));

    // SINGLE_CHAR_NAME_REGEX for single chars
    assert.ok(SINGLE_CHAR_NAME_REGEX.test("a"));
    assert.ok(SINGLE_CHAR_NAME_REGEX.test("1"));

    // Combined, they should cover 1-50 chars (with proper constraints)
    assert.ok(!AGENT_NAME_REGEX.test("-abc"));
    assert.ok(!AGENT_NAME_REGEX.test("abc-"));
    assert.ok(!AGENT_NAME_REGEX.test("Abc"));
  });
});
