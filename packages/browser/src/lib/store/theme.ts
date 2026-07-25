import { create } from "zustand";
import { persist } from "zustand/middleware";

// "system" follows the OS; "light"/"dark" are explicit user overrides. The
// distinction has to survive a reload — a user who picked light while their OS
// is dark must not silently fall back to dark on the next visit, which is what
// storing only the *resolved* mode would do.
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEMES: readonly ThemePreference[] = ["light", "dark", "system"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ResolvedTheme {
  // matchMedia is absent under jsdom/SSR; light is the design system's base mode.
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

// The tokens key off [data-theme] on <html> — see styles/tokens.css. Always
// writing a concrete light/dark value (never "system") keeps one code path: the
// CSS never has to know a preference existed.
function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

interface ThemeState {
  /** What the user chose. Persisted. */
  preference: ThemePreference;
  /** What is actually on screen. Derived from preference + OS. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** Cycles light → dark → system, for a single-button toggle. */
  cycle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: "system",
      resolved: systemTheme(),

      setPreference: (preference) => {
        const resolved = resolveTheme(preference);
        applyTheme(resolved);
        set({ preference, resolved });
      },

      cycle: () => {
        const next = THEMES[(THEMES.indexOf(get().preference) + 1) % THEMES.length];
        get().setPreference(next);
      },
    }),
    {
      name: "flowstore:theme",
      partialize: (s) => ({ preference: s.preference }),
      merge: (persisted, current) => {
        const stored = (persisted as { preference?: unknown } | undefined)?.preference;
        const preference = THEMES.includes(stored as ThemePreference)
          ? (stored as ThemePreference)
          : "system";
        return { ...current, preference, resolved: resolveTheme(preference) };
      },
      // Rehydration happens after the module-eval default has already been
      // applied, so re-apply once the stored preference is known.
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.resolved);
      },
    },
  ),
);

// Apply on import so the attribute is set before first paint, rather than after
// React mounts (which would flash the default mode on a dark-preferring machine).
applyTheme(useThemeStore.getState().resolved);

// Follow the OS while the preference is "system". Registered once at module
// scope: this is a process-lifetime subscription, not component state.
if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    const { preference } = useThemeStore.getState();
    if (preference !== "system") return;
    const resolved = systemTheme();
    applyTheme(resolved);
    useThemeStore.setState({ resolved });
  });
}
