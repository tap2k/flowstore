import { validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import { TestCaseSchema, type TestCase } from "@flowstore/core/schema/files/testCase";
import { PersonaSchema, type Persona } from "@flowstore/core/schema/files/persona";
import { ScenarioSchema, type Scenario } from "@flowstore/core/schema/files/scenario";
import { RubricSchema, type Rubric } from "@flowstore/core/schema/files/rubric";
import { GoldSchema, type Gold } from "@flowstore/core/schema/files/gold";
import type { FileMap, LoadError, TestingArtifacts } from "./types";

const TEST_CASE_RE = /^tests\/cases\/(.+)\.test\.json$/;
const PERSONA_RE = /^tests\/personas\/(.+)\.persona\.json$/;
const SCENARIO_RE = /^tests\/scenarios\/(.+)\.scenario\.json$/;
const RUBRIC_RE = /^tests\/rubrics\/(.+)\.rubric\.json$/;
const GOLD_RE = /^tests\/gold\/(.+)\.gold\.json$/;

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
    golds: loadCollection<Gold>(
      files,
      errors,
      GOLD_RE,
      GoldSchema,
      (parsed, baseId, path) => {
        if (parsed.id !== baseId) {
          errors.push({
            path,
            message: `id "${parsed.id}" does not match filename "${baseId}.gold.json"`,
          });
        }
      },
    ),
    scenarios: loadCollection<Scenario>(
      files,
      errors,
      SCENARIO_RE,
      ScenarioSchema,
      (parsed, baseId, path) => {
        if (parsed.id !== baseId) {
          errors.push({
            path,
            message: `id "${parsed.id}" does not match filename "${baseId}.scenario.json"`,
          });
        }
      },
    ),
  };
}

// Inverse of loadTestingArtifacts: produces FileMap entries for the test
// artifacts in their canonical paths. Used by the editor's save path to
// merge into decomposeSpec output before writing.
export function decomposeTestingArtifacts(
  artifacts: TestingArtifacts,
): FileMap {
  const out: FileMap = {};
  for (const c of artifacts.testCases) {
    out[`tests/cases/${c.id}.test.json`] = stringifyJson(c);
  }
  for (const p of artifacts.personas) {
    out[`tests/personas/${p.id}.persona.json`] = stringifyJson(p);
  }
  for (const r of artifacts.rubrics) {
    out[`tests/rubrics/${r.id}.rubric.json`] = stringifyJson(r);
  }
  for (const g of artifacts.golds) {
    out[`tests/gold/${g.id}.gold.json`] = stringifyJson(g);
  }
  for (const s of artifacts.scenarios) {
    out[`tests/scenarios/${s.id}.scenario.json`] = stringifyJson(s);
  }
  return out;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
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
