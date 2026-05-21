import { useSpecStore } from "./spec";

export const SPEC_STORAGE_KEY = "uxflows:spec";

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
