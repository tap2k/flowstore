import type { Flow, Method, Spec } from "@flowstore/core/schema/v0";
import {
  defaultLanguage,
  isFlowGoto,
  languagesPresent,
  resolveLocalized,
} from "@flowstore/core/schema/v0";
import {
  BEGIN_WITH_PREFIX,
  FAQ_A_LABEL,
  FAQ_A_PREFIX,
  FAQ_LANG_INDENT,
  FAQ_Q_PREFIX,
  FLOWS_HEADER,
  GUARDRAILS_HEADER,
  INTERRUPTS_HEADER,
  ROLE_PRE,
  ROLE_TONE_PREFIX,
  ROUTING_CHOICE_PREAMBLE,
  TRIGGER_PREFIX,
  conditionFrame,
  escapeQuotes,
  isConversationalFlow,
  locPerLang,
  renderFlowKnowledge,
  renderFlowRoutingInline,
  renderFlowScripts,
  renderInlineTarget,
  type PromptSource,
  type RenderCtx,
} from "./promptGenerator";
import type { FaqEntry } from "@flowstore/core/schema/v0";

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
// ↔ agent.guardrails[i], a script line ↔ its ScriptLine (and, in the
// multilingual view, one line per language of that ScriptLine), a routing
// line ↔ its ExitPath. That is safe because the panel re-renders from the
// spec after every accepted edit — an association only ever has to survive
// one edit.
//
// Editable parts carry their display framing explicitly (prefixes and
// pre/mid/post strings) and their `lines` are BUILT from those pieces, while
// read-only content reuses promptGenerator's own renderers on singleton
// lists. The invariant, pinned by promptDoc.test.ts:
//     parts.flatMap(p => p.lines).join("\n") === bodyForDisplay(kind, segText)
// so if a renderer's wording, framing, or indentation changes, the test fails
// before either the editable or read-only view can drift from the compiled
// prompt — and the editor components never restate a display literal.
//
// Builders support both render modes the panel gates to: a pinned language
// (ctx.langs unset) and the multilingual "auto" view (ctx.langs set — script
// lines and FAQ answers become one labeled editable line per language with
// reviewed content; a language with no content renders no line, so adding a
// translation stays an inspector/CSV job). {{var}} substitution is never
// applied (vars undefined).
// ─────────────────────────────────────────────────────────────────────────

// Display framing owned here and pinned against the renderers by the
// round-trip tests (FAQ/role/trigger framing lives in promptGenerator, whose
// renderers compose it directly).
export const GLOSSARY_PREFIX = "- ";
export const GLOSSARY_SEP = ": ";
export { FAQ_A_LABEL, FAQ_A_PREFIX, FAQ_Q_PREFIX, ROLE_PRE, ROLE_TONE_PREFIX, TRIGGER_PREFIX } from "./promptGenerator";
const SCRIPT_PRE = '  - "';
const QUOTE = '"';
const FLOW_GUARDRAILS_HEADER = "Flow guardrails:";
const FLOW_GUARDRAIL_PRE = "  - ";
const FLOW_FAQ_HEADER = "FAQ:";
const FLOW_FAQ_INDENT = "  ";

// One editable answer line of a FAQ entry. Single-language mode has exactly
// one (lang = the pinned language, pre = FAQ_A_PREFIX); multilingual mode has
// one per language with reviewed content (pre = indented "LANG: " label).
export interface FaqAnswer {
  lang: string;
  pre: string;
  text: string;
}

