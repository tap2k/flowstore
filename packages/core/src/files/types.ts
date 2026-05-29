import type { Spec } from "@flowstore/core/schema/v0";
import type { ResolvedModelsConfig } from "./models";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { CapabilityMock } from "@flowstore/core/schema/files/capabilityMock";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { Gold } from "@flowstore/core/schema/files/gold";
import type { Comment } from "@flowstore/core/schema/files/comment";

export type FileMap = Record<string, string>;

export interface LoadError {
  path?: string;
  message: string;
}

// Sibling testing artifacts that live alongside the spec but are not part
// of the runtime-compiled artifact. The editor's result viewer + Nikunj's
// scripts both consume from here.
export interface TestingArtifacts {
  testCases: TestCase[];
  personas: Persona[];
  capabilityMocks: CapabilityMock[];
  rubrics: Rubric[];
  golds: Gold[];
  // Free-form {variable_name: value} dicts saved as tests/vars.<name>.json.
  // Keyed by name (the bit between "vars." and ".json"). No schema —
  // values are coerced at the case-runtime layer per VariableDecl types.
  varsFiles: Record<string, Record<string, unknown>>;
}

export interface LoadResult {
  spec: Spec | null;
  modelsConfig: ResolvedModelsConfig | null;
  testingArtifacts: TestingArtifacts;
  comments: Comment[];
  errors: LoadError[];
}
