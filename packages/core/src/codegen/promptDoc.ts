import type { Flow, Method, Spec } from "@flowstore/core/schema/v0";
import {
  defaultLanguage,
  languagesPresent,
  resolveLocalized,
} from "@flowstore/core/schema/v0";
import {
  ROUTING_CHOICE_PREAMBLE,
  formatFaqEntry,
  renderFlowGuardrails,
  renderFlowKnowledge,
  renderFlowRoutingInline,
  renderFlowScripts,
  renderInlineTarget,
  type PromptSource,
  type RenderCtx,
} from "./promptGenerator";

// ─────────────────────────────────────────────────────────────────────────
// The prompt-as-document model for INLINE EDITING.
//
// The System Prompt panel's View mode shows each compiled segment with its
// headers/numbering stripped (bodyForDisplay below). Inline editing needs the
// same displayed text broken into parts, each part knowing which spec entity
// (and field) it came from — so an edit writes back to that one content field
// and the whole prompt re-renders from the spec.
//
// Association is positional/per-entity, not a character-diff: guardrail line i
// ↔ agent.guardrails[i], a script line ↔ its ScriptLine, a routing line ↔ its
// ExitPath. That is safe because the panel re-renders from the spec after
// every accepted edit — an association only ever has to survive one edit.
//
// Each part carries `lines`: its exact display lines. The invariant, pinned by
// promptDoc.test.ts round-trip tests, is
//     parts.flatMap(p => p.lines).join("\n") === bodyForDisplay(kind, segText)
// so an editable render is byte-identical to the read-only one, and an
// identity edit is byte-stable through render → write-back → re-render.
// Builders reuse promptGenerator's own section renderers (called on singleton
// lists) so per-entity text cannot drift from the compiled prompt.
//
// Builders assume a single-language render with no {{var}} substitution — the
// panel gates inline editing to exactly that state (pinned language, no
// whole-document override, vars undefined).
// ─────────────────────────────────────────────────────────────────────────

export type BlockPart =
  // Non-editable decoration: section labels, frame lines, read-only sub-blocks.
  | { kind: "plain"; lines: string[] }
  // Agent guardrail line — "N. statement"; edit writes guardrail.statement.
  | { kind: "guardrail"; guardrailId: string; prefix: string; statement: string; lines: string[] }
  // Agent knowledge FAQ entry — Q edits question, A edits the answer in the
  // rendered language.
  | { kind: "faq"; faqId: string; question: string; answer: string; lines: string[] }
  | { kind: "glossary"; glossaryId: string; term: string; definition: string; lines: string[] }
  // A flow's whole instructions prose, mapped to one field (opaque free text).
  | { kind: "instructions"; flowId: string; text: string; lines: string[] }
  // One script line in the rendered language. `hasOtherLanguages` drives the
  // session-transient "translations may be stale" badge. `lines` includes the
  // read-only variation lines beneath the text.
  | {
      kind: "script";
      flowId: string;
      scriptId: string;
      text: string;
      hasOtherLanguages: boolean;
      lines: string[];
    }
  // One exit path. `expression` is the editable condition text inside its
  // method frame (null for "Otherwise" fallbacks); turn-budget escapes are
  // runtime-enforced and render read-only.
  | {
      kind: "routing";
      flowId: string;
      exitPathId: string;
      expression: string | null;
      method: Method | null;
      goto: string;
      targetText: string;
      readOnly: boolean;
      lines: string[];
    };

