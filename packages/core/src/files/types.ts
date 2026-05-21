import type { Spec } from "@ux4/core/schema/v0";

export type FileMap = Record<string, string>;

export interface LoadError {
  path?: string;
  message: string;
}

export interface LoadResult {
  spec: Spec | null;
  errors: LoadError[];
}
