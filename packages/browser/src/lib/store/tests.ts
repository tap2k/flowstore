import { create } from "zustand";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { Gold } from "@flowstore/core/schema/files/gold";
import type { TestingArtifacts } from "@flowstore/core/files";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import { useDirtyStore } from "./dirty";
import { toSlug } from "@/lib/slug";

// In-memory home for the testing surface's authored artifacts. Mirrors
// the shapes the core loader emits in TestingArtifacts; on project open
// we hydrate via setAll(loadProject().testingArtifacts). The save path
// in GitHubProjectControls reads from here via decomposeTests and merges
// with decomposeSpec output before writing.
//
// Personas own their world (vars + mock returns inline). Cases bind to
// a persona for persona-driven runs (and inherit its world), or carry
// their own vars+mocks for scripted runs.

// When the user captures a Simulate transcript as a test case, the Tests
// tab editor needs the full agent+user transcript to show as a read-only
// reference (so they can author assertions against what they actually
// saw). This lives in-memory only — the just-captured transcript isn't
// re-derived from the case file after a reload. captureContext.caseId
// pins the reference to the specific case so reopening another case
// doesn't see stale capture data.
export interface CaptureContext {
  caseId: string;
  transcript: TranscriptTurn[];
}

export interface TestsState {
  cases: TestCase[];
  golds: Gold[];
  personas: Persona[];
  rubrics: Rubric[];
  captureContext: CaptureContext | null;

  setAll: (artifacts: TestingArtifacts) => void;
  clear: () => void;
  toTestingArtifacts: () => TestingArtifacts;

  // Persona CRUD — file-backed; marks the project dirty so the next
  // GitHub Save commits the change. Save is upsert by id; delete removes
  // by id (silently no-op if missing) and strips persona_id from cases
  // that bound it. uniquePersonaId mints an unused slug from a free-text
  // base.
  savePersona: (persona: Persona) => void;
  deletePersona: (id: string) => void;
  uniquePersonaId: (base: string) => string;

  // Case + Gold CRUD — same shape and dirty semantics as persona.
  saveCase: (testCase: TestCase) => void;
  deleteCase: (id: string) => void;
  uniqueCaseId: (base: string) => string;

  saveGold: (gold: Gold) => void;
  deleteGold: (id: string) => void;
  uniqueGoldId: (base: string) => string;

  saveRubric: (rubric: Rubric) => void;
  deleteRubric: (id: string) => void;
  uniqueRubricId: (base: string) => string;

  setCaptureContext: (ctx: CaptureContext | null) => void;
}

export const useTestsStore = create<TestsState>((set, get) => ({
  cases: [],
  golds: [],
  personas: [],
  rubrics: [],
  captureContext: null,

  setAll: (artifacts) => {
    set({
      cases: artifacts.testCases,
      golds: artifacts.golds,
      personas: artifacts.personas,
      rubrics: artifacts.rubrics,
      captureContext: null,
    });
  },

  clear: () => {
    set({
      cases: [],
      golds: [],
      personas: [],
      rubrics: [],
      captureContext: null,
    });
  },

  toTestingArtifacts: () => {
    const s = get();
    return {
      testCases: s.cases,
      personas: s.personas,
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
    set((s) => {
      // Cascade: cases bound to this persona lose the binding (they fall
      // back to whatever vars/mocks they carry directly, if any).
      const cases = s.cases.map((c) => {
        if (c.persona_id !== id) return c;
        const { persona_id: _drop, ...rest } = c;
        return rest;
      });
      return {
        personas: s.personas.filter((p) => p.id !== id),
        cases,
      };
    });
    useDirtyStore.getState().setDirty(true);
  },

  uniquePersonaId: (base) => uniqueId(get().personas, base, "persona"),

  saveCase: (testCase) => {
    set((s) => {
      const i = s.cases.findIndex((c) => c.id === testCase.id);
      const next =
        i === -1
          ? [...s.cases, testCase]
          : s.cases.map((c, idx) => (idx === i ? testCase : c));
      return { cases: next };
    });
    useDirtyStore.getState().setDirty(true);
  },

  deleteCase: (id) => {
    set((s) => ({ cases: s.cases.filter((c) => c.id !== id) }));
    useDirtyStore.getState().setDirty(true);
  },

  uniqueCaseId: (base) => uniqueId(get().cases, base, "case"),

  saveGold: (gold) => {
    set((s) => {
      const i = s.golds.findIndex((g) => g.id === gold.id);
      const next =
        i === -1 ? [...s.golds, gold] : s.golds.map((g, idx) => (idx === i ? gold : g));
      return { golds: next };
    });
    useDirtyStore.getState().setDirty(true);
  },

  deleteGold: (id) => {
    set((s) => {
      // Cascade: cases referencing the deleted gold drop their gold_id.
      const cases = s.cases.map((c) => {
        if (c.gold_id !== id) return c;
        const { gold_id: _drop, ...rest } = c;
        return rest;
      });
      return {
        golds: s.golds.filter((g) => g.id !== id),
        cases,
      };
    });
    useDirtyStore.getState().setDirty(true);
  },

  uniqueGoldId: (base) => uniqueId(get().golds, base, "gold"),

  saveRubric: (rubric) => {
    set((s) => {
      const i = s.rubrics.findIndex((r) => r.id === rubric.id);
      const next =
        i === -1 ? [...s.rubrics, rubric] : s.rubrics.map((r, idx) => (idx === i ? rubric : r));
      return { rubrics: next };
    });
    useDirtyStore.getState().setDirty(true);
  },

  deleteRubric: (id) => {
    set((s) => {
      // Cascade: strip the deleted rubric's id from every case's
      // evaluators[] so we don't leave orphaned references behind.
      const cases = s.cases.map((c) => {
        if (!c.evaluators?.includes(id)) return c;
        const filtered = c.evaluators.filter((e) => e !== id);
        const { evaluators: _drop, ...rest } = c;
        return filtered.length > 0 ? { ...rest, evaluators: filtered } : rest;
      });
      return {
        rubrics: s.rubrics.filter((r) => r.id !== id),
        cases,
      };
    });
    useDirtyStore.getState().setDirty(true);
  },

  uniqueRubricId: (base) => uniqueId(get().rubrics, base, "rubric"),

  setCaptureContext: (ctx) => {
    set({ captureContext: ctx });
  },
}));

function uniqueId<T extends { id: string }>(
  items: T[],
  base: string,
  fallback: string,
): string {
  const slug = toSlug(base, fallback);
  if (!items.some((it) => it.id === slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}-${n}`;
    if (!items.some((it) => it.id === candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
