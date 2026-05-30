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

// Sibling testing artifacts that live alongside the spec but are not part
// of the runtime-compiled artifact. A persona owns its world (vars + per-
// cap mocks) inline; persona-driven cases inherit that world. Scripted
// cases carry their own vars+mocks instead.
export interface TestingArtifacts {
  testCases: TestCase[];
  personas: Persona[];
  rubrics: Rubric[];
  golds: Gold[];
}

export interface LoadResult {
  spec: Spec | null;
  modelsConfig: ResolvedModelsConfig | null;
  testingArtifacts: TestingArtifacts;
  comments: Comment[];
  errors: LoadError[];
}
