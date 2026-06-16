import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { debouncedLocalStorage } from "./scopedStorage";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { Gold } from "@flowstore/core/schema/files/gold";
import type { TestingArtifacts } from "@flowstore/core/files";
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

export interface TestsState {
  cases: TestCase[];
  golds: Gold[];
  personas: Persona[];
  rubrics: Rubric[];
  // Which gold is expanded in the Golds tab editor. Ephemeral session
  // state (not persisted) — set on capture/new/copy so the freshly
  // created gold opens inline.
  selectedGoldId: string | null;
  // Case to auto-open in the Tests tab editor after creation (capture
  // from Simulate or "Create Test" from a gold).
  pendingCaseId: string | null;

  setAll: (artifacts: TestingArtifacts) => void;
  clear: () => void;
  toTestingArtifacts: () => TestingArtifacts;

  // Persona CRUD — file-backed. The project's dirty bit is derived from the
  // save payload (see dirty.ts), so these don't flag dirtiness themselves;
  // the change to cases/personas is observed by the dirty subscription. Save
  // is upsert by id; delete removes by id (silently no-op if missing) and
  // strips persona_id from cases that bound it. uniquePersonaId mints an
  // unused slug from a free-text base.
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

  setSelectedGoldId: (id: string | null) => void;
  setPendingCaseId: (id: string | null) => void;
}

// Persisted under "flowstore:tests" — the file-backed authoring artifacts
// (cases / golds / personas / rubrics) survive a reload and an HMR module
// re-eval, since persist rehydrates at store-creation time. selectedGoldId and
// pendingCaseId are ephemeral session state excluded from partialize. merge
// coerces any non-array slice back to [] (robustness against a hand-edited
// localStorage blob).
export const useTestsStore = create<TestsState>()(
  persist(
    (set, get) => ({
      cases: [],
      golds: [],
      personas: [],
      rubrics: [],
      selectedGoldId: null,
      pendingCaseId: null,

      setAll: (artifacts) => {
        set({
          cases: artifacts.testCases,
          golds: artifacts.golds,
          personas: artifacts.personas,
          rubrics: artifacts.rubrics,
          selectedGoldId: null,
          pendingCaseId: null,
        });
      },

      clear: () => {
        set({
          cases: [],
          golds: [],
          personas: [],
          rubrics: [],
          selectedGoldId: null,
          pendingCaseId: null,
        });
      },

      toTestingArtifacts: () => {
        const s = get();
        return {
          testCases: s.cases,
          personas: s.personas,
          rubrics: s.rubrics,
          golds: s.golds,
          // ignored is a load-time diagnostic; nothing is skipped on save.
          ignored: [],
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
      },

      deleteCase: (id) => {
        set((s) => ({ cases: s.cases.filter((c) => c.id !== id) }));
      },

      uniqueCaseId: (base) => uniqueId(get().cases, base, "case"),

      saveGold: (gold) => {
        set((s) => {
          const i = s.golds.findIndex((g) => g.id === gold.id);
          const next =
            i === -1 ? [...s.golds, gold] : s.golds.map((g, idx) => (idx === i ? gold : g));
          return { golds: next };
        });
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
      },

      uniqueGoldId: (base) => uniqueId(get().golds, base, "gold"),

      saveRubric: (rubric) => {
        set((s) => {
          const i = s.rubrics.findIndex((r) => r.id === rubric.id);
          const next =
            i === -1 ? [...s.rubrics, rubric] : s.rubrics.map((r, idx) => (idx === i ? rubric : r));
          return { rubrics: next };
        });
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
      },

      uniqueRubricId: (base) => uniqueId(get().rubrics, base, "rubric"),

      setSelectedGoldId: (id) => {
        set({ selectedGoldId: id });
      },

      setPendingCaseId: (id) => {
        set({ pendingCaseId: id });
      },
    }),
    {
      name: "flowstore:tests",
      // Debounced: case / persona / rubric editors patch per keystroke.
      storage: createJSONStorage(() => debouncedLocalStorage()),
      partialize: (s) => ({
        cases: s.cases,
        golds: s.golds,
        personas: s.personas,
        rubrics: s.rubrics,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...current,
          cases: Array.isArray(p.cases) ? (p.cases as TestCase[]) : [],
          golds: Array.isArray(p.golds) ? (p.golds as Gold[]) : [],
          personas: Array.isArray(p.personas) ? (p.personas as Persona[]) : [],
          rubrics: Array.isArray(p.rubrics) ? (p.rubrics as Rubric[]) : [],
        };
      },
    },
  ),
);

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
