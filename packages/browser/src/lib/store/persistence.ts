import { useSpecStore } from "./spec";
import { useTestsStore, type TestsState } from "./tests";
import { useSimulateStore } from "./simulate";
import { useUiStore } from "./ui";

export const SPEC_STORAGE_KEY = "flowstore:spec";
export const TESTS_STORAGE_KEY = "flowstore:tests";
// Session-recoverable subset of useSimulateStore — only the bits that
// survive a reload as authoring state (active case binding). The
// transcript / sessionId / events are runtime artifacts; they re-derive
// from the next Run.
export const SIMULATE_AUTH_STORAGE_KEY = "flowstore:simulate_auth";
export const UI_STORAGE_KEY = "flowstore:ui";

export function loadSavedSpec(): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SPEC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSavedSpec(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SPEC_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function startSpecPersistence(debounceMs = 300): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useSpecStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        if (state.spec) {
          window.localStorage.setItem(SPEC_STORAGE_KEY, JSON.stringify(state.spec));
        } else {
          window.localStorage.removeItem(SPEC_STORAGE_KEY);
        }
      } catch {
        // quota exhaustion or serialization failure — silently drop
      }
    }, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

// ----- Tests store -----
// Persists cases / golds / personas / mocksByCapability / rubrics — the
// file-backed authoring artifacts the editor manages. captureContext is
// intentionally NOT persisted: the planning doc treats the reference
// transcript as ephemeral session state.

interface PersistedTestsShape {
  cases: TestsState["cases"];
  golds: TestsState["golds"];
  personas: TestsState["personas"];
  mocksByCapability: TestsState["mocksByCapability"];
  rubrics: TestsState["rubrics"];
}

export function loadSavedTests(): PersistedTestsShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TESTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTestsShape>;
    if (
      !Array.isArray(parsed.cases) ||
      !Array.isArray(parsed.golds) ||
      !Array.isArray(parsed.personas) ||
      !Array.isArray(parsed.rubrics) ||
      typeof parsed.mocksByCapability !== "object" ||
      parsed.mocksByCapability === null
    ) {
      return null;
    }
    return {
      cases: parsed.cases,
      golds: parsed.golds,
      personas: parsed.personas,
      mocksByCapability: parsed.mocksByCapability,
      rubrics: parsed.rubrics,
    };
  } catch {
    return null;
  }
}

export function clearSavedTests(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TESTS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function startTestsPersistence(debounceMs = 300): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useTestsStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const payload: PersistedTestsShape = {
          cases: state.cases,
          golds: state.golds,
          personas: state.personas,
          mocksByCapability: state.mocksByCapability,
          rubrics: state.rubrics,
        };
        window.localStorage.setItem(TESTS_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // quota exhaustion or serialization failure — silently drop
      }
    }, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

// ----- Simulate authoring state -----
// Only activeCaseId for now (the case binding the user is testing
// against). Restoring this on reload means the Active-case strip
// reappears and ▶ Re-run case lights up against whatever case the
// designer last opened.

interface PersistedSimulateAuth {
  activeCaseId: string | null;
}

export function loadSavedSimulateAuth(): PersistedSimulateAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIMULATE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSimulateAuth>;
    return {
      activeCaseId:
        typeof parsed.activeCaseId === "string" ? parsed.activeCaseId : null,
    };
  } catch {
    return null;
  }
}

export function startSimulateAuthPersistence(debounceMs = 100): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSerialized = "";
  const unsubscribe = useSimulateStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const payload: PersistedSimulateAuth = {
          activeCaseId: state.activeCaseId,
        };
        const serialized = JSON.stringify(payload);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        window.localStorage.setItem(SIMULATE_AUTH_STORAGE_KEY, serialized);
      } catch {
        // ignore
      }
    }, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

// ----- UI state -----
// Only openSimulateTab for now — preserves which Run-pill tab the user
// was on (Simulate / Tests / Personas) across reloads.

interface PersistedUi {
  openSimulateTab: "simulate" | "tests" | "personas" | "golds";
}

export function loadSavedUi(): PersistedUi | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedUi>;
    if (
      parsed.openSimulateTab !== "simulate" &&
      parsed.openSimulateTab !== "tests" &&
      parsed.openSimulateTab !== "personas" &&
      parsed.openSimulateTab !== "golds"
    ) {
      return null;
    }
    return { openSimulateTab: parsed.openSimulateTab };
  } catch {
    return null;
  }
}

export function startUiPersistence(debounceMs = 100): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSerialized = "";
  const unsubscribe = useUiStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const payload: PersistedUi = { openSimulateTab: state.openSimulateTab };
        const serialized = JSON.stringify(payload);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        window.localStorage.setItem(UI_STORAGE_KEY, serialized);
      } catch {
        // ignore
      }
    }, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
