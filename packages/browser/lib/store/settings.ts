import { create } from "zustand";
import { DEFAULT_MODEL, GOOGLE_MODELS } from "@ux4/core/llm/dispatch";

const KEY = "uxflows:settings:google_api_key";
const MODEL_KEY = "uxflows:settings:google_model";
const RUNNER_KEY = "uxflows:settings:runner_url";

export const DEFAULT_RUNNER_URL = "http://localhost:8000";

interface SettingsState {
  googleApiKey: string;
  googleModel: string;
  runnerUrl: string;
  setGoogleApiKey: (key: string) => void;
  setGoogleModel: (model: string) => void;
  setRunnerUrl: (url: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  googleApiKey: "",
  googleModel: DEFAULT_MODEL,
  runnerUrl: DEFAULT_RUNNER_URL,
  setGoogleApiKey: (key) => {
    if (typeof window !== "undefined") {
      try {
        if (key) window.localStorage.setItem(KEY, key);
        else window.localStorage.removeItem(KEY);
      } catch {
        // ignore quota or access errors
      }
    }
    set({ googleApiKey: key });
  },
  setGoogleModel: (model) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MODEL_KEY, model);
      } catch {
        // ignore
      }
    }
    set({ googleModel: model });
  },
  setRunnerUrl: (url) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (typeof window !== "undefined") {
      try {
        if (trimmed) window.localStorage.setItem(RUNNER_KEY, trimmed);
        else window.localStorage.removeItem(RUNNER_KEY);
      } catch {
        // ignore
      }
    }
    set({ runnerUrl: trimmed });
  },
}));

export function loadSavedSettings(): void {
  if (typeof window === "undefined") return;
  try {
    const key = window.localStorage.getItem(KEY) ?? "";
    const model = window.localStorage.getItem(MODEL_KEY) ?? "";
    const runner = window.localStorage.getItem(RUNNER_KEY);
    const patch: Partial<SettingsState> = {};
    if (key) patch.googleApiKey = key;
    if (model && GOOGLE_MODELS.some((m) => m.id === model)) {
      patch.googleModel = model;
    }
    if (runner !== null) {
      patch.runnerUrl = runner;
    }
    if (Object.keys(patch).length > 0) useSettingsStore.setState(patch);
  } catch {
    // ignore
  }
}
