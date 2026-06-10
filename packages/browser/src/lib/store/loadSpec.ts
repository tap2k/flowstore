import type { Spec } from "@flowstore/core/schema/v0";
import type { TestingArtifacts } from "@flowstore/core/files";
import type { Comment } from "@flowstore/core/schema/files/comment";
import { useSpecStore } from "./spec";
import { useTestsStore } from "./tests";
import { useCommentsStore } from "./comments";
import { useSimulateStore } from "./simulate";
import { useChatStore } from "./chat";

export interface LoadSpecOptions {
  // Project-backed loads (GitHub open/refresh, ZIP/folder import) pass the
  // artifacts and comments that travelled with the spec. Omit both — a "bare"
  // load (imported JSON, from-source build, trash) — and any prior tests and
  // comments are cleared: a bare spec has no claim to the previous project's
  // golds/cases/personas/rubrics or review threads.
  testingArtifacts?: TestingArtifacts;
  comments?: Comment[];
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
