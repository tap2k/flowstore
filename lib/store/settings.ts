import { create } from "zustand";
import { DEFAULT_MODEL, GOOGLE_MODELS } from "@/lib/llm/dispatch";

const KEY = "uxflows:settings:google_api_key";
const MODEL_KEY = "uxflows:settings:google_model";

interface SettingsState {
  googleApiKey: string;
  googleModel: string;
  setGoogleApiKey: (key: string) => void;
  setGoogleModel: (model: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  googleApiKey: "",
  googleModel: DEFAULT_MODEL,
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
}));

export function loadSavedSettings(): void {
  if (typeof window === "undefined") return;
  try {
    const key = window.localStorage.getItem(KEY) ?? "";
    const model = window.localStorage.getItem(MODEL_KEY) ?? "";
    const patch: Partial<SettingsState> = {};
    if (key) patch.googleApiKey = key;
    if (model && GOOGLE_MODELS.some((m) => m.id === model)) {
      patch.googleModel = model;
    }
    if (Object.keys(patch).length > 0) useSettingsStore.setState(patch);
  } catch {
    // ignore
  }
}
