import { describe, it, expect, vi, afterEach } from "vitest";
import type { jsonSchemaValidator, JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { TolerantJsonSchemaValidator } from "./schema-validator.js";

// Minimal shape of the schema Stitch ships for `upload_design_md.outputSchema`:
// `variantScreenInstance` self-references the enclosing type via `$defs`, but
// `$defs` is never emitted at the root. Raw Ajv throws exactly
// "can't resolve reference #/$defs/ScreenInstance from id #" on this.
const BROKEN_SCREEN_INSTANCE = {
  description: "An instance of a screen on the project.",
  type: "object",
  properties: {
    label: { description: "Optional. The screen label.", type: "string" },
    variantScreenInstance: {
      $ref: "#/$defs/ScreenInstance",
      description: "Optional. The variant Screen Instance.",
    },
  },
} as JsonSchemaType;

const VALID_SIMPLE = {
  type: "object",
  properties: { ok: { type: "boolean" } },
} as JsonSchemaType;

const okPass = (returnThis: unknown) => ({
  getValidator: () => returnThis,
}) as unknown as jsonSchemaValidator;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TolerantJsonSchemaValidator", () => {
  it("delegates to the inner validator when compilation succeeds", () => {
    const marker = (input: unknown) => ({ valid: true as const, data: input, errorMessage: undefined as undefined });
    const wrapper = new TolerantJsonSchemaValidator(okPass(marker));
    expect(wrapper.getValidator(VALID_SIMPLE)).toBe(marker);
  });

  it("delegates to a working inner Ajv validator by default", () => {
    const wrapper = new TolerantJsonSchemaValidator();
    const v = wrapper.getValidator(VALID_SIMPLE);
    expect(v({ ok: true })).toMatchObject({ valid: true });
  });

  it("passes data through untouched when the inner compile throws", () => {
    const raw = new AjvJsonSchemaValidator();
    expect(() => raw.getValidator(BROKEN_SCREEN_INSTANCE)).toThrow(/can't resolve reference #\/\$defs\/ScreenInstance/);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = new TolerantJsonSchemaValidator();
    const v = wrapper.getValidator(BROKEN_SCREEN_INSTANCE);
    expect(warn).toHaveBeenCalled();
    expect(v({ anything: "goes" })).toEqual({
      valid: true,
      data: { anything: "goes" },
      errorMessage: undefined,
    });
  });
});
