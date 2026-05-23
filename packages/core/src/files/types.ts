import type { Spec } from "@ux4/core/schema/v0";
import type { ResolvedModelsConfig } from "./models";
import type { TestCase } from "@ux4/core/schema/files/testCase";
import type { Persona } from "@ux4/core/schema/files/persona";
import type { CapabilityMock } from "@ux4/core/schema/files/capabilityMock";
import type { Rubric } from "@ux4/core/schema/files/rubric";

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
}

export interface LoadResult {
  spec: Spec | null;
  modelsConfig: ResolvedModelsConfig | null;
  testingArtifacts: TestingArtifacts;
  errors: LoadError[];
}
