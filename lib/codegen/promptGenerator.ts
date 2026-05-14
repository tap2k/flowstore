import type {
  Spec,
  Flow,
  ExitPath,
  Condition,
  FaqEntry,
} from "@/lib/schema/v0";
import {
  isEndGoto,
  isReturnGoto,
  isFlowGoto,
  resolveLocalized,
  defaultLanguage,
} from "@/lib/schema/v0";

// Capabilities are intentionally not rendered here. The naked prompt has no
// tools to call; when tool-use is wired in, capabilities should be passed as a
// structured tool schema to the model API, not described in prose.
export function generateSystemPrompt(
  spec: Spec,
  vars?: Record<string, unknown>,
  opts?: { language?: string },
): string {
  const defaultLang = defaultLanguage(spec.agent.meta.languages);
  const lang = opts?.language ?? defaultLang;
  const ctx = { lang, defaultLang };
  const sections = [
    renderRole(spec, ctx),
    renderGuardrails(spec, ctx),
    renderFlows(spec, ctx),
    renderInterrupts(spec, ctx),
    renderKnowledge(spec, ctx),
  ].filter(Boolean);

  const rendered = sections.join("\n\n---\n\n").trim() + "\n";
  return vars ? substituteVars(rendered, vars) : rendered;
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

function renderRole(spec: Spec, ctx: RenderCtx): string {
  const { meta, system_prompt } = spec.agent;
  if (system_prompt && system_prompt.trim()) return system_prompt.trim();
  const lines: string[] = [];
  lines.push(`You are ${meta.name}.`);
  if (meta.purpose) lines.push(meta.purpose);
  if (meta.client) lines.push(`This is on behalf of ${meta.client}.`);
  if (meta.modes?.length) {
    lines.push(`Channel: ${meta.modes.join(", ")}.`);
  }
  return lines.join(" ");
}

function renderGuardrails(spec: Spec, ctx: RenderCtx): string {
  const items = spec.agent.guardrails ?? [];
  if (!items.length) return "";
  const lines = ["GUARDRAILS (apply at all times):"];
  items.forEach((g, i) => lines.push(`${i + 1}. ${g.statement}`));
  return lines.join("\n");
}

function renderFlows(spec: Spec, ctx: RenderCtx): string {
  const entry = spec.agent.entry_flow_id;
  const conversational = spec.flows.filter((f) => f.type !== "interrupt" && f.type !== "utility");
  if (!conversational.length) return "";

  const ordered = orderFlows(conversational, entry);
  const flowNames = new Map(ordered.map((f) => [f.id, f.name || f.id]));
  const lines = ["FLOW OF CALL:"];
  if (entry && flowNames.has(entry)) {
    lines.push(`Begin with: ${flowNames.get(entry)}.`);
  }
  ordered.forEach((flow, i) => {
    lines.push(`\n${i + 1}. ${flow.name || flow.id}${flow.id === entry ? " (entry)" : ""}`);
    const instructions = flow.instructions ?? "";
    if (instructions.trim()) {
      lines.push(`   ${instructions.trim().split("\n").join("\n   ")}`);
    }
    const scripts = renderFlowScripts(flow, ctx);
    if (scripts) lines.push(scripts);
    const guardrails = renderFlowGuardrails(flow, ctx);
    if (guardrails) lines.push(guardrails);
    const knowledge = renderFlowKnowledge(flow, ctx);
    if (knowledge) lines.push(knowledge);
    const routing = renderFlowRoutingInline(flow, flowNames);
    if (routing) lines.push(routing);
  });
  return lines.join("\n");
}

function renderFlowRoutingInline(flow: Flow, flowNames: Map<string, string>): string {
  const exits = flow.exit_paths ?? [];
  if (!exits.length) return "";
  const lines: string[] = [];
  for (const ep of exits) {
    const target = renderInlineTarget(ep, flowNames);
    if (ep.condition) {
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
    lines.push(`     - [${s.id}] "${escapeQuotes(text)}"`);
    const variations = s.variations?.[ctx.lang] ?? s.variations?.[ctx.defaultLang] ?? [];
    for (const v of variations.filter(Boolean)) {
      lines.push(`       | "${escapeQuotes(v)}"`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function renderFlowGuardrails(flow: Flow, ctx: RenderCtx): string {
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

function renderInterrupts(spec: Spec, ctx: RenderCtx): string {
  const interrupts = spec.flows.filter((f) => f.type === "interrupt");
  if (!interrupts.length) return "";
  const flowNames = new Map(spec.flows.map((f) => [f.id, f.name || f.id]));
  const lines = ["INTERRUPTS (fire at any point):"];
  interrupts.forEach((flow, i) => {
    lines.push(`\n${i + 1}. ${flow.name || flow.id}`);
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
  });
  return lines.join("\n");
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
