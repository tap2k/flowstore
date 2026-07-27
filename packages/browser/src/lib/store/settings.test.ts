import { describe, it, expect, beforeEach } from "vitest";
import { hasKeyForModel, resolveDispatch, useSettingsStore } from "./settings";

// Node env: the store starts with empty keys (no window hydration), and
// setState drives the scenarios directly.

const KEYS = { googleApiKey: "", openaiApiKey: "", openrouterApiKey: "" };

beforeEach(() => useSettingsStore.setState({ ...KEYS }));

describe("resolveDispatch — OpenRouter fallback", () => {
  it("native key present: the picked route wins unchanged", () => {
    useSettingsStore.setState({ googleApiKey: "gk", openrouterApiKey: "ork" });
    const d = resolveDispatch("gemini-2.5-flash");
    expect(d.provider).toBe("google");
    expect(d.apiKey).toBe("gk");
    expect(d.wireModel).toBe("gemini-2.5-flash");
  });

  it("no native key + OpenRouter key: falls back under the vendor-prefixed id", () => {
    useSettingsStore.setState({ openrouterApiKey: "ork" });
    const g = resolveDispatch("gemini-2.5-flash");
    expect(g.provider).toBe("openai-compatible");
    expect(g.endpoint).toBe("openrouter");
    expect(g.apiKey).toBe("ork");
    expect(g.wireModel).toBe("google/gemini-2.5-flash");
    expect(g.baseUrl).toContain("openrouter.ai");

    const o = resolveDispatch("gpt-4o-mini");
    expect(o.provider).toBe("openai-compatible");
    expect(o.wireModel).toBe("openai/gpt-4o-mini");
  });

  it("no keys at all: the native route returns with an empty key (no fallback)", () => {
    const d = resolveDispatch("gemini-2.5-flash");
    expect(d.provider).toBe("google");
    expect(d.apiKey).toBe("");
    expect(hasKeyForModel("gemini-2.5-flash")).toBe(false);
  });

  it("voice (Live) entries never fall back — Google-only, crisp error upstream", () => {
    useSettingsStore.setState({ openrouterApiKey: "ork" });
    const d = resolveDispatch("gemini-3.1-flash-live-preview");
    expect(d.provider).toBe("google");
    expect(d.apiKey).toBe("");
  });

  it("fallback makes the model dispatchable for the picker filter", () => {
    useSettingsStore.setState({ openrouterApiKey: "ork" });
    expect(hasKeyForModel("gemini-2.5-flash")).toBe(true);
  });
});
