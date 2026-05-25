import Ajv, { type ErrorObject, type ValidateFunction, type SchemaObject } from "ajv";
import addFormats from "ajv-formats";
import { SpecSchema, type Spec } from "@uxflows/core/schema/v0";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const compiled = ajv.compile(SpecSchema);

export type ValidationResult =
  | { valid: true; spec: Spec }
  | { valid: false; errors: ErrorObject[] };

export function validateSpec(input: unknown): ValidationResult {
  if (compiled(input)) {
    return { valid: true, spec: input as Spec };
  }
  return { valid: false, errors: compiled.errors ?? [] };
}

export function formatErrors(errors: ErrorObject[]): string[] {
  return errors.map((e) => {
    const path = e.instancePath || "(root)";
    return `${path} ${e.message ?? ""}`.trim();
  });
}

// Compile-once cache for per-file schemas. The loader calls validateFile()
// with the schema and input; ajv compiles it once and reuses thereafter.
const compiledCache = new WeakMap<object, ValidateFunction>();

export function validateFile(
  schema: SchemaObject,
  input: unknown,
): { valid: boolean; errors: ErrorObject[] } {
  let validator = compiledCache.get(schema);
  if (!validator) {
    validator = ajv.compile(schema);
    compiledCache.set(schema, validator);
  }
  if (validator(input)) return { valid: true, errors: [] };
  return { valid: false, errors: validator.errors ?? [] };
}
