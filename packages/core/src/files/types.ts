import type { Spec } from "@flowstore/core/schema/v0";
import type { ResolvedModelsConfig } from "./models";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { Gold } from "@flowstore/core/schema/files/gold";
import type { Comment } from "@flowstore/core/schema/files/comment";

export type FileMap = Record<string, string>;

export interface LoadError {
  path?: string;
  message: string;
}

// A file at a recognized path that carried an unrecognized $schema URI (e.g. a
// newer version this loader predates, or a new artifact kind). Skipped rather
// than hard-errored — forward-compat — but SURFACED here, never silent: a
// silent skip turns a $schema typo into an invisible vanished test (suite goes
// green with the case missing). Consumers should print these.
export interface IgnoredFile {
  path: string;
  schema?: string;
  reason: string;
}

// Sibling testing artifacts that live alongside the spec but are not part
// of the runtime-compiled artifact. A persona owns its world (vars + per-
// cap mocks) inline; persona-driven cases inherit that world. Scripted
// cases carry their own vars+mocks instead.
export interface TestingArtifacts {
  testCases: TestCase[];
  personas: Persona[];
  rubrics: Rubric[];
  golds: Gold[];
  // Files skipped for an unrecognized $schema (forward-compat). Surfaced, not
  // silent — see IgnoredFile.
  ignored: IgnoredFile[];
}

export interface LoadResult {
  spec: Spec | null;
  modelsConfig: ResolvedModelsConfig | null;
  testingArtifacts: TestingArtifacts;
  comments: Comment[];
  errors: LoadError[];
}
