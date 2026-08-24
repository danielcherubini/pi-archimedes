/** Tolerant JSON Schema validator provider for the MCP SDK client. */

import type {
	JsonSchemaType,
	JsonSchemaValidator,
	jsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

/**
 * Wrapper around the SDK's Ajv-based `jsonSchemaValidator` that survives
 * unsound server-supplied JSON schemas.
 *
 * The SDK pre-compiles every tool's `outputSchema` during `tools/list`
 * (`Client#_cachedToolOutputValidators`), and a schema with an
 * unresolvable `$ref` throws at compile time — rejecting the whole tool
 * list and making all of that server's tools unusable.
 *
 * Known offender: Google's Stitch MCP (`upload_design_md.outputSchema`
 * declares `properties.variantScreenInstance.$ref = "#/$defs/ScreenInstance"`
 * but ships no `$defs` at the root of the schema).
 *
 * A schema that fails to compile degrades to a pass-through validator
 * (structured output data is not validated) instead of taking down the
 * server.
 */
export class TolerantJsonSchemaValidator implements jsonSchemaValidator {
	private readonly _inner: jsonSchemaValidator;

	constructor(inner?: jsonSchemaValidator) {
		this._inner = inner ?? new AjvJsonSchemaValidator();
	}

	getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
		try {
			return this._inner.getValidator<T>(schema);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			console.warn(`[mcp] Skipping schema validation for a tool with an unresolvable schema: ${reason}`);
			return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
		}
	}
}
