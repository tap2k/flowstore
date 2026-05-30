import type { StateStorage } from "zustand/middleware";

// JSON-encoded localStorage namespaced by an id (typically agent id). Load
// returns `defaultValue()` when the key is missing, parsing fails, or the
// parsed value fails the validator — never throws. Save removes the key when
// `isEmpty(value)` returns true so stale-empty state doesn't linger.

interface ScopedJsonStorage<T> {
  load: (id: string) => T;
  save: (id: string, value: T) => void;
}

export function createScopedJsonStorage<T>(opts: {
  prefix: string;
  defaultValue: () => T;
  validate: (raw: unknown) => T | null;
  isEmpty: (value: T) => boolean;
}): ScopedJsonStorage<T> {
  const { prefix, defaultValue, validate, isEmpty } = opts;
  return {
    load(id) {
      if (typeof window === "undefined") return defaultValue();
      try {
        const raw = window.localStorage.getItem(prefix + id);
        if (!raw) return defaultValue();
        return validate(JSON.parse(raw)) ?? defaultValue();
      } catch {
        return defaultValue();
      }
    },
    save(id, value) {
      if (typeof window === "undefined") return;
      try {
        if (isEmpty(value)) window.localStorage.removeItem(prefix + id);
        else window.localStorage.setItem(prefix + id, JSON.stringify(value));
      } catch {
        // ignore quota / access errors
      }
    },
  };
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

// localStorage for zustand's `persist`, with debounced writes. persist calls
// setItem on every state change; for stores whose edits arrive per-keystroke
// (a spec flow name, a test case field) that means serializing the whole
// payload on each character. Coalescing writes over `ms` restores the cadence
// the old hand-rolled autosave had. Reads / removes stay synchronous so
// hydration and clears are immediate.
export function debouncedLocalStorage(ms = 300): StateStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { key: string; value: string } | null = null;
  return {
    getItem: (key) => {
      if (typeof window === "undefined") return null;
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      if (typeof window === "undefined") return;
      pending = { key, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pending) return;
        try {
          window.localStorage.setItem(pending.key, pending.value);
        } catch {
          // quota exhaustion or serialization failure — silently drop
        }
        pending = null;
      }, ms);
    },
    removeItem: (key) => {
      if (typeof window === "undefined") return;
      if (timer) clearTimeout(timer);
      pending = null;
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}
