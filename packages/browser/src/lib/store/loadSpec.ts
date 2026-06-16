import type { Spec } from "@flowstore/core/schema/v0";
import type { TestingArtifacts } from "@flowstore/core/files";
import type { ResolvedModelsConfig } from "@flowstore/core/files/models";
import type { Comment } from "@flowstore/core/schema/files/comment";
import { useSpecStore } from "./spec";
import { useTestsStore } from "./tests";
import { useModelsStore } from "./models";
import { useCommentsStore } from "./comments";
import { useSimulateStore } from "./simulate";
import { useChatStore } from "./chat";

export interface LoadSpecOptions {
  // Project-backed loads (GitHub open/refresh, ZIP/folder import) pass the
  // artifacts, comments, and models config that travelled with the spec. Omit
  // all — a "bare" load (imported JSON) — and prior state is cleared: a bare
  // spec has no claim to the previous project's golds/cases/endpoints/threads.
  testingArtifacts?: TestingArtifacts;
  comments?: Comment[];
  modelsConfig?: ResolvedModelsConfig | null;
}

// The single sanctioned way to swap the active spec. Every store whose
// lifecycle is tied to the spec is reset here so stale state from the previous
// spec can't bleed across a load: testing artifacts (cases/golds/personas/
// rubrics), comment threads, the live simulate session plus its active
// case/gold binding, and the assistant chat transcript. Funnel ALL spec-load
// entry points through this — hand-resetting a subset at each call site is
// exactly how they drifted out of sync.
export function loadSpec(spec: Spec | null, opts: LoadSpecOptions = {}): void {
  useSpecStore.getState().setSpec(spec);

  if (opts.testingArtifacts) {
    useTestsStore.getState().setAll(opts.testingArtifacts);
  } else {
    useTestsStore.getState().clear();
  }

  if (opts.modelsConfig !== undefined) {
    useModelsStore.getState().set(opts.modelsConfig);
  } else {
    useModelsStore.getState().clear();
  }

  useCommentsStore.getState().setAll(opts.comments ?? []);

  // Tear down any in-flight simulate session and drop the active case/gold
  // binding — both reference the outgoing spec's flows/artifacts. reset()
  // deliberately keeps those bindings (the in-app "reset session" button wants
  // them), so clear them explicitly here. Runner-mode teardown is async; fire
  // and forget — the spec is already swapped.
  void useSimulateStore.getState().reset();
  useSimulateStore.getState().setActiveGoldId(null);
  useSimulateStore.getState().setActiveCaseId(null);

  // The assistant chat is about the outgoing spec (its messages embed the spec
  // and the discussion is scoped to it), so a swap starts a fresh transcript.
  // Persistence still survives a panel close / reload / HMR within one spec.
  useChatStore.getState().clear();
}
