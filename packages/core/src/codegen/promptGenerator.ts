import type {
  Spec,
  Flow,
  ExitPath,
  Condition,
  FaqEntry,
} from "@flowstore/core/schema/v0";
import {
  isEndGoto,
  isReturnGoto,
  isFlowGoto,
  resolveLocalized,
  defaultLanguage,
} from "@flowstore/core/schema/v0";

// A segment maps a [start, end) range of the compiled text back to the spec
// entity that produced it. `runtimeContext` is derived from variable *values*
// rather than a single editable entity, so consumers treat it as un-linkable.
export type PromptSource =
  | { kind: "role" }
  | { kind: "runtimeContext" }
  | { kind: "guardrails" }
  | { kind: "flow"; flowId: string; name: string }
  | { kind: "interrupt"; flowId: string; name: string }
  | { kind: "knowledge" };

export interface PromptSegment {
  start: number; // inclusive offset into text
  end: number; // exclusive
  source: PromptSource;
}

export interface CompiledPrompt {
  text: string;
  segments: PromptSegment[];
}

const SECTION_SEP = "\n\n---\n\n";
const BLOCK_SEP = "\n\n";

// Capabilities are intentionally not rendered here. The naked prompt has no
// tools to call; when tool-use is wired in, capabilities should be passed as a
// structured tool schema to the model API, not described in prose.
//
// Compiles the system prompt together with parallel source segments.
// Substitution happens per-block *before* offsets are recorded, so a {var}
// whose value differs in length from its placeholder cannot shift the offsets
// of later segments. `text` is byte-for-byte identical to the legacy
// concatenation, so generateSystemPrompt is a thin wrapper over it.
export function compileSystemPrompt(
  spec: Spec,
  vars?: Record<string, unknown>,
  opts?: { language?: string },
): CompiledPrompt {
  const defaultLang = defaultLanguage(spec.agent.meta.languages);
  const lang = opts?.language ?? defaultLang;
  const ctx: RenderCtx = { lang, defaultLang };
  const sub = (t: string) => (vars ? substituteVars(t, vars) : t);

  type Group =
    | { type: "single"; source: PromptSource; text: string }
    | { type: "multi"; leadText: string; items: { source: PromptSource; text: string }[] };

  const groups: Group[] = [];
  const pushSingle = (source: PromptSource, text: string) => {
    if (text) groups.push({ type: "single", source, text });
  };

  pushSingle({ kind: "role" }, renderRole(spec));
  pushSingle({ kind: "runtimeContext" }, renderRuntimeContext(spec, vars));
  pushSingle({ kind: "guardrails" }, renderGuardrails(spec));

  const fg = flowsGroup(spec, ctx);
  if (fg) {
    groups.push({
      type: "multi",
      leadText: fg.leadText,
      items: fg.items.map((it) => ({
        source: { kind: "flow", flowId: it.flowId, name: it.name },
        text: it.text,
      })),
    });
  }

  const ig = interruptsGroup(spec, ctx);
  if (ig) {
    groups.push({
      type: "multi",
      leadText: ig.leadText,
      items: ig.items.map((it) => ({
        source: { kind: "interrupt", flowId: it.flowId, name: it.name },
        text: it.text,
      })),
    });
  }

  pushSingle({ kind: "knowledge" }, renderKnowledge(spec, ctx));

  // Assemble, recording a segment per block. Top-level groups are joined by
  // SECTION_SEP; the per-flow/per-interrupt blocks inside a multi group are
  // joined by BLOCK_SEP, and the group's lead text (e.g. "FLOW OF CALL: …")
  // folds into the first block's segment. Separators are not part of any
  // segment.
  let body = "";
  const segments: PromptSegment[] = [];
  groups.forEach((g, gi) => {
    if (gi > 0) body += SECTION_SEP;
    if (g.type === "single") {
      const start = body.length;
      body += sub(g.text);
      segments.push({ start, end: body.length, source: g.source });
    } else {
      const lead = sub(g.leadText);
      g.items.forEach((item, ii) => {
        if (ii > 0) body += BLOCK_SEP;
        const start = body.length;
        if (ii === 0 && lead) body += lead + BLOCK_SEP;
        body += sub(item.text);
        segments.push({ start, end: body.length, source: item.source });
      });
    }
  });

  // Legacy parity: the old generator trimmed the joined body and appended a
  // trailing newline. Renderers emit no leading/trailing whitespace, so the
  // trim is a no-op on offsets; clamp ends defensively in case a spec changes.
  const text = body.trim() + "\n";
  const clamped = segments
    .map((s) => ({ ...s, end: Math.min(s.end, text.length) }))
    .filter((s) => s.end > s.start);

  return { text, segments: clamped };
}