// ─────────────────────────────────────────────────────────────────────────
// DELIBERATE DIVERGENCE FROM THE RAW COMPILED PROMPT (moved here from
// SystemPromptPanel so core tests can pin the display transform).
//
// View mode does NOT show the literal compiled prompt. It strips the section
// headers and per-flow/per-interrupt numbering that merely restate the block's
// own colored label, so each block reads as just its content. Display only:
//   • Copy and every prompt consumer (Simulate, export, runner) use the
//     literal text from compileSystemPrompt — unaffected.
//   • A manual select-all + copy inside the panel picks up this trimmed text.
//     Accepted tradeoff (low likelihood).
//
// The matched strings mirror the headers emitted by promptGenerator.ts
// (renderGuardrails / flowsGroup / interruptsGroup). If those headers change,
// update them here too — the promptDoc round-trip tests catch the drift.
//
// Knowledge is intentionally left verbatim: its "FAQ:" / "GLOSSARY:" lines are
// meaningful sub-structure, not a header that duplicates the "Knowledge" label.
// ─────────────────────────────────────────────────────────────────────────
export function bodyForDisplay(kind: PromptSource["kind"], text: string): string {
  const lines = text.split("\n");
  const dropWhile = (pred: (line: string) => boolean) => {
    while (lines.length && pred(lines[0])) lines.shift();
    while (lines.length && lines[0] === "") lines.shift();
  };
  // flow/interrupt content is indented ≥3 spaces under the (removed) header.
  const dedent = () => lines.map((l) => (l.startsWith("   ") ? l.slice(3) : l)).join("\n");

  switch (kind) {
    case "flow":
      dropWhile((l) => l === "FLOW OF CALL:" || l.startsWith("Begin with: "));
      if (lines.length && /^\d+\. /.test(lines[0])) lines.shift(); // "N. Name" header
      return dedent();
    case "interrupt":
      dropWhile((l) => l === "INTERRUPTS (fire at any point):");
      if (lines.length && /^\d+\. /.test(lines[0])) lines.shift(); // "N. Name" header
      return dedent();
    case "guardrails":
      // Drop the header only; the numbered "1. …" lines are the guardrails.
      dropWhile((l) => l === "GUARDRAILS (apply at all times):");
      return lines.join("\n");
    default:
      return text; // role, knowledge, runtimeContext — shown verbatim
  }
}

// Single-language render context for the inline-editing view. `language`
// undefined falls back to the default language, matching compileSystemPrompt's
// pinned-language path.
export function displayCtx(spec: Spec, language?: string): RenderCtx {
  const defaultLang = defaultLanguage(spec.agent.meta.languages);
  return { lang: language ?? defaultLang, defaultLang };
}

const dedentLines = (text: string): string[] =>
  text.split("\n").map((l) => (l.startsWith("   ") ? l.slice(3) : l));

export function guardrailsBlockParts(spec: Spec): BlockPart[] {
  return (spec.agent.guardrails ?? []).map((g, i) => ({
    kind: "guardrail",
    guardrailId: g.id,
    prefix: `${i + 1}. `,
    statement: g.statement,
    lines: `${i + 1}. ${g.statement}`.split("\n"),
  }));
}

export function knowledgeBlockParts(spec: Spec, ctx: RenderCtx): BlockPart[] {
  const k = spec.agent.knowledge;
  const parts: BlockPart[] = [];
  if (k?.faq?.length) {
    parts.push({ kind: "plain", lines: ["FAQ:"] });
    for (const e of k.faq) {
      parts.push({
        kind: "faq",
        faqId: e.id,
        question: e.question,
        answer: resolveLocalized(e.answer, ctx.lang, ctx.defaultLang),
        lines: formatFaqEntry(e, "", ctx).split("\n"),
      });
    }
  }
  if (k?.glossary?.length) {
    // renderKnowledge joins its FAQ and GLOSSARY blocks with a blank line.
    if (parts.length) parts.push({ kind: "plain", lines: [""] });
    parts.push({ kind: "plain", lines: ["GLOSSARY:"] });
    for (const g of k.glossary) {
      parts.push({
        kind: "glossary",
        glossaryId: g.id,
        term: g.term,
        definition: g.definition,
        lines: [`- ${g.term}: ${g.definition}`],
      });
    }
  }
  // Tables are not inlined by renderKnowledge, so they have no parts here.
  return parts;
}

// The flow ids visible to renderInlineTarget for this block. Mirrors
// flowsGroup (conversational flows only) vs interruptsGroup (all flows) — a
// conversational exit targeting an interrupt renders the raw id, and the parts
// must reproduce that.
function routingFlowNames(spec: Spec, isInterrupt: boolean): Map<string, string> {
  const flows = isInterrupt
    ? spec.flows
    : spec.flows.filter((f) => f.type !== "interrupt" && f.type !== "utility");
  return new Map(flows.map((f) => [f.id, f.name || f.id]));
}

