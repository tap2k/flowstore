import { validateFile, formatErrors } from "@flowstore/core/validation/ajv";
import { TestCaseSchema, type TestCase } from "@flowstore/core/schema/files/testCase";
import { PersonaSchema, type Persona } from "@flowstore/core/schema/files/persona";
import { RubricSchema, type Rubric } from "@flowstore/core/schema/files/rubric";
import { GoldSchema, type Gold } from "@flowstore/core/schema/files/gold";
import type { FileMap, IgnoredFile, LoadError, TestingArtifacts } from "./types";

const TEST_CASE_RE = /^tests\/cases\/(.+)\.test\.json$/;
const PERSONA_RE = /^tests\/personas\/(.+)\.persona\.json$/;
const RUBRIC_RE = /^tests\/rubrics\/(.+)\.rubric\.json$/;
const GOLD_RE = /^tests\/gold\/(.+)\.gold\.json$/;

// The $schema URI each loader understands. A recognized path carrying a
// DIFFERENT URI (a newer version, or a future kind) is skipped + surfaced
// instead of hard-errored — see loadCollection.
const TEST_CASE_SCHEMA = "flowstore://test/case/v0";
const PERSONA_SCHEMA = "flowstore://test/persona/v0";
const RUBRIC_SCHEMA = "flowstore://test/rubric/v0";
const GOLD_SCHEMA = "flowstore://test/gold/v0";

export function loadTestingArtifacts(
  files: FileMap,
  errors: LoadError[],
): TestingArtifacts {
  files = migrateTestingFiles(files);
  const ignored: IgnoredFile[] = [];

  return {
    testCases: loadCollection<TestCase>(
      files,
      errors,
      ignored,
      TEST_CASE_RE,
      TestCaseSchema,
      TEST_CASE_SCHEMA,
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
      ignored,
      PERSONA_RE,
      PersonaSchema,
      PERSONA_SCHEMA,
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
      ignored,
      RUBRIC_RE,
      RubricSchema,
      RUBRIC_SCHEMA,
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
      ignored,
      GOLD_RE,
      GoldSchema,
      GOLD_SCHEMA,
      (parsed, baseId, path) => {
        if (parsed.id !== baseId) {
          errors.push({
            path,
            message: `id "${parsed.id}" does not match filename "${baseId}.gold.json"`,
          });
        }
      },
    ),
    ignored,
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
  return out;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

// Behavior-preserving, idempotent migration from the legacy "persona owns the
// world" model to "persona = actor with intrinsic fixture; case carries
// situational fixture". Runs before strict validation so old specs still load
// under the new schema (which requires persona.system_prompt and forbids a
// scripted case from also binding a persona).
//
// It rewrites ONLY genuinely-legacy shapes, leaving valid new-model artifacts
// untouched (so re-opening a hand-migrated repo doesn't undo its intrinsic /
// situational split):
//   - World-only persona (no system_prompt): fold its fixture into every case
//     that binds it (case wins), drop the binding, delete the persona.
//   - Scripted case (user_turns) that also binds a prompted persona purely for
//     its world: fold the persona's fixture into the case (case wins), drop the
//     binding. The persona keeps its fixture as intrinsic for any persona-
//     driven cases that legitimately inherit it.
// Effective fixture (`persona ∪ case`) is unchanged in every case.
function migrateTestingFiles(files: FileMap): FileMap {
  const PERSONA_PATH_RE = /^tests\/personas\/(.+)\.persona\.json$/;
  const CASE_PATH_RE = /^tests\/cases\/(.+)\.test\.json$/;

  type Obj = Record<string, unknown>;
  const parseObj = (text: string): Obj | null => {
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
    } catch {
      return null;
    }
  };

  const personaPaths = Object.keys(files).filter((p) => PERSONA_PATH_RE.test(p));
  const casePaths = Object.keys(files).filter((p) => CASE_PATH_RE.test(p));

  const personaById = new Map<string, Obj>();
  for (const path of personaPaths) {
    const obj = parseObj(files[path]);
    if (obj && typeof obj.id === "string") personaById.set(obj.id, obj);
  }
  // Legacy "world-only" personas omitted system_prompt entirely (it was
  // optional), so its ABSENCE is the migration signal. A present-but-empty
  // system_prompt is instead a new-model authoring error — leave it for the
  // schema (minLength) to reject loudly rather than silently deleting it here.
  const isWorldOnly = (p: Obj): boolean => typeof p.system_prompt !== "string";

  const asRecord = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

  const out: FileMap = { ...files };
  let mutated = false;

  for (const path of casePaths) {
    const c = parseObj(files[path]);
    if (!c) continue;
    const pid = typeof c.persona_id === "string" ? c.persona_id : null;
    if (!pid) continue;
    const persona = personaById.get(pid);
    if (!persona) continue;
    const foldForWorldOnly = isWorldOnly(persona);
    const foldForScripted = Array.isArray(c.user_turns);
    if (!foldForWorldOnly && !foldForScripted) continue; // persona-driven, prompted → leave alone
    // case wins: persona fixture under, case fixture over.
    const mergedVars = { ...asRecord(persona.vars), ...asRecord(c.vars) };
    const mergedMocks = { ...asRecord(persona.mocks), ...asRecord(c.mocks) };
    if (Object.keys(mergedVars).length > 0) c.vars = mergedVars;
    if (Object.keys(mergedMocks).length > 0) c.mocks = mergedMocks;
    delete c.persona_id;
    out[path] = stringifyJson(c);
    mutated = true;
  }

  // Delete world-only personas (their fixture now lives on the binding cases).
  for (const path of personaPaths) {
    const obj = parseObj(files[path]);
    if (obj && isWorldOnly(obj)) {
      delete out[path];
      mutated = true;
    }
  }

  return mutated ? out : files;
}

function loadCollection<T extends { $schema: string }>(
  files: FileMap,
  errors: LoadError[],
  ignored: IgnoredFile[],
  pathRe: RegExp,
  schema: Parameters<typeof validateFile>[0],
  expectedSchema: string,
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
    // Forward-compat: a recognized path carrying an UNRECOGNIZED $schema URI
    // (a newer version this loader predates, a future kind) is skipped and
    // surfaced via `ignored`, not hard-errored. A MISSING/non-string $schema,
    // or a matching URI with bad fields, is a real authoring bug and still
    // fails loudly through validateFile below.
    const uri = (parsed as { $schema?: unknown }).$schema;
    if (typeof uri === "string" && uri !== expectedSchema) {
      ignored.push({
        path,
        schema: uri,
        reason: `unrecognized $schema "${uri}" (this loader understands "${expectedSchema}")`,
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