export function generateSystemPrompt(
  spec: Spec,
  vars?: Record<string, unknown>,
  opts?: { language?: string },
): string {
  return compileSystemPrompt(spec, vars, opts).text;
}

interface RenderCtx {
  lang: string;
  defaultLang: string;
}

function loc(value: string | Record<string, string> | undefined, ctx: RenderCtx): string {
  return resolveLocalized(value, ctx.lang, ctx.defaultLang);
}

// Replaces `{name}` placeholders with values from `vars`. Unknown placeholders
// are left as-is; null/undefined values leave the placeholder so the author
// can spot a missing var instead of getting silent ""s in the prompt.
export function substituteVars(text: string, vars: Record<string, unknown>): string {
  let out = text;
  for (const [name, value] of Object.entries(vars)) {
    if (value === null || value === undefined) continue;
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

// Emits the current value of every declared agent.variables[name] that has
// a non-empty bound value in `vars`. Without this, instructions like
// "If broken_ptp is true, open by ..." render with the literal var name and
// the LLM has no way to evaluate the gate. Same for date anchors like
// {now}/{day} that flow.instructions never explicitly reference but expect
// to be available at routing time.
function renderRuntimeContext(spec: Spec, vars?: Record<string, unknown>): string {
  if (!vars) return "";
  const declared = spec.agent.variables ?? {};
  const lines: string[] = [];
  for (const name of Object.keys(declared)) {
    const value = vars[name];
    if (value === null || value === undefined || value === "") continue;
    lines.push(`- ${name} = ${JSON.stringify(value)}`);
  }
  if (!lines.length) return "";
  return ["RUNTIME CONTEXT (current values of agent variables — use these to evaluate any conditional instructions and any date arithmetic):", ...lines].join("\n");
}

function renderRole(spec: Spec): string {
  const { meta } = spec.agent;
  const lines: string[] = [];
  lines.push(`You are ${meta.name}.`);
  if (meta.purpose) lines.push(meta.purpose);
  if (meta.client) lines.push(`This is on behalf of ${meta.client}.`);
  if (meta.tone) lines.push(`Tone: ${meta.tone}`);
  return lines.join(" ");
}

function renderGuardrails(spec: Spec): string {
  const items = spec.agent.guardrails ?? [];
  if (!items.length) return "";
  const lines = ["GUARDRAILS (apply at all times):"];
  items.forEach((g, i) => lines.push(`${i + 1}. ${g.statement}`));
  return lines.join("\n");
}

interface RenderedBlock {
  flowId: string;
  name: string;
  text: string;
}

// Returns the "FLOW OF CALL:" lead text plus one block per conversational
// flow, in routing order. compileSystemPrompt joins them with BLOCK_SEP, which
// reproduces the legacy single-string output byte-for-byte.
function flowsGroup(
  spec: Spec,
  ctx: RenderCtx,
): { leadText: string; items: RenderedBlock[] } | null {
  const entry = spec.agent.entry_flow_id;
  const conversational = spec.flows.filter((f) => f.type !== "interrupt" && f.type !== "utility");
  if (!conversational.length) return null;

  const ordered = orderFlows(conversational, entry);
  const flowNames = new Map(ordered.map((f) => [f.id, f.name || f.id]));
  const leadLines = ["FLOW OF CALL:"];
  if (entry && flowNames.has(entry)) {
    leadLines.push(`Begin with: ${flowNames.get(entry)}.`);
  }

  const items = ordered.map((flow, i) => {
    const lines = [`${i + 1}. ${flow.name || flow.id}${flow.id === entry ? " (entry)" : ""}`];
    const instructions = flow.instructions ?? "";
    if (instructions.trim()) {
      lines.push(`   ${instructions.trim().split("\n").join("\n   ")}`);
    }
    const scripts = renderFlowScripts(flow, ctx);
    if (scripts) lines.push(scripts);
    const guardrails = renderFlowGuardrails(flow);
    if (guardrails) lines.push(guardrails);
    const knowledge = renderFlowKnowledge(flow, ctx);
    if (knowledge) lines.push(knowledge);
    const routing = renderFlowRoutingInline(flow, flowNames);
    if (routing) lines.push(routing);
    return { flowId: flow.id, name: flow.name || flow.id, text: lines.join("\n") };
  });

  return { leadText: leadLines.join("\n"), items };
}

function renderFlowRoutingInline(flow: Flow, flowNames: Map<string, string>): string {
  const exits = flow.exit_paths ?? [];
  if (!exits.length) return "";
  const lines: string[] = [];
  for (const ep of exits) {
    const target = renderInlineTarget(ep, flowNames);
    if (ep.max_turns !== undefined) {
      // Turn-budget escape. The runtime dispatcher counts agent turns per flow
      // frame and fires this deterministically — the agent cannot reliably
      // self-count, so we attribute it to the runtime rather than phrasing it
      // as an instruction the model should execute (matches the Python
      // prompt_builder, which hides max_turns from the LLM entirely). It is
      // rendered at all only so this human-facing artifact (preview / export)
      // documents that the budget exists. Crucially, do NOT fall through to
      // the "Otherwise" branch — a budget exit has no condition because it is
      // turn-gated, not because it is a catch-all, and rendering it as an
      // unconditional fallback inverts its meaning.
      const t = ep.max_turns === 1 ? "turn" : "turns";
      lines.push(
        `   - Turn-budget escape (runtime-enforced): if no other exit fires within ${ep.max_turns} ${t} in this flow, ${target}.`,
      );
    } else if (ep.condition) {
      lines.push(`   - ${renderConditionClause(ep.condition)}, ${target}.`);
    } else {
      lines.push(`   - Otherwise, ${target}.`);
    }
  }
  return lines.join("\n");
}

function renderInlineTarget(ep: ExitPath, flowNames: Map<string, string>): string {
  if (isEndGoto(ep.goto)) return "end the conversation";
  if (isReturnGoto(ep.goto)) return "return to the calling flow";
  const name = flowNames.get(ep.goto) ?? ep.goto;
  return `go to ${name}`;
}

// Routing clause: prefixes the expression with a frame so deterministic
// methods read as conditions rather than free-floating prose. The verbatim
// expression is preserved (no translation drift) — modern LLMs read the
// Python-like grammar fine.
function renderConditionClause(c: Condition): string {
  if (c.method === "llm") return `If ${c.expression}`;
  return `When \`${c.expression}\` holds`;
}

// Interrupt triggers are author-natural-language regardless of method label.
function renderConditionPlain(c: Condition): string {
  return c.expression;
}

function orderFlows(flows: Flow[], entryId: string | undefined): Flow[] {
  if (!entryId) return flows;
  const byId = new Map(flows.map((f) => [f.id, f]));
  const visited = new Set<string>();
  const ordered: Flow[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    const flow = byId.get(id);
    if (!flow) return;
    visited.add(id);
    ordered.push(flow);
    for (const ep of flow.exit_paths ?? []) {
      if (isFlowGoto(ep.goto)) visit(ep.goto);
    }
  }

  visit(entryId);
  for (const f of flows) if (!visited.has(f.id)) ordered.push(f);
  return ordered;
}

function renderFlowScripts(flow: Flow, ctx: RenderCtx): string {
  const scripts = flow.scripts ?? [];
  if (!scripts.length) return "";
  const lines: string[] = ["   Scripts:"];
  for (const s of scripts) {
    const text = loc(s.text, ctx);
    if (!text) continue;
    lines.push(`     - "${escapeQuotes(text)}"`);
    const variations = s.variations?.[ctx.lang] ?? s.variations?.[ctx.defaultLang] ?? [];
    for (const v of variations.filter(Boolean)) {
      lines.push(`       | "${escapeQuotes(v)}"`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function renderFlowGuardrails(flow: Flow): string {
  const items = flow.guardrails ?? [];
  if (!items.length) return "";
  const lines = ["   Flow guardrails:"];
  for (const g of items) lines.push(`     - ${g.statement}`);
  return lines.join("\n");
}

function renderFlowKnowledge(flow: Flow, ctx: RenderCtx): string {
  const faq = flow.knowledge?.faq ?? [];
  if (!faq.length) return "";
  const lines = ["   FAQ:"];
  for (const entry of faq) lines.push(formatFaqEntry(entry, "     ", ctx));
  return lines.join("\n");
}

function interruptsGroup(
  spec: Spec,
  ctx: RenderCtx,
): { leadText: string; items: RenderedBlock[] } | null {
  const interrupts = spec.flows.filter((f) => f.type === "interrupt");
  if (!interrupts.length) return null;
  const flowNames = new Map(spec.flows.map((f) => [f.id, f.name || f.id]));

  const items = interrupts.map((flow, i) => {
    const lines = [`${i + 1}. ${flow.name || flow.id}`];
    const trigger = flow.entry_condition;
    if (trigger) {
      lines.push(`   Trigger: ${renderConditionPlain(trigger)}`);
    }
    const instructions = flow.instructions ?? "";
    if (instructions.trim()) {
      lines.push(`   ${instructions.trim().split("\n").join("\n   ")}`);
    }
    const scripts = renderFlowScripts(flow, ctx);
    if (scripts) lines.push(scripts);
    const knowledge = renderFlowKnowledge(flow, ctx);
    if (knowledge) lines.push(knowledge);
    const routing = renderFlowRoutingInline(flow, flowNames);
    if (routing) lines.push(routing);
    return { flowId: flow.id, name: flow.name || flow.id, text: lines.join("\n") };
  });

  return { leadText: "INTERRUPTS (fire at any point):", items };
}

function renderKnowledge(spec: Spec, ctx: RenderCtx): string {
  const k = spec.agent.knowledge;
  if (!k) return "";
  const blocks: string[] = [];

  if (k.faq?.length) {
    const lines = ["FAQ:"];
    for (const entry of k.faq) {
      lines.push(formatFaqEntry(entry, "", ctx));
    }
    blocks.push(lines.join("\n"));
  }

  if (k.glossary?.length) {
    const lines = ["GLOSSARY:"];
    for (const g of k.glossary) lines.push(`- ${g.term}: ${g.definition}`);
    blocks.push(lines.join("\n"));
  }

  // Tables are intentionally not inlined — they belong behind a retrieval
  // capability. Inlining bloats the prompt and the row format would likely
  // need re-authoring if revived.

  return blocks.join("\n\n");
}

function formatFaqEntry(entry: FaqEntry, indent: string, ctx: RenderCtx): string {
  return `${indent}- Q: ${entry.question}\n${indent}  A: ${loc(entry.answer, ctx)}`;
}

function escapeQuotes(text: string): string {
  return text.replace(/"/g, '\\"');
}
