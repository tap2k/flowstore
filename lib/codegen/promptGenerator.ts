import type {
  Spec,
  Flow,
  ExitPath,
  Condition,
  AssignValue,
  FaqEntry,
} from "@/lib/schema/v0";

export function generateSystemPrompt(
  spec: Spec,
  vars?: Record<string, unknown>,
): string {
  const sections = [
    renderRole(spec),
    // renderVariables(spec),     // disabled: variables are substituted before paste
    renderGuardrails(spec),
    renderFlows(spec),
    renderInterrupts(spec),
    renderKnowledge(spec),
    // renderCapabilities(spec),  // disabled: naked prompt has no tools to call
  ].filter(Boolean);

  const rendered = sections.join("\n\n---\n\n").trim() + "\n";
  return vars ? substituteVars(rendered, vars) : rendered;
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

function renderRole(spec: Spec): string {
  const { meta, system_prompt } = spec.agent;
  if (system_prompt && system_prompt.trim()) {
    return system_prompt.trim();
  }
  const lines: string[] = [];
  lines.push(`You are ${meta.name}.`);
  if (meta.purpose) lines.push(meta.purpose);
  if (meta.client) lines.push(`This is on behalf of ${meta.client}.`);
  if (meta.modes?.length) {
    lines.push(`Channel: ${meta.modes.join(", ")}.`);
  }
  return lines.join(" ");
}

function renderVariables(spec: Spec): string {
  const vars = spec.agent.variables ?? {};
  const names = Object.keys(vars);
  if (!names.length) return "";
  const lines = ["VARIABLES (the runtime substitutes these at speak time):"];
  for (const name of names) {
    const decl = vars[name];
    const desc = decl?.description ? ` — ${decl.description}` : "";
    lines.push(`- {${name}}${desc}`);
  }
  return lines.join("\n");
}

function renderGuardrails(spec: Spec): string {
  const items = spec.agent.guardrails ?? [];
  if (!items.length) return "";
  const lines = ["GUARDRAILS (apply at all times):"];
  items.forEach((g, i) => lines.push(`${i + 1}. ${g.statement}`));
  return lines.join("\n");
}

function renderFlows(spec: Spec): string {
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
    if (flow.description) lines.push(`   ${flow.description}`);
    if (flow.instructions?.trim()) {
      lines.push(`   ${flow.instructions.trim().split("\n").join("\n   ")}`);
    }
    const scripts = renderFlowScripts(flow);
    if (scripts) lines.push(scripts);
    const guardrails = renderFlowGuardrails(flow);
    if (guardrails) lines.push(guardrails);
    const routing = renderFlowRoutingInline(flow, flowNames);
    if (routing) lines.push(routing);
    /* disabled: arrow form replaced by inline prose
    const routingArrows = renderFlowRouting(flow);
    if (routingArrows) lines.push(routingArrows);
    */
    /* disabled: runner-enforced budget, not model behavior
    if (flow.max_turns != null) {
      lines.push(`   Retry budget: at most ${flow.max_turns} turns.`);
    }
    */
  });
  return lines.join("\n");
}

function renderFlowRoutingInline(flow: Flow, flowNames: Map<string, string>): string {
  const exits = flow.routing?.exit_paths ?? [];
  if (!exits.length) return "";
  const lines: string[] = [];
  for (const ep of exits) {
    const target = renderInlineTarget(ep, flowNames);
    if (ep.condition) {
      lines.push(`   - If ${renderConditionPlain(ep.condition)}, ${target}.`);
    } else {
      lines.push(`   - Otherwise, ${target}.`);
    }
  }
  return lines.join("\n");
}

function renderInlineTarget(ep: ExitPath, flowNames: Map<string, string>): string {
  if (ep.type === "exit") return "end the conversation";
  if (ep.type === "return_to_caller") return "return to the calling flow";
  if (ep.next_flow_id) {
    const name = flowNames.get(ep.next_flow_id) ?? ep.next_flow_id;
    return `go to ${name}`;
  }
  return "continue";
}

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
    for (const ep of flow.routing?.exit_paths ?? []) {
      if (ep.next_flow_id) visit(ep.next_flow_id);
    }
  }

  visit(entryId);
  for (const f of flows) if (!visited.has(f.id)) ordered.push(f);
  return ordered;
}

function renderFlowScripts(flow: Flow): string {
  const buckets = flow.scripts ?? {};
  const langs = Object.keys(buckets);
  if (!langs.length) return "";
  const lines: string[] = ["   Scripts:"];
  for (const lang of langs) {
    const lines_ = buckets[lang] ?? [];
    if (!lines_.length) continue;
    lines.push(`     ${lang}:`);
    for (const s of lines_) {
      lines.push(`       - [${s.id}] "${escapeQuotes(s.text)}"`);
    }
  }
  return lines.join("\n");
}

function renderFlowGuardrails(flow: Flow): string {
  const items = flow.guardrails ?? [];
  if (!items.length) return "";
  const lines = ["   Flow guardrails:"];
  for (const g of items) lines.push(`     - ${g.statement}`);
  return lines.join("\n");
}

function renderFlowRouting(flow: Flow): string {
  const exits = flow.routing?.exit_paths ?? [];
  if (!exits.length) return "";
  const lines = ["   Routing:"];
  for (const ep of exits) {
    lines.push(`     - ${renderExitPath(ep)}`);
  }
  return lines.join("\n");
}