export type BlockPart =
  // Non-editable decoration: section labels, frame lines, read-only sub-blocks.
  | { kind: "plain"; lines: string[] }
  // The synthesized role line: "You are {identity}. {purpose} Tone: {tone}".
  // Each present meta field is its own editable span; absent purpose/tone are
  // not addable inline (no text to click) — that stays in the agent sheet.
  | { kind: "role"; identity: string; purpose: string; tone: string | null; lines: string[] }
  // Agent guardrail line — "N. statement"; edit writes guardrail.statement.
  | { kind: "guardrail"; guardrailId: string; prefix: string; statement: string; lines: string[] }
  // Flow guardrail line under the "Flow guardrails:" label.
  | {
      kind: "flowGuardrail";
      flowId: string;
      guardrailId: string;
      pre: string;
      statement: string;
      lines: string[];
    }
  // A FAQ entry (agent knowledge, or a flow's when flowId is set). qPre frames
  // the question; answerHeader is the bare "A:" label line in multilingual
  // mode (null when the single answer line carries its own prefix).
  | {
      kind: "faq";
      faqId: string;
      flowId?: string;
      qPre: string;
      question: string;
      answerHeader: string | null;
      answers: FaqAnswer[];
      lines: string[];
    }
  // Framing: GLOSSARY_PREFIX term GLOSSARY_SEP definition.
  | { kind: "glossary"; glossaryId: string; term: string; definition: string; lines: string[] }
  // An interrupt's entry condition: TRIGGER_PREFIX + editable expression.
  | { kind: "trigger"; flowId: string; expression: string; lines: string[] }
  // A flow's whole instructions prose, mapped to one field (opaque free text).
  | { kind: "instructions"; flowId: string; text: string; lines: string[] }
  // One script line: pre "text" — in the multilingual view, one part per
  // language with content (pre carries the language label). `text` is the raw
  // field value (the display escapes quotes; the editor edits the raw text).
  // `hasOtherLanguages` drives the pinned-language "translations may be
  // stale" badge (always false in the multilingual view, where every
  // translation is visible). variationLines are read-only display.
  | {
      kind: "script";
      flowId: string;
      scriptId: string;
      lang: string;
      pre: string;
      post: string;
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

// Render context for the inline-editing view, mirroring the panel's compile
// call: a pinned `language` resolves to that language; undefined is the
// "auto" view, which is multilingual when more than one language is declared
// (the same guard compileSystemPrompt applies to ALL_LANGUAGES).
export function displayCtx(spec: Spec, language?: string): RenderCtx {
  const declared = spec.agent.meta.languages ?? [];
  const defaultLang = defaultLanguage(declared);
  const langs = !language && declared.length > 1 ? declared : undefined;
  return { lang: language ?? defaultLang, defaultLang, langs };
}

export function roleBlockParts(spec: Spec): BlockPart[] {
  const { identity, purpose, tone } = spec.agent.meta;
  const text =
    `${ROLE_PRE}${identity}.` +
    (purpose ? ` ${purpose}` : "") +
    (tone ? ` ${ROLE_TONE_PREFIX}${tone}` : "");
  return [
    {
      kind: "role",
      identity,
      purpose: purpose ?? "",
      tone: tone || null,
      lines: text.split("\n"),
    },
  ];
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

// Build a FAQ part for one entry at a given display indent ("" for agent
// knowledge, FLOW_FAQ_INDENT for a flow's), in either render mode.
function faqPart(e: FaqEntry, indent: string, ctx: RenderCtx, flowId?: string): BlockPart {
  const qPre = `${indent}${FAQ_Q_PREFIX}`;
  if (ctx.langs) {
    const answers: FaqAnswer[] = locPerLang(e.answer, ctx).map(([lang, text]) => ({
      lang,
      pre: `${indent}${FAQ_LANG_INDENT}${lang}: `,
      text,
    }));
    const text =
      `${qPre}${e.question}\n${indent}${FAQ_A_LABEL}\n` +
      answers.map((a) => `${a.pre}${a.text}`).join("\n");
    return {
      kind: "faq",
      faqId: e.id,
      flowId,
      qPre,
      question: e.question,
      answerHeader: `${indent}${FAQ_A_LABEL}`,
      answers,
      lines: text.split("\n"),
    };
  }
  const answer: FaqAnswer = {
    lang: ctx.lang,
    pre: `${indent}${FAQ_A_PREFIX}`,
    text: resolveLocalized(e.answer, ctx.lang, ctx.defaultLang),
  };
  return {
    kind: "faq",
    faqId: e.id,
    flowId,
    qPre,
    question: e.question,
    answerHeader: null,
    answers: [answer],
    lines: `${qPre}${e.question}\n${answer.pre}${answer.text}`.split("\n"),
  };
}

export function knowledgeBlockParts(spec: Spec, ctx: RenderCtx): BlockPart[] {
  const k = spec.agent.knowledge;
  const parts: BlockPart[] = [];
  if (k?.faq?.length) {
    parts.push({ kind: "plain", lines: ["FAQ:"] });
    for (const e of k.faq) parts.push(faqPart(e, "", ctx));
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

// Script parts for one flow. Pinned language: one part per script, framed
// SCRIPT_PRE…QUOTE, variations via the singleton renderer (it owns the
// variation fallback rules). Multilingual: one part per (script, language
// with content), framed by the renderer's per-language label, variations
// per that language.
function scriptParts(flow: Flow, ctx: RenderCtx): BlockPart[] {
  const parts: BlockPart[] = [];
  for (const s of flow.scripts ?? []) {
    if (ctx.langs) {
      locPerLang(s.text, ctx).forEach(([lang, text], i) => {
        const pre = `${i === 0 ? "  - " : "    "}${lang}: ${QUOTE}`;
        const variationLines = (s.variations?.[lang] ?? [])
          .filter(Boolean)
          .map((v) => `      | ${QUOTE}${escapeQuotes(v)}${QUOTE}`);
        parts.push({
          kind: "script",
          flowId: flow.id,
          scriptId: s.id,
          lang,
          pre,
          post: QUOTE,
          text,
          hasOtherLanguages: false,
          variationLines,
          lines: [
            ...`${pre}${escapeQuotes(text)}${QUOTE}`.split("\n"),
            ...variationLines,
          ],
        });
      });
      continue;
    }
    const single = renderFlowScripts({ ...flow, scripts: [s] }, ctx);
    if (!single) continue; // no text in this language — skipped by the full render too
    const text = resolveLocalized(s.text, ctx.lang, ctx.defaultLang);
    const textLines = `${SCRIPT_PRE}${escapeQuotes(text)}${QUOTE}`.split("\n");
    const present = languagesPresent(s.text, ctx.defaultLang);
    const variationLines = dedentLines(single).slice(1 + textLines.length);
    parts.push({
      kind: "script",
      flowId: flow.id,
      scriptId: s.id,
      lang: ctx.lang,
      pre: SCRIPT_PRE,
      post: QUOTE,
      text,
      hasOtherLanguages: present.some((l) => l !== ctx.lang),
      variationLines,
      lines: [...textLines, ...variationLines],
    });
  }
  return parts;
}

export function flowBlockParts(spec: Spec, flow: Flow, ctx: RenderCtx): BlockPart[] {
  const parts: BlockPart[] = [];
  const isInterrupt = flow.type === "interrupt";

  if (isInterrupt && flow.entry_condition) {
    const expression = flow.entry_condition.expression;
    parts.push({
      kind: "trigger",
      flowId: flow.id,
      expression,
      lines: `${TRIGGER_PREFIX}${expression}`.split("\n"),
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
    parts.push(...scriptParts(flow, ctx));
  }

  // interruptsGroup does not render flow guardrails; flowsGroup does.
  const flowGuardrails = flow.guardrails ?? [];
  if (!isInterrupt && flowGuardrails.length) {
    parts.push({ kind: "plain", lines: [FLOW_GUARDRAILS_HEADER] });
    for (const g of flowGuardrails) {
      parts.push({
        kind: "flowGuardrail",
        flowId: flow.id,
        guardrailId: g.id,
        pre: FLOW_GUARDRAIL_PRE,
        statement: g.statement,
        lines: `${FLOW_GUARDRAIL_PRE}${g.statement}`.split("\n"),
      });
    }
  }

  if (renderFlowKnowledge(flow, ctx)) {
    parts.push({ kind: "plain", lines: [FLOW_FAQ_HEADER] });
    for (const e of flow.knowledge?.faq ?? []) {
      parts.push(faqPart(e, FLOW_FAQ_INDENT, ctx, flow.id));
    }
  }

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
// (runtimeContext, multilingual, templateWrapper — shown verbatim).
export const INLINE_EDITABLE_KINDS: ReadonlySet<PromptSource["kind"]> = new Set([
  "role",
  "guardrails",
  "knowledge",
  "flow",
  "interrupt",
]);

export function blockParts(spec: Spec, source: PromptSource, ctx: RenderCtx): BlockPart[] | null {
  switch (source.kind) {
    case "role":
      return roleBlockParts(spec);
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
