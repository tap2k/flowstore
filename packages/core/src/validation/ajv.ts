import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { SpecSchema, type Spec } from "@ux4/core/schema/v0";

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
