import type { Flow, Method, Spec } from "@flowstore/core/schema/v0";
import {
  defaultLanguage,
  isFlowGoto,
  languagesPresent,
  resolveLocalized,
} from "@flowstore/core/schema/v0";
import {
  BEGIN_WITH_PREFIX,
  FAQ_A_PREFIX,
  FAQ_Q_PREFIX,
  FLOWS_HEADER,
  GUARDRAILS_HEADER,
  INTERRUPTS_HEADER,
  ROUTING_CHOICE_PREAMBLE,
  conditionFrame,
  escapeQuotes,
  isConversationalFlow,
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
// Editable parts carry their display framing explicitly (`prefix`, `pre`/
// `mid`/`post`, the script quote constants) and their `lines` are BUILT from
// those pieces, while read-only content reuses promptGenerator's own
// renderers on singleton lists. The invariant, pinned by promptDoc.test.ts:
//     parts.flatMap(p => p.lines).join("\n") === bodyForDisplay(kind, segText)
// so if a renderer's wording, framing, or indentation changes, the test fails
// before either the editable or read-only view can drift from the compiled
// prompt — and the editor components never restate a display literal.
//
// Builders assume a single-language render with no {{var}} substitution — the
// panel gates inline editing to exactly that state (pinned language, no
// whole-document override, vars undefined).
// ─────────────────────────────────────────────────────────────────────────

// Display framing for the editable line kinds, re-exported/owned here so the
// editor components import all framing from one module. FAQ framing lives in
// promptGenerator (its renderer composes it); glossary and script framing are
// owned here and pinned against the renderers by the round-trip tests.
export { FAQ_A_PREFIX, FAQ_Q_PREFIX } from "./promptGenerator";
export const GLOSSARY_PREFIX = "- ";
export const GLOSSARY_SEP = ": ";
export const SCRIPT_PRE = '  - "';
export const SCRIPT_POST = '"';

export type BlockPart =
  // Non-editable decoration: section labels, frame lines, read-only sub-blocks.
  | { kind: "plain"; lines: string[] }
  // Agent guardrail line — "N. statement"; edit writes guardrail.statement.
  | { kind: "guardrail"; guardrailId: string; prefix: string; statement: string; lines: string[] }
  // Agent knowledge FAQ entry — Q edits question, A edits the answer in the
  // rendered language. Framing: FAQ_Q_PREFIX / FAQ_A_PREFIX.
  | { kind: "faq"; faqId: string; question: string; answer: string; lines: string[] }
  // Framing: GLOSSARY_PREFIX term GLOSSARY_SEP definition.
  | { kind: "glossary"; glossaryId: string; term: string; definition: string; lines: string[] }
  // A flow's whole instructions prose, mapped to one field (opaque free text).
  | { kind: "instructions"; flowId: string; text: string; lines: string[] }
  // One script line in the rendered language: SCRIPT_PRE text SCRIPT_POST,
  // followed by read-only variationLines. `text` is the raw field value (the
  // display escapes quotes; the editor edits the raw text). `hasOtherLanguages`
  // drives the session-transient "translations may be stale" badge.
  | {
      kind: "script";
      flowId: string;
      scriptId: string;
      text: string;
      hasOtherLanguages: boolean;
      variationLines: string[];
      lines: string[];
    }
  // One exit path, rendered as: pre [expression] mid [targetText] post.
  // `expression` is the editable condition text (null for "Otherwise"
  // fallbacks, whose pre already reads "- Otherwise, "). Turn-budget escapes
  // are runtime-enforced and render read-only from the compiled line.
  | {
      kind: "routing";
      flowId: string;
      exitPathId: string;
      expression: string | null;
      method: Method | null;
      goto: string;
      targetText: string;
      targetUnknown: boolean;
      readOnly: boolean;
      pre: string;
      mid: string;
      post: string;
      lines: string[];
    };

const dedentLines = (text: string): string[] =>
  text.split("\n").map((l) => (l.startsWith("   ") ? l.slice(3) : l));

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
      dropWhile((l) => l === FLOWS_HEADER || l.startsWith(BEGIN_WITH_PREFIX));
      if (lines.length && /^\d+\. /.test(lines[0])) lines.shift(); // "N. Name" header
      return dedent();
    case "interrupt":
      dropWhile((l) => l === INTERRUPTS_HEADER);
      if (lines.length && /^\d+\. /.test(lines[0])) lines.shift(); // "N. Name" header
      return dedent();
    case "guardrails":
      // Drop the header only; the numbered "1. …" lines are the guardrails.
      dropWhile((l) => l === GUARDRAILS_HEADER);
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
      const answer = resolveLocalized(e.answer, ctx.lang, ctx.defaultLang);
      parts.push({
        kind: "faq",
        faqId: e.id,
        question: e.question,
        answer,
        lines: `${FAQ_Q_PREFIX}${e.question}\n${FAQ_A_PREFIX}${answer}`.split("\n"),
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
        lines: [`${GLOSSARY_PREFIX}${g.term}${GLOSSARY_SEP}${g.definition}`],
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
  const flows = isInterrupt ? spec.flows : spec.flows.filter(isConversationalFlow);
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
      lines: [`Trigger: ${flow.entry_condition.expression}`],
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
      // The text line is built from the quote framing; the variation lines
      // come from the singleton renderer (they are read-only display).
      const single = renderFlowScripts({ ...flow, scripts: [s] }, ctx);
      if (!single) continue; // no text in this language — skipped by the full render too
      const text = resolveLocalized(s.text, ctx.lang, ctx.defaultLang);
      const textLines = `${SCRIPT_PRE}${escapeQuotes(text)}${SCRIPT_POST}`.split("\n");
      const present = languagesPresent(s.text, ctx.defaultLang);
      const variationLines = dedentLines(single).slice(1 + textLines.length);
      parts.push({
        kind: "script",
        flowId: flow.id,
        scriptId: s.id,
        text,
        hasOtherLanguages: present.some((l) => l !== ctx.lang),
        variationLines,
        lines: [...textLines, ...variationLines],
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
      const budget = ep.max_turns !== undefined;
      const targetText = renderInlineTarget(ep, flowNames);
      const base = {
        kind: "routing" as const,
        flowId: flow.id,
        exitPathId: ep.id,
        goto: ep.goto,
        targetText,
        targetUnknown: isFlowGoto(ep.goto) && !spec.flows.some((f) => f.id === ep.goto),
      };
      if (budget) {
        // Turn-budget wording stays single-sourced in promptGenerator; the
        // singleton render never re-adds the comparative preamble.
        parts.push({
          ...base,
          expression: null,
          method: null,
          readOnly: true,
          pre: "",
          mid: "",
          post: "",
          lines: dedentLines(renderFlowRoutingInline({ ...flow, exit_paths: [ep] }, flowNames)),
        });
        continue;
      }
      // Editable clause, built from its framing so the editor renders exactly
      // pre + expression + mid + target + post with no literals of its own.
      const frame = ep.condition ? conditionFrame(ep.condition.method) : null;
      const expression = ep.condition?.expression ?? null;
      const pre = frame ? `- ${frame.pre}` : "- Otherwise, ";
      const mid = frame ? `${frame.post}, ` : "";
      parts.push({
        ...base,
        expression,
        method: ep.condition?.method ?? null,
        readOnly: false,
        pre,
        mid,
        post: ".",
        lines: `${pre}${expression ?? ""}${mid}${targetText}.`.split("\n"),
      });
    }
  }

  return parts;
}

// Segment kinds with an inline model. blockParts returns null for the rest
// (role, runtimeContext, multilingual, templateWrapper — shown verbatim).
export const INLINE_EDITABLE_KINDS: ReadonlySet<PromptSource["kind"]> = new Set([
  "guardrails",
  "knowledge",
  "flow",
  "interrupt",
]);

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
