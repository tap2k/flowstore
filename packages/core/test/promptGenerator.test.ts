import { describe, it, expect } from "vitest";
import {
  compileSystemPrompt,
  generateSystemPrompt,
} from "@flowstore/core/codegen/promptGenerator";
import type { Spec } from "@flowstore/core/schema/v0";
import { loadExampleSpec } from "./fixtures";

const coffee = loadExampleSpec("coffee/coffee.json");
const baseline = compileSystemPrompt(coffee).text;
// inner body with the final trailing "\n" stripped — the slice {generated}
// expands to between any preamble/postamble.
const body = baseline.replace(/\n$/, "");

function withTemplate(tmpl: string): Spec {
  const s = structuredClone(coffee);
  s.agent.system_prompt = tmpl;
  return s;
}

describe("compileSystemPrompt — baseline", () => {
  it("matches the committed snapshot", () => {
    expect(baseline).toMatchSnapshot();
  });

  it("generateSystemPrompt is a thin wrapper over compileSystemPrompt().text", () => {
    expect(generateSystemPrompt(coffee)).toBe(baseline);
  });

  it("emits sections in role → guardrails → flows → knowledge order", () => {
    // role line first; FLOW OF CALL after it.
    expect(baseline.startsWith(`You are ${coffee.agent.meta.name}.`)).toBe(true);
    expect(baseline).toContain("FLOW OF CALL:");
  });
});

describe("compileSystemPrompt — system_prompt template", () => {
  it("unset template is byte-for-byte the baseline", () => {
    expect(coffee.agent.system_prompt).toBeUndefined();
    expect(compileSystemPrompt(withTemplate("{generated}")).text).toBe(baseline);
  });

  it("preamble lands before the generated body", () => {
    const text = compileSystemPrompt(withTemplate("PREAMBLE LINE.\n\n{generated}")).text;
    expect(text).toBe("PREAMBLE LINE.\n\n" + baseline);
  });

  it("postamble lands after the generated body", () => {
    const text = compileSystemPrompt(withTemplate("{generated}\n\nEND NOTE.")).text;
    expect(text.startsWith(body)).toBe(true);
    expect(text.endsWith("\n\nEND NOTE.\n")).toBe(true);
  });

  it("brackets the body with both preamble and postamble", () => {
    const text = compileSystemPrompt(withTemplate("PRE.\n\n{generated}\n\nPOST.")).text;
    expect(text.startsWith("PRE.\n\n")).toBe(true);
    expect(text.endsWith("\n\nPOST.\n")).toBe(true);
    expect(text).toContain("FLOW OF CALL:");
  });

  it("full override (no {generated}) drops all spec-derived content", () => {
    const text = compileSystemPrompt(withTemplate("You are a plain bot.")).text;
    expect(text).toBe("You are a plain bot.\n");
    expect(text).not.toContain("FLOW OF CALL:");
  });

  it("replaces only the first {generated}; later ones stay literal", () => {
    const text = compileSystemPrompt(withTemplate("{generated}\n\n{generated}")).text;
    expect(text.split("FLOW OF CALL:").length - 1).toBe(1); // body spliced once
    expect(text).toContain("{generated}"); // second placeholder untouched
  });
});

describe("compileSystemPrompt — variable substitution", () => {
  it("substitutes {var} inside the template", () => {
    const text = compileSystemPrompt(withTemplate("Hi {customer_name}.\n\n{generated}"), {
      customer_name: "Alex",
    }).text;
    expect(text.startsWith("Hi Alex.\n\n")).toBe(true);
  });

  it("{generated} is reserved — not substitutable from vars", () => {
    const text = compileSystemPrompt(withTemplate("{generated}"), { generated: "OOPS" }).text;
    expect(text).toBe(baseline);
    expect(text).not.toContain("OOPS");
  });

  it("leaves unknown {placeholder} tokens untouched", () => {
    const text = compileSystemPrompt(withTemplate("{unknown_token}\n\n{generated}")).text;
    expect(text.startsWith("{unknown_token}\n\n")).toBe(true);
  });
});

describe("compileSystemPrompt — segments", () => {
  it("unset template yields no templateWrapper segments", () => {
    const { segments } = compileSystemPrompt(coffee);
    expect(segments.some((s) => s.source.kind === "templateWrapper")).toBe(false);
    expect(segments[0].source.kind).toBe("role");
  });

  it("preamble emits a leading templateWrapper, inner segments retain their kind", () => {
    const { segments } = compileSystemPrompt(withTemplate("PRE.\n\n{generated}"));
    expect(segments[0].source.kind).toBe("templateWrapper");
    expect(segments[0].start).toBe(0);
    expect(segments.some((s) => s.source.kind === "role")).toBe(true);
    // no postamble → no trailing wrapper
    expect(segments.filter((s) => s.source.kind === "templateWrapper")).toHaveLength(1);
  });

  it("full override is a single templateWrapper segment", () => {
    const { segments } = compileSystemPrompt(withTemplate("You are a plain bot."));
    expect(segments).toHaveLength(1);
    expect(segments[0].source.kind).toBe("templateWrapper");
  });
});
