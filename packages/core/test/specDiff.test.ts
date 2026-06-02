import { describe, it, expect } from "vitest";
import { diffSpecs, renderSpecDiff } from "@flowstore/core/spec/diff";
import type { Spec } from "@flowstore/core/schema/v0";
import { loadExampleSpec } from "./fixtures";

const coffee = loadExampleSpec("coffee/coffee.json");

function clone(): Spec {
  return structuredClone(coffee);
}

describe("diffSpecs — identity", () => {
  it("reports empty for a spec against itself", () => {
    const d = diffSpecs(coffee, clone());
    expect(d.empty).toBe(true);
    expect(d.flows).toHaveLength(0);
    expect(d.agent).toBeNull();
    expect(renderSpecDiff(d)).toContain("no spec changes");
  });
});

describe("diffSpecs — flow rename is one changed flow, not add+remove", () => {
  it("surfaces a single name field change keyed by stable id", () => {
    const head = clone();
    head.flows[0].name = "Greeting & routing";
    const d = diffSpecs(coffee, head);
    expect(d.counts.flow).toEqual({ added: 0, removed: 0, changed: 1 });
    const flow = d.flows[0];
    expect(flow.kind).toBe("changed");
    expect(flow.ref.id).toBe("flow_greet");
    expect(flow.fields?.some((f) => f.field === "name")).toBe(true);
    const text = renderSpecDiff(d);
    expect(text).toContain("name:");
    expect(text).toContain("Greeting & routing");
  });
});

describe("diffSpecs — long text collapses to a char delta", () => {
  it("does not dump full instructions, only a signed delta", () => {
    const head = clone();
    const f = head.flows[0];
    f.instructions = (f.instructions ?? "") + " Always greet warmly and by name.";
    const d = diffSpecs(coffee, head);
    const text = renderSpecDiff(d);
    expect(text).toMatch(/instructions changed \(\+\d+ chars\)/);
    expect(text).not.toContain("Always greet warmly and by name.");
  });

  it("includes a bounded snippet only when opted in", () => {
    const head = clone();
    head.flows[0].instructions = "totally new instructions body";
    const d = diffSpecs(coffee, head, { textSnippets: true, snippetChars: 80 });
    const change = d.flows[0].fields?.find((x) => x.field === "instructions");
    expect(change?.kind).toBe("text");
    if (change?.kind === "text") expect(change.toSnippet).toContain("totally new instructions");
  });
});

describe("diffSpecs — exit paths resolve goto ids to names", () => {
  it("renders an added exit path with the target name and guard", () => {
    const head = clone();
    head.flows[0].exit_paths.push({
      id: "xp_greet_to_confirm",
      goto: "flow_confirm",
      condition: { expression: "customer is a regular", method: "llm" },
    });
    const d = diffSpecs(coffee, head);
    const flow = d.flows.find((x) => x.ref.id === "flow_greet")!;
    const xp = flow.children?.find((c) => c.entity === "exit_path" && c.kind === "added");
    expect(xp?.ref.name).toBe("Confirm & place"); // id resolved → name
    const text = renderSpecDiff(d);
    expect(text).toContain('exit_path → "Confirm & place" when customer is a regular');
    expect(text).not.toContain("flow_confirm"); // never the raw id
  });
});

describe("diffSpecs — agent guardrails", () => {
  it("counts and labels an added guardrail by its statement", () => {
    const head = clone();
    head.agent.guardrails = [
      ...(head.agent.guardrails ?? []),
      { id: "gr_new", statement: "Never quote prices without verification" },
    ];
    const d = diffSpecs(coffee, head);
    expect(d.counts.guardrail?.added).toBe(1);
    const text = renderSpecDiff(d);
    expect(text).toContain("agent:");
    expect(text).toContain('guardrail "Never quote prices without verification"');
  });
});

describe("diffSpecs — flow deletion", () => {
  it("reports the removed flow", () => {
    const head = clone();
    head.flows = head.flows.filter((f) => f.id !== "int_menu");
    const d = diffSpecs(coffee, head);
    expect(d.counts.flow?.removed).toBe(1);
    const removed = d.flows.find((x) => x.kind === "removed");
    expect(removed?.ref.id).toBe("int_menu");
  });
});

describe("diffSpecs — variable rename pairs add+remove", () => {
  it("re-labels a body-identical add/remove as a rename", () => {
    const base = clone();
    base.agent.variables = { customer_name: { type: "string", description: "the customer's name" } };
    const head = clone();
    head.agent.variables = { customer_full_name: { type: "string", description: "the customer's name" } };
    const d = diffSpecs(base, head);
    const v = d.agent?.children?.find((c) => c.entity === "variable");
    expect(v?.kind).toBe("changed");
    expect(v?.summary).toContain('renamed from "customer_name"');
  });
});

describe("renderSpecDiff — stamps", () => {
  it("includes short base/head shas when provided", () => {
    const head = clone();
    head.flows[0].name = "x";
    const d = diffSpecs(coffee, head, { baseSha: "abcdef1234567", headSha: "0987654321fed" });
    expect(renderSpecDiff(d)).toContain("diff abcdef1 → 0987654");
  });
});
