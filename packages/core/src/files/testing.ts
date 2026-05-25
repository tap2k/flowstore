import { validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import { TestCaseSchema, type TestCase } from "@flowstore/core/schema/files/testCase";
import { PersonaSchema, type Persona } from "@flowstore/core/schema/files/persona";
import {
  CapabilityMockSchema,
  type CapabilityMock,
} from "@flowstore/core/schema/files/capabilityMock";
import { RubricSchema, type Rubric } from "@flowstore/core/schema/files/rubric";
import type { FileMap, LoadError, TestingArtifacts } from "./types";

const TEST_CASE_RE = /^tests\/cases\/(.+)\.test\.json$/;
const PERSONA_RE = /^tests\/personas\/(.+)\.persona\.json$/;
const RUBRIC_RE = /^tests\/rubrics\/(.+)\.rubric\.json$/;
// Mocks live under capabilities/ and pair with declaration files by id.
// Filename: <capability_id>.<variant>.mock.json. The capability_id may
// itself contain dots, so the variant is whatever sits between the last
// `.mock.json` and the previous segment — pinned by the body's own fields,
// not by regex acrobatics.
const MOCK_RE = /^capabilities\/(.+)\.mock\.json$/;

export function loadTestingArtifacts(
  files: FileMap,
  errors: LoadError[],
): TestingArtifacts {
  return {
    testCases: loadCollection<TestCase>(
      files,
      errors,
      TEST_CASE_RE,
      TestCaseSchema,
      (parsed, baseId, path) => {
        if (parsed.id !== baseId) {
          errors.push({
            path,
            message: `id "${parsed.id}" does not match filename "${baseId}.test.json"`,
          });
        }
      },
    ),
    personas: loadCollection<Persona>(
      files,
      errors,
      PERSONA_RE,
      PersonaSchema,
      (parsed, baseId, path) => {
        if (parsed.id !== baseId) {
          errors.push({
            path,
            message: `id "${parsed.id}" does not match filename "${baseId}.persona.json"`,
          });
        }
      },
    ),
    rubrics: loadCollection<Rubric>(
      files,
      errors,
      RUBRIC_RE,
      RubricSchema,
      (parsed, baseId, path) => {
        if (parsed.id !== baseId) {
          errors.push({
            path,
            message: `id "${parsed.id}" does not match filename "${baseId}.rubric.json"`,
          });
        }
      },
    ),
    capabilityMocks: loadCollection<CapabilityMock>(
      files,
      errors,
      MOCK_RE,
      CapabilityMockSchema,
      (parsed, baseId, path) => {
        // Filename is <capability_id>.<variant>; verify body matches.
        const expected = `${parsed.capability_id}.${parsed.variant}`;
        if (expected !== baseId) {
          errors.push({
            path,
            message: `filename basename "${baseId}" does not match "${parsed.capability_id}.${parsed.variant}" from body`,
          });
        }
      },
    ),
  };
}

function loadCollection<T extends { $schema: string }>(
  files: FileMap,
  errors: LoadError[],
  pathRe: RegExp,
  schema: Parameters<typeof validateFile>[0],
  postValidate: (parsed: T, baseId: string, path: string) => void,
): T[] {
  const out: T[] = [];
  const paths = Object.keys(files).filter((p) => pathRe.test(p)).sort();
  for (const path of paths) {
    const match = pathRe.exec(path);
    if (!match) continue;
    const baseId = match[1];
    let parsed: T;
    try {
      parsed = JSON.parse(files[path]) as T;
    } catch (e) {
      errors.push({
        path,
        message: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const check = validateFile(schema, parsed);
    if (!check.valid) {
      for (const msg of formatErrors(check.errors)) {
        errors.push({ path, message: msg });
      }
      continue;
    }
    postValidate(parsed, baseId, path);
    out.push(parsed);
  }
  return out;
}
