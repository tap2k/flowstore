import { create } from "zustand";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { CapabilityMock } from "@flowstore/core/schema/files/capabilityMock";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { Gold } from "@flowstore/core/schema/files/gold";
import type { TestingArtifacts } from "@flowstore/core/files";
import { useDirtyStore } from "./dirty";
import { toSlug } from "@/lib/slug";

// In-memory home for the testing surface's authored artifacts. Mirrors
// the shapes the core loader emits in TestingArtifacts; on project open
// we hydrate via setAll(loadProject().testingArtifacts). The save path
// in GitHubProjectControls reads from here via decomposeTests and merges
// with decomposeSpec output before writing.
//
// Mocks are keyed by capability_id for the picker UX (`Load saved ▾`
// per capability row); variant is preserved on each record and resolved
// JSON-side, not in the editor (see editor-test-loop-mvp.md Out of
// scope). Rubrics aren't edited in v1 — held here so the case editor's
// `evaluators` reference list can validate against existing ids.

export interface TestsState {
  cases: TestCase[];
  golds: Gold[];
  personas: Persona[];
  mocksByCapability: Record<string, CapabilityMock[]>;
  rubrics: Rubric[];

  setAll: (artifacts: TestingArtifacts) => void;
  clear: () => void;
  // Flatten back to the loader's TestingArtifacts shape for the save path
  // (decomposeTestingArtifacts consumes the flat form). Mock entries are
  // re-collected from the per-capability index in insertion order.
  toTestingArtifacts: () => TestingArtifacts;

  // Persona CRUD — file-backed; marks the project dirty so the next
  // GitHub Save commits the change. Save is upsert by id; delete removes
  // by id (silently no-op if missing). uniquePersonaId mints an
  // unused slug from a free-text base (e.g. "Compliant Juan" → "compliant-juan",
  // with "-2" suffix if taken).
  savePersona: (persona: Persona) => void;
  deletePersona: (id: string) => void;
  uniquePersonaId: (base: string) => string;
}

function indexMocks(mocks: CapabilityMock[]): Record<string, CapabilityMock[]> {
  const out: Record<string, CapabilityMock[]> = {};
  for (const m of mocks) {
    (out[m.capability_id] ??= []).push(m);
  }
  return out;
}

export const useTestsStore = create<TestsState>((set, get) => ({
  cases: [],
  golds: [],
  personas: [],
  mocksByCapability: {},
  rubrics: [],

  setAll: (artifacts) => {
    set({
      cases: artifacts.testCases,
      golds: artifacts.golds,
      personas: artifacts.personas,
      mocksByCapability: indexMocks(artifacts.capabilityMocks),
      rubrics: artifacts.rubrics,
    });
  },

  clear: () => {
    set({
      cases: [],
      golds: [],
      personas: [],
      mocksByCapability: {},
      rubrics: [],
    });
  },

  toTestingArtifacts: () => {
    const s = get();
    const capabilityMocks: CapabilityMock[] = [];
    for (const list of Object.values(s.mocksByCapability)) {
      capabilityMocks.push(...list);
    }
    return {
      testCases: s.cases,
      personas: s.personas,
      capabilityMocks,
      rubrics: s.rubrics,
      golds: s.golds,
    };
  },

  savePersona: (persona) => {
    set((s) => {
      const i = s.personas.findIndex((p) => p.id === persona.id);
      const next =
        i === -1
          ? [...s.personas, persona]
          : s.personas.map((p, idx) => (idx === i ? persona : p));
      return { personas: next };
    });
    useDirtyStore.getState().setDirty(true);
  },

  deletePersona: (id) => {
    set((s) => ({ personas: s.personas.filter((p) => p.id !== id) }));
    useDirtyStore.getState().setDirty(true);
  },

  uniquePersonaId: (base) => {
    const slug = toSlug(base, "persona");
    const personas = get().personas;
    if (!personas.some((p) => p.id === slug)) return slug;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${slug}-${n}`;
      if (!personas.some((p) => p.id === candidate)) return candidate;
    }
    // Pathological: 1000 personas all named the same. Fall back to a
    // timestamp so we always make progress instead of looping.
    return `${slug}-${Date.now()}`;
  },
}));
