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
