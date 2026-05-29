import { validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import { TestCaseSchema, type TestCase } from "@flowstore/core/schema/files/testCase";
import { PersonaSchema, type Persona } from "@flowstore/core/schema/files/persona";
import {
  CapabilityMockSchema,
  type CapabilityMock,
} from "@flowstore/core/schema/files/capabilityMock";
import { RubricSchema, type Rubric } from "@flowstore/core/schema/files/rubric";
import { GoldSchema, type Gold } from "@flowstore/core/schema/files/gold";
import type { FileMap, LoadError, TestingArtifacts } from "./types";

const TEST_CASE_RE = /^tests\/cases\/(.+)\.test\.json$/;
const PERSONA_RE = /^tests\/personas\/(.+)\.persona\.json$/;
const RUBRIC_RE = /^tests\/rubrics\/(.+)\.rubric\.json$/;
const GOLD_RE = /^tests\/gold\/(.+)\.gold\.json$/;
// Vars files are flat {var: value} dicts; convention used in
// awaaz-dpd31 puts them at tests/vars.<name>.json (note: dot, not slash,
// between "vars" and the name). Referenced from case.vars_file by full
// project-relative path.
const VARS_FILE_RE = /^tests\/vars\.(.+)\.json$/;
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
    varsFiles: loadVarsFiles(files, errors),
  };
}

function loadVarsFiles(
  files: FileMap,
  errors: LoadError[],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const path of Object.keys(files).sort()) {
    const match = VARS_FILE_RE.exec(path);
    if (!match) continue;
    const name = match[1];
    try {
      const parsed = JSON.parse(files[path]) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        errors.push({ path, message: "vars file must be a JSON object" });
        continue;
      }
      out[name] = parsed as Record<string, unknown>;
    } catch (e) {
      errors.push({
        path,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

// Inverse of loadTestingArtifacts: produces FileMap entries for the test
// artifacts in their canonical paths. Used by the editor's save path to
// merge into decomposeSpec output before writing. Mocks live under
// capabilities/<id>.<variant>.mock.json (paired with capability
// declarations); everything else lives under tests/.
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
  for (const m of artifacts.capabilityMocks) {
    out[`capabilities/${m.capability_id}.${m.variant}.mock.json`] = stringifyJson(m);
  }
  for (const [name, vars] of Object.entries(artifacts.varsFiles ?? {})) {
    out[`tests/vars.${name}.json`] = stringifyJson(vars);
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
