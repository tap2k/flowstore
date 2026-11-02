import { describe, it, expect } from "vitest";
import { servedModelDiffers } from "../src/llm/types";
import {
  decomposeModelsConfig,
  loadModelsConfig,
  resolveEndpoint,
  type ResolvedModelsConfig,
} from "@flowstore/core/files/models";
import type { LoadError } from "@flowstore/core/files/types";
import { fromYaml } from "@flowstore/core/files/markdown";

const MODELS_FILE = "models/models.yaml";

function baseConfig(): ResolvedModelsConfig {
  return {
    models: {},
    default: null,
    roles: {},
    capabilityEndpoints: {},
    agents: {},
  };
}

describe("decomposeModelsConfig — credential stripping", () => {
  it("strips ModelEntry.api_key, CapabilityEndpoint.headers, AgentEndpoint.turn_headers", () => {
    const config: ResolvedModelsConfig = {
      ...baseConfig(),
      models: {
        "local-llama": { name: "Local", endpoint: "openai-compatible", base_url: "http://x/v1", api_key: "sk-secret" },
      },
      capabilityEndpoints: {
        check_balance: { url: "https://api/x", method: "POST", headers: { Authorization: "Bearer cap-secret" } },
      },
      agents: {
        voicebot: {
          turn_url: "https://agent/turn",
          response_text_path: "text",
          turn_headers: { Authorization: "Bearer agent-secret" },
        },
      },
    };

    const out = decomposeModelsConfig(config);
    const serialized = out[MODELS_FILE];
    expect(serialized).toBeDefined();

    // No secret string survives anywhere in the committed payload.
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("cap-secret");
    expect(serialized).not.toContain("agent-secret");

    const parsed = fromYaml<any>(serialized, MODELS_FILE);
    expect(parsed.models["local-llama"]).not.toHaveProperty("api_key");
    expect(parsed.capabilities.check_balance).not.toHaveProperty("headers");
    expect(parsed.agents.voicebot).not.toHaveProperty("turn_headers");

    // Non-secret fields are preserved.
    expect(parsed.models["local-llama"].base_url).toBe("http://x/v1");
    expect(parsed.capabilities.check_balance.url).toBe("https://api/x");
    expect(parsed.agents.voicebot.turn_url).toBe("https://agent/turn");
    expect(parsed.agents.voicebot.response_text_path).toBe("text");
  });

  it("the stripped output round-trips back through the loader", () => {
    const config: ResolvedModelsConfig = {
      ...baseConfig(),
      capabilityEndpoints: {
        check_balance: { url: "https://api/x", headers: { Authorization: "Bearer s" } },
      },
      agents: {
        voicebot: { turn_url: "https://agent/turn", response_text_path: "text", turn_headers: { "x-api-key": "s" } },
      },
    };
    const files = decomposeModelsConfig(config);
    const errors: LoadError[] = [];
    const reloaded = loadModelsConfig(files, errors);
    expect(errors).toEqual([]);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.capabilityEndpoints.check_balance.headers).toBeUndefined();
    expect(reloaded!.agents.voicebot.turn_headers).toBeUndefined();
  });

  it("returns {} for a null or fully-empty config", () => {
    expect(decomposeModelsConfig(null)).toEqual({});
    expect(decomposeModelsConfig(baseConfig())).toEqual({});
  });
});

describe("resolveEndpoint — inference (matches the documented rule)", () => {
  it("honors an explicit known endpoint", () => {
    expect(resolveEndpoint("anything", { endpoint: "google" })).toBe("google");
  });

  it("routes an unknown explicit endpoint to the openai-compatible catchall", () => {
    expect(resolveEndpoint("anything", { endpoint: "azure" })).toBe("openai-compatible");
  });

  it("infers from unambiguous id prefixes", () => {
    expect(resolveEndpoint("gemini-2.5-flash", undefined)).toBe("google");
    expect(resolveEndpoint("gpt-5.5", undefined)).toBe("openai");
    expect(resolveEndpoint("o3", undefined)).toBe("openai");
    expect(resolveEndpoint("anthropic/claude-sonnet-4.6", undefined)).toBe("openrouter");
  });

  it("leaves multi-host ids unresolved (need explicit endpoint) — as the comment claims", () => {
    expect(resolveEndpoint("claude-opus-4.8", undefined)).toBeNull();
    expect(resolveEndpoint("grok-4.3", undefined)).toBeNull();
    expect(resolveEndpoint("llama-4-scout", undefined)).toBeNull();
    expect(resolveEndpoint("meta-llama/llama-4-maverick", undefined)).toBeNull();
  });
});

describe("servedModelDiffers", () => {
  it("treats snapshots and vendor prefixes as the same model", () => {
    expect(servedModelDiffers("gpt-4o", "gpt-4o-2024-08-06")).toBe(false);
    expect(servedModelDiffers("gemini-3.8-flash", "google/gemini-3.8-flash")).toBe(false);
    expect(servedModelDiffers("gpt-4o", undefined)).toBe(false);
  });

  it("flags a reroute to another model", () => {
    expect(servedModelDiffers("gemini-3.7-flash", "gemini-3.8-flash")).toBe(true);
    expect(servedModelDiffers("google/gemini-2.5-flash", "gemini-3.5-flash-lite")).toBe(true);
  });
});