export function flowBlockParts(spec: Spec, flow: Flow, ctx: RenderCtx): BlockPart[] {
  const parts: BlockPart[] = [];
  const isInterrupt = flow.type === "interrupt";

  // Interrupt trigger (renderConditionPlain: the bare expression). Entry
  // conditions are inspector-edited; read-only inline.
  if (isInterrupt && flow.entry_condition) {
    parts.push({
      kind: "plain",
      lines: dedentLines(`   Trigger: ${flow.entry_condition.expression}`),
    });
  }

  const instructions = (flow.instructions ?? "").trim();
  if (instructions) {
    // flowsGroup indents every instructions line by 3; dedent inverts exactly,
    // so the displayed lines are the trimmed field verbatim.
    parts.push({
      kind: "instructions",
      flowId: flow.id,
      text: instructions,
      lines: instructions.split("\n"),
    });
  }

  if (renderFlowScripts(flow, ctx)) {
    parts.push({ kind: "plain", lines: ["Scripts:"] });
    for (const s of flow.scripts ?? []) {
      // Singleton render yields exactly this script's lines (text + its
      // variations) under the header; drop the header line.
      const single = renderFlowScripts({ ...flow, scripts: [s] }, ctx);
      if (!single) continue; // no text in this language — skipped by the full render too
      const present = languagesPresent(s.text, ctx.defaultLang);
      parts.push({
        kind: "script",
        flowId: flow.id,
        scriptId: s.id,
        text: resolveLocalized(s.text, ctx.lang, ctx.defaultLang),
        hasOtherLanguages: present.some((l) => l !== ctx.lang),
        lines: dedentLines(single).slice(1),
      });
    }
  }

  if (!isInterrupt) {
    // interruptsGroup does not render flow guardrails; flowsGroup does.
    const fg = renderFlowGuardrails(flow);
    if (fg) parts.push({ kind: "plain", lines: dedentLines(fg) });
  }

  const fk = renderFlowKnowledge(flow, ctx);
  if (fk) parts.push({ kind: "plain", lines: dedentLines(fk) });

  const exits = flow.exit_paths ?? [];
  if (exits.length) {
    const flowNames = routingFlowNames(spec, isInterrupt);
    const decidable = exits.filter((ep) => ep.max_turns === undefined).length;
    if (decidable >= 2) {
      parts.push({ kind: "plain", lines: dedentLines(ROUTING_CHOICE_PREAMBLE) });
    }
    for (const ep of exits) {
      // Singleton render never re-adds the comparative preamble (decidable ≤ 1),
      // so it yields exactly this exit's clause — including the turn-budget
      // wording, which stays single-sourced in promptGenerator.
      const single = renderFlowRoutingInline({ ...flow, exit_paths: [ep] }, flowNames);
      const budget = ep.max_turns !== undefined;
      parts.push({
        kind: "routing",
        flowId: flow.id,
        exitPathId: ep.id,
        expression: budget ? null : (ep.condition?.expression ?? null),
        method: budget ? null : (ep.condition?.method ?? null),
        goto: ep.goto,
        targetText: renderInlineTarget(ep, flowNames),
        readOnly: budget,
        lines: dedentLines(single),
      });
    }
  }

  return parts;
}

// Convenience: parts for any segment source, or null for kinds with no inline
// model (role, runtimeContext, multilingual, templateWrapper — shown verbatim).
export function blockParts(spec: Spec, source: PromptSource, ctx: RenderCtx): BlockPart[] | null {
  switch (source.kind) {
    case "guardrails":
      return guardrailsBlockParts(spec);
    case "knowledge":
      return knowledgeBlockParts(spec, ctx);
    case "flow":
    case "interrupt": {
      const flow = spec.flows.find((f) => f.id === source.flowId);
      return flow ? flowBlockParts(spec, flow, ctx) : null;
    }
    default:
      return null;
  }
}

export function partsText(parts: BlockPart[]): string {
  return parts.flatMap((p) => p.lines).join("\n");
}
