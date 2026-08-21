import { describe, it, expect } from "vitest";
import {
  compileSystemPrompt,
  type PromptSource,
} from "@flowstore/core/codegen/promptGenerator";
import {
  blockParts,
  bodyForDisplay,
  displayCtx,
  partsText,
} from "@flowstore/core/codegen/promptDoc";
import { setLanguage, type Spec } from "@flowstore/core/schema/v0";
import { loadExampleSpec, loadFixtureSpec } from "./fixtures";

const coffee = loadExampleSpec("coffee/coffee.json");
const fnol = loadFixtureSpec("fnol-min.json");

// Augment coffee with shapes the examples don't exercise: a turn-budget escape
// and multi-line instructions with an internal blank line.
function augmented(): Spec {
  const s = structuredClone(coffee);
  const flow = s.flows.find((f) => f.type !== "interrupt" && f.exit_paths.length > 0)!;
  flow.exit_paths = [
    ...flow.exit_paths,
    { id: "xp_budget_test", goto: "END", max_turns: 3 },
  ];
  flow.instructions = "First line.\n\n  Indented second paragraph.";
  return s;
}

const specs: Array<[string, Spec]> = [
  ["coffee", coffee],
  ["fnol-min", fnol],
  ["coffee+budget", augmented()],
];

// The load-bearing invariant: for every segment with an inline model, the
// parts' display lines joined are byte-identical to the panel's read-only
// body. This is the coupling pin between promptDoc and promptGenerator /
// bodyForDisplay — if a renderer's wording or indentation changes, this
// fails before the editable view can drift from the compiled prompt.
describe("promptDoc — parts round-trip against bodyForDisplay", () => {
  for (const [name, spec] of specs) {
    it(`${name}: every editable segment's parts join to its displayed body`, () => {
      const ctx = displayCtx(spec);
      const compiled = compileSystemPrompt(spec);
      let editableSegments = 0;
      for (const seg of compiled.segments) {
        const parts = blockParts(spec, seg.source, ctx);
        if (!parts) continue;
        editableSegments++;
        const body = bodyForDisplay(seg.source.kind, compiled.text.slice(seg.start, seg.end));
        expect(partsText(parts), `${name} · ${seg.source.kind}`).toBe(body);
      }
      expect(editableSegments).toBeGreaterThan(0);
    });
  }
});

// Identity edits must be byte-stable: writing a part's own text back into its
// spec field and recompiling yields the identical prompt. This is the
// display-transform inverse check — the editable value has the "N. " prefix,
// indentation, and quote-escaping stripped, so writing it back must not
// reintroduce or lose any of them.
describe("promptDoc — identity write-back is byte-stable", () => {
  for (const [name, spec] of specs) {
    it(`${name}: guardrails, instructions, scripts, FAQ, routing`, () => {
      const ctx = displayCtx(spec);
      const baseline = compileSystemPrompt(spec).text;
      const next = structuredClone(spec);

      for (const seg of compileSystemPrompt(spec).segments) {
        const parts = blockParts(spec, seg.source, ctx);
        for (const p of parts ?? []) {
          switch (p.kind) {
            case "guardrail": {
              const g = next.agent.guardrails!.find((g) => g.id === p.guardrailId)!;
              g.statement = p.statement;
              break;
            }
            case "faq": {
              const e = next.agent.knowledge!.faq!.find((e) => e.id === p.faqId)!;
              e.question = p.question;
              e.answer = setLanguage(e.answer, ctx.lang, p.answer, ctx.defaultLang)!;
              break;
            }
            case "glossary": {
              const g = next.agent.knowledge!.glossary!.find((g) => g.id === p.glossaryId)!;
              g.term = p.term;
              g.definition = p.definition;
              break;
            }
            case "instructions": {
              next.flows.find((f) => f.id === p.flowId)!.instructions = p.text;
              break;
            }
            case "script": {
              const f = next.flows.find((f) => f.id === p.flowId)!;
              const s = f.scripts!.find((s) => s.id === p.scriptId)!;
              s.text = setLanguage(s.text, ctx.lang, p.text, ctx.defaultLang)!;
              break;
            }
            case "routing": {
              if (p.readOnly || p.expression === null) break;
              const f = next.flows.find((f) => f.id === p.flowId)!;
              const xp = f.exit_paths.find((x) => x.id === p.exitPathId)!;
              xp.condition = { ...xp.condition!, expression: p.expression };
              xp.goto = p.goto;
              break;
            }
          }
        }
      }

      expect(compileSystemPrompt(next).text).toBe(baseline);
    });
  }
});

describe("promptDoc — part structure", () => {
  it("turn-budget exits are read-only routing parts", () => {
    const spec = augmented();
    const flow = spec.flows.find((f) => f.exit_paths.some((x) => x.id === "xp_budget_test"))!;
    const parts = blockParts(spec, { kind: "flow", flowId: flow.id, name: flow.name }, displayCtx(spec))!;
    const budget = parts.find((p) => p.kind === "routing" && p.exitPathId === "xp_budget_test");
    expect(budget).toMatchObject({ readOnly: true, expression: null, goto: "END" });
  });

  it("segments without an inline model return null", () => {
    const ctx = displayCtx(coffee);
    for (const kind of ["role", "runtimeContext", "multilingual", "templateWrapper"] as const) {
      expect(blockParts(coffee, { kind } as PromptSource, ctx)).toBeNull();
    }
  });
});
