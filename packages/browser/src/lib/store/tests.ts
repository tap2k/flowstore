import { create } from "zustand";
import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { Persona } from "@flowstore/core/schema/files/persona";
import type { CapabilityMock } from "@flowstore/core/schema/files/capabilityMock";
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
// Mocks are keyed by capability_id for the picker UX (`Load saved ▾`
// per capability row); variant is preserved on each record and resolved
// JSON-side, not in the editor (see editor-test-loop-mvp.md Out of
// scope). Rubrics aren't edited in v1 — held here so the case editor's
// `evaluators` reference list can validate against existing ids.

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
  mocksByCapability: Record<string, CapabilityMock[]>;
  rubrics: Rubric[];
  // Vars files saved at tests/vars.<name>.json, indexed by name. Free-form
  // {variable_name: value} dicts. Cases reference them by full path via
  // testCase.vars_file (e.g., "tests/vars.bau.json").
  varsFiles: Record<string, Record<string, unknown>>;
  captureContext: CaptureContext | null;

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

  // Vars-file CRUD. saveVarsFile is upsert by name; deleteVarsFile
  // cascades into cases (strips vars_file matching the deleted file's
  // path). uniqueVarsFileName mints a slug not yet used.
  saveVarsFile: (name: string, vars: Record<string, unknown>) => void;
  deleteVarsFile: (name: string) => void;
  uniqueVarsFileName: (base: string) => string;

  // Mock CRUD — keyed by (capability_id, variant). Upsert semantics
  // match the case-/persona-/gold-/rubric- savers. deleteCapabilityMock
  // cascades into case.mock_bindings (strips the binding when its
  // referenced variant is deleted).
  saveCapabilityMock: (mock: CapabilityMock) => void;
  deleteCapabilityMock: (capability_id: string, variant: string) => void;
  uniqueMockVariant: (capability_id: string, base: string) => string;

  setCaptureContext: (ctx: CaptureContext | null) => void;
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
  varsFiles: {},
  captureContext: null,

  setAll: (artifacts) => {
    set({
      cases: artifacts.testCases,
      golds: artifacts.golds,
      personas: artifacts.personas,
      mocksByCapability: indexMocks(artifacts.capabilityMocks),
      rubrics: artifacts.rubrics,
      varsFiles: artifacts.varsFiles ?? {},
      captureContext: null,
    });
  },

  clear: () => {
    set({
      cases: [],
      golds: [],
      personas: [],
      mocksByCapability: {},
      rubrics: [],
      varsFiles: {},
      captureContext: null,
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
      varsFiles: s.varsFiles,
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
      // evaluators[] so we don't leave orphaned references behind. Cases
      // that drop to zero evaluators have the field removed entirely
      // (additive-by-default schema; undefined ≠ empty array).
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

  saveVarsFile: (name, vars) => {
    set((s) => ({ varsFiles: { ...s.varsFiles, [name]: vars } }));
    useDirtyStore.getState().setDirty(true);
  },

  deleteVarsFile: (name) => {
    set((s) => {
      const targetPath = `tests/vars.${name}.json`;
      // Cascade: cases referencing the deleted vars file drop the field.
      const cases = s.cases.map((c) => {
        if (c.vars_file !== targetPath) return c;
        const { vars_file: _drop, ...rest } = c;
        return rest;
      });
      const { [name]: _drop2, ...rest } = s.varsFiles;
      return { varsFiles: rest, cases };
    });
    useDirtyStore.getState().setDirty(true);
  },

  uniqueVarsFileName: (base) => {
    const slug = toSlug(base, "vars");
    const names = Object.keys(get().varsFiles);
    if (!names.includes(slug)) return slug;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${slug}-${n}`;
      if (!names.includes(candidate)) return candidate;
    }
    return `${slug}-${Date.now()}`;
  },

  saveCapabilityMock: (mock) => {
    set((s) => {
      const list = s.mocksByCapability[mock.capability_id] ?? [];
      const i = list.findIndex((m) => m.variant === mock.variant);
      const nextList =
        i === -1 ? [...list, mock] : list.map((m, idx) => (idx === i ? mock : m));
      return {
        mocksByCapability: { ...s.mocksByCapability, [mock.capability_id]: nextList },
      };
    });
    useDirtyStore.getState().setDirty(true);
  },

  deleteCapabilityMock: (capability_id, variant) => {
    set((s) => {
      const list = s.mocksByCapability[capability_id] ?? [];
      const nextList = list.filter((m) => m.variant !== variant);
      const { [capability_id]: _drop, ...restMocks } = s.mocksByCapability;
      const nextMocks =
        nextList.length > 0
          ? { ...restMocks, [capability_id]: nextList }
          : restMocks;
      // Cascade: cases whose binding pointed at this variant drop the
      // capability entirely from mock_bindings (no orphaned reference).
      const cases = s.cases.map((c) => {
        if (c.mock_bindings?.[capability_id] !== variant) return c;
        const { [capability_id]: _drop2, ...restBindings } = c.mock_bindings;
        if (Object.keys(restBindings).length === 0) {
          const { mock_bindings: _drop3, ...rest } = c;
          return rest;
        }
        return { ...c, mock_bindings: restBindings };
      });
      return { mocksByCapability: nextMocks, cases };
    });
    useDirtyStore.getState().setDirty(true);
  },

  uniqueMockVariant: (capability_id, base) => {
    const slug = toSlug(base, "default");
    const taken = new Set(
      (get().mocksByCapability[capability_id] ?? []).map((m) => m.variant),
    );
    if (!taken.has(slug)) return slug;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${slug}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${slug}-${Date.now()}`;
  },

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