function renderExitPath(ep: ExitPath): string {
  const trigger = ep.condition ? `when ${renderCondition(ep.condition)}` : "always";
  const target = renderTarget(ep);
  const assigns = renderAssigns(ep.assigns);
  const actions = renderActions(ep.actions);
  const tail = [target, assigns, actions].filter(Boolean).join("; ");
  return `${trigger} → ${tail}`;
}

function renderCondition(c: Condition): string {
  if (c.method === "calculation") return `\`${c.expression}\``;
  if (c.method === "direct") return `(direct: ${c.expression})`;
  return c.expression;
}

function renderTarget(ep: ExitPath): string {
  if (ep.type === "exit") return "end the conversation";
  if (ep.type === "return_to_caller") return "return to the calling flow";
  if (ep.next_flow_id) return `go to "${ep.next_flow_id}" (${ep.type})`;
  return `(${ep.type})`;
}

function renderAssigns(assigns: Record<string, AssignValue> | undefined): string {
  if (!assigns) return "";
  const parts: string[] = [];
  for (const [name, av] of Object.entries(assigns)) {
    if (av.method === "direct") {
      parts.push(`set ${name} = ${JSON.stringify(av.value)}`);
    } else if (av.method === "calculation") {
      parts.push(`set ${name} = \`${av.value}\``);
    } else {
      parts.push(`capture ${name} (${av.value})`);
    }
  }
  return parts.length ? parts.join(", ") : "";
}

function renderActions(actions: ExitPath["actions"]): string {
  if (!actions || !actions.length) return "";
  return `call ${actions.map((a) => a.capability_id).join(", ")}`;
}

function renderInterrupts(spec: Spec): string {
  const interrupts = spec.flows.filter((f) => f.type === "interrupt");
  if (!interrupts.length) return "";
  const flowNames = new Map(spec.flows.map((f) => [f.id, f.name || f.id]));
  const lines = ["INTERRUPTS (fire at any point unless scope says otherwise):"];
  interrupts.forEach((flow, i) => {
    const scope = flow.scope?.length ? flow.scope.join(", ") : "global";
    lines.push(`\n${i + 1}. ${flow.name || flow.id} [scope: ${scope}]`);
    const trigger = flow.routing?.entry_condition;
    if (trigger) {
      lines.push(`   Trigger: ${renderConditionPlain(trigger)}`);
    }
    if (flow.instructions?.trim()) {
      lines.push(`   ${flow.instructions.trim().split("\n").join("\n   ")}`);
    }
    const scripts = renderFlowScripts(flow);
    if (scripts) lines.push(scripts);
    const routing = renderFlowRoutingInline(flow, flowNames);
    if (routing) lines.push(routing);
    /* disabled: arrow form replaced by inline prose
    const routingArrows = renderFlowRouting(flow);
    if (routingArrows) lines.push(routingArrows);
    */
  });
  return lines.join("\n");
}

function renderKnowledge(spec: Spec): string {
  const k = spec.agent.knowledge;
  if (!k) return "";
  const blocks: string[] = [];

  if (k.faq?.length) {
    const lines = ["FAQ:"];
    for (const entry of k.faq) {
      lines.push(formatFaqEntry(entry));
    }
    blocks.push(lines.join("\n"));
  }

  if (k.glossary?.length) {
    const lines = ["GLOSSARY:"];
    for (const g of k.glossary) lines.push(`- ${g.term}: ${g.definition}`);
    blocks.push(lines.join("\n"));
  }

  /* Tables: disabled in naked prompt — tables belong behind a retrieval capability.
  if (k.tables?.length) {
    const lines = ["TABLES:"];
    for (const t of k.tables) {
      lines.push(`\n${t.name} (${t.id}) — ${t.purpose}`);
      const fields = t.structure.map((f) => f.field).join(" | ");
      lines.push(`  ${fields}`);
      for (const row of t.rows) {
        const vals = t.structure.map((f) => String(row[f.field] ?? "")).join(" | ");
        lines.push(`  ${vals}`);
      }
      if (t.scaling_rule) lines.push(`  scaling: ${t.scaling_rule}`);
    }
    blocks.push(lines.join("\n"));
  }
  */

  return blocks.join("\n\n");
}

function formatFaqEntry(entry: FaqEntry): string {
  const lines = [`- Q: ${entry.question}`];
  lines.push(`  A: ${entry.answer}`);
  const scripts = entry.scripts ?? {};
  for (const [lang, text] of Object.entries(scripts)) {
    lines.push(`  Say (${lang}): "${escapeQuotes(text)}"`);
  }
  return lines.join("\n");
}

function renderCapabilities(spec: Spec): string {
  const items = spec.agent.capabilities ?? [];
  if (!items.length) return "";
  const lines = ["CAPABILITIES (external integrations available):"];
  for (const c of items) {
    const ins = c.inputs?.length ? ` ← ${c.inputs.join(", ")}` : "";
    const outs = c.outputs?.length ? ` → ${c.outputs.join(", ")}` : "";
    lines.push(`- ${c.name} [${c.kind}]${ins}${outs}`);
    lines.push(`  ${c.description}`);
  }
  return lines.join("\n");
}

function escapeQuotes(text: string): string {
  return text.replace(/"/g, '\\"');
}
