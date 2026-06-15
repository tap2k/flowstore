// Spec-level structural diff.
//
// Why this exists: a raw `git diff` of the decomposed JSON is low-signal here.
// References are by id (`goto: "flow_a1b2"`, `entry_flow_id`, capability ids),
// so a textual diff shows opaque ids rather than the names a human — or the
// chat co-author — reasons about. This module reconstructs the change at the
// spec level: which flows / exit paths / guardrails / variables were added,
// removed, or changed, with ids resolved to names and bulky text fields
// collapsed to a character delta instead of dumped verbatim.
//
// The output is consumed two ways:
//   - renderSpecDiff() → compact text for the chat LLM context (id-resolved,
//     bounded; never the SpecDiff JSON itself).
//   - the SpecDiff object directly → a future "Changes" UI panel.

import type {
  Agent,
  Capability,
  Condition,
  ExitPath,
  Flow,
  Guardrail,
  Spec,
  VariableDecl,
} from "../schema/v0";
import { isEndGoto, isReturnGoto } from "../schema/v0";

// ── Public types ────────────────────────────────────────────────────────────

export type ChangeKind = "added" | "removed" | "changed";

export type EntityType =
  | "agent"
  | "flow"
  | "exit_path"
  | "guardrail"
  | "variable"
  | "capability"
  | "business_goal"
  | "faq"
  | "glossary"
  | "table";

// An id paired with its human name, resolved at diff time so neither the
// renderer nor the LLM ever sees a bare "flow_a1b2". For name-keyed entities
// (variables) id === name.
export interface RefLabel {
  id: string;
  name: string;
}

// One changed field on one entity. Long-text fields carry a `charDelta` (and,
// only when opted in, bounded snippets) rather than full before/after — that's
// the lever that keeps the chat payload small.
export type FieldChange =
  | { field: string; kind: "scalar"; from: unknown; to: unknown }
  | { field: string; kind: "text"; charDelta: number; fromSnippet?: string; toSnippet?: string }
  | { field: string; kind: "collection"; added: number; removed: number; changed: number };

export interface EntityDiff {
  kind: ChangeKind;
  entity: EntityType;
  ref: RefLabel;
  // Owning entity for nested diffs (the flow that owns an exit_path / scoped
  // guardrail / scoped variable). Absent for top-level entities.
  parent?: RefLabel;
  // Short human descriptor used when rendering added/removed entities (and as
  // a headline for changed ones), e.g. "(subflow)" for a flow or
  // "when intent == \"refund\"" for an exit path.
  summary?: string;
  // Present only when kind === "changed".
  fields?: FieldChange[];
  // Nested entity diffs: a changed flow nests its exit_path / scoped diffs; a
  // changed agent nests its guardrail / capability / knowledge / variable diffs.
  children?: EntityDiff[];
}

export type ChangeCount = { added: number; removed: number; changed: number };

export interface SpecDiff {
  // Stamps identifying what was compared, so a consumer never reasons on a
  // stale diff. Omit `headSha` to denote "vs the in-memory working copy".
  baseSha?: string;
  headSha?: string;
  agent: EntityDiff | null; // null when the agent envelope is untouched
  flows: EntityDiff[];
  // Tally per entity type, summed over the whole diff tree (a changed flow's
  // exit_paths count under `exit_path`, etc.). Absent keys mean zero changes
  // of that type. Consumers (render header, a UI panel) read what they need.
  counts: Partial<Record<EntityType, ChangeCount>>;
  empty: boolean; // true ⇒ nothing changed (cheap early-out for the status line)
}

export interface DiffOptions {
  // Include short text snippets for changed long-text fields. Default false
  // (delta only) to keep the chat payload small; the UI can pass true.
  textSnippets?: boolean;
  // Max chars per snippet when enabled.
  snippetChars?: number;
  // SHA stamps to copy onto the result (purely informational).
  baseSha?: string;
  headSha?: string;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function diffSpecs(base: Spec, head: Spec, opts: DiffOptions = {}): SpecDiff {
  const names = buildFlowNames(base, head);
  const ctx: Ctx = {
    names,
    snippets: opts.textSnippets ?? false,
    snippetChars: opts.snippetChars ?? 120,
  };

  const agent = diffAgent(base.agent, head.agent, ctx);
  const flows = diffFlows(base.flows, head.flows, ctx);

  const empty = agent === null && flows.length === 0;
  const counts = countByEntity([...(agent ? [agent] : []), ...flows]);

  return { baseSha: opts.baseSha, headSha: opts.headSha, agent, flows, counts, empty };
}

// ── Internals ────────────────────────────────────────────────────────────────

interface Ctx {
  names: Map<string, string>; // flow id → name (union of base + head)
  snippets: boolean;
  snippetChars: number;
}

function buildFlowNames(base: Spec, head: Spec): Map<string, string> {
  const m = new Map<string, string>();
  // head wins on name (it's the newer truth); base fills in deleted flows.
  for (const f of base.flows) m.set(f.id, f.name);
  for (const f of head.flows) m.set(f.id, f.name);
  return m;
}

function gotoLabel(goto: string, names: Map<string, string>): string {
  if (isEndGoto(goto)) return "END";
  if (isReturnGoto(goto)) return "RETURN";
  return names.get(goto) ?? goto;
}

// ── Agent ────────────────────────────────────────────────────────────────────

function diffAgent(base: Agent, head: Agent, ctx: Ctx): EntityDiff | null {
  const fields: FieldChange[] = [];

  pushScalar(fields, "name", base.name, head.name);
  pushScalar(fields, "identity", base.meta?.identity, head.meta?.identity);
  pushScalar(fields, "purpose", base.meta?.purpose, head.meta?.purpose);
  pushScalar(fields, "tone", base.meta?.tone, head.meta?.tone);
  pushScalar(fields, "modality", base.meta?.modality, head.meta?.modality);
  pushScalar(fields, "languages", joinArr(base.meta?.languages), joinArr(head.meta?.languages));
  pushScalar(fields, "chatbot_initiates", base.chatbot_initiates, head.chatbot_initiates);
  pushRef(fields, "entry_flow_id", base.entry_flow_id, head.entry_flow_id, ctx.names);
  pushText(fields, "system_prompt", base.system_prompt, head.system_prompt, ctx);
  pushText(fields, "notes", base.notes, head.notes, ctx);

  const children: EntityDiff[] = [
    ...diffIdCollection("guardrail", base.guardrails, head.guardrails, guardrailLabel, undefined, ctx),
    ...diffIdCollection("capability", base.capabilities, head.capabilities, (c: Capability) => c.name, undefined, ctx),
    ...diffIdCollection("business_goal", base.business_goals, head.business_goals, (g) => g.name, undefined, ctx),
    ...diffIdCollection("faq", base.knowledge?.faq, head.knowledge?.faq, (e) => truncate(e.question, 60), undefined, ctx),
    ...diffIdCollection("glossary", base.knowledge?.glossary, head.knowledge?.glossary, (e) => e.term, undefined, ctx),
    ...diffIdCollection("table", base.knowledge?.tables, head.knowledge?.tables, (t) => t.name, undefined, ctx),
    ...diffVariables(base.variables, head.variables, undefined, ctx),
  ];

  if (fields.length === 0 && children.length === 0) return null;
  return {
    kind: "changed",
    entity: "agent",
    ref: { id: head.id, name: head.name ?? head.id },
    fields: fields.length > 0 ? fields : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

// ── Flows ────────────────────────────────────────────────────────────────────

function diffFlows(base: Flow[], head: Flow[], ctx: Ctx): EntityDiff[] {
  const baseById = new Map(base.map((f) => [f.id, f]));
  const headById = new Map(head.map((f) => [f.id, f]));
  const out: EntityDiff[] = [];

  for (const f of head) {
    if (!baseById.has(f.id)) {
      out.push({
        kind: "added",
        entity: "flow",
        ref: { id: f.id, name: f.name },
        summary: `(${f.type})`,
      });
    }
  }
  for (const f of base) {
    if (!headById.has(f.id)) {
      // Note which exit paths elsewhere pointed at this flow — they'll show as
      // repointed under their own flows, but flagging it here makes the
      // cross-file nature of a deletion legible.
      out.push({
        kind: "removed",
        entity: "flow",
        ref: { id: f.id, name: f.name },
        summary: `(${f.type})`,
      });
    }
  }
  for (const h of head) {
    const b = baseById.get(h.id);
    if (!b) continue;
    const d = diffFlow(b, h, ctx);
    if (d) out.push(d);
  }
  return out;
}

function diffFlow(base: Flow, head: Flow, ctx: Ctx): EntityDiff | null {
  const fields: FieldChange[] = [];
  pushScalar(fields, "name", base.name, head.name);
  pushScalar(fields, "type", base.type, head.type);
  pushText(fields, "instructions", base.instructions, head.instructions, ctx);
  pushText(fields, "example", base.example, head.example, ctx);
  pushText(fields, "notes", base.notes, head.notes, ctx);
  pushScalar(fields, "entry_condition", conditionStr(base.entry_condition), conditionStr(head.entry_condition));
  pushScalar(fields, "retrieve_on_turn", joinArr(base.retrieve_on_turn), joinArr(head.retrieve_on_turn));
  pushScalar(fields, "tools", joinArr(base.tools), joinArr(head.tools));
  pushCollection(fields, "scripts", countList(base.scripts, head.scripts, (s) => s.id));

  const parent: RefLabel = { id: head.id, name: head.name };
  const children: EntityDiff[] = [
    ...diffExitPaths(base.exit_paths, head.exit_paths, parent, ctx),
    ...diffIdCollection("guardrail", base.guardrails, head.guardrails, guardrailLabel, parent, ctx),
    ...diffIdCollection("faq", base.knowledge?.faq, head.knowledge?.faq, (e) => truncate(e.question, 60), parent, ctx),
    ...diffVariables(base.variables, head.variables, parent, ctx),
  ];

  if (fields.length === 0 && children.length === 0) return null;
  return {
    kind: "changed",
    entity: "flow",
    ref: parent,
    fields: fields.length > 0 ? fields : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

function diffExitPaths(
  base: ExitPath[],
  head: ExitPath[],
  parent: RefLabel,
  ctx: Ctx,
): EntityDiff[] {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const headById = new Map(head.map((x) => [x.id, x]));
  const out: EntityDiff[] = [];

  for (const x of head) {
    if (!baseById.has(x.id)) out.push(exitPathNode("added", x, parent, ctx));
  }
  for (const x of base) {
    if (!headById.has(x.id)) out.push(exitPathNode("removed", x, parent, ctx));
  }
  for (const h of head) {
    const b = baseById.get(h.id);
    if (!b) continue;
    const fields: FieldChange[] = [];
    pushRef(fields, "goto", b.goto, h.goto, ctx.names);
    pushScalar(fields, "condition", conditionStr(b.condition), conditionStr(h.condition));
    pushScalar(fields, "max_turns", b.max_turns, h.max_turns);
    pushText(fields, "notes", b.notes, h.notes, ctx);
    pushScalar(fields, "assigns", assignsStr(b.assigns), assignsStr(h.assigns));
    pushScalar(fields, "actions", actionsStr(b.actions), actionsStr(h.actions));
    if (fields.length === 0) continue;
    out.push({
      kind: "changed",
      entity: "exit_path",
      ref: { id: h.id, name: gotoLabel(h.goto, ctx.names) },
      parent,
      fields,
    });
  }
  return out;
}

function exitPathNode(kind: ChangeKind, x: ExitPath, parent: RefLabel, ctx: Ctx): EntityDiff {
  return {
    kind,
    entity: "exit_path",
    ref: { id: x.id, name: gotoLabel(x.goto, ctx.names) },
    parent,
    summary: exitGuard(x),
  };
}

// Short guard descriptor for an exit path: condition, turn-budget, or
// "always" when unconditional.
function exitGuard(x: ExitPath): string {
  if (x.condition) return `when ${truncate(x.condition.expression, 60)}`;
  if (x.max_turns != null) return `after ${x.max_turns} turns`;
  return "always";
}

// ── id-keyed collections (guardrails, capabilities, knowledge, …) ────────────

function diffIdCollection<E extends { id: string }>(
  entity: EntityType,
  base: E[] | undefined,
  head: E[] | undefined,
  label: (e: E) => string,
  parent: RefLabel | undefined,
  ctx: Ctx,
): EntityDiff[] {
  const b = base ?? [];
  const h = head ?? [];
  const baseById = new Map(b.map((e) => [e.id, e]));
  const headById = new Map(h.map((e) => [e.id, e]));
  const out: EntityDiff[] = [];

  for (const e of h) {
    if (!baseById.has(e.id)) {
      out.push({ kind: "added", entity, ref: { id: e.id, name: label(e) }, parent });
    }
  }
  for (const e of b) {
    if (!headById.has(e.id)) {
      out.push({ kind: "removed", entity, ref: { id: e.id, name: label(e) }, parent });
    }
  }
  for (const he of h) {
    const be = baseById.get(he.id);
    if (!be) continue;
    if (!deepEqual(be, he)) {
      out.push({
        kind: "changed",
        entity,
        ref: { id: he.id, name: label(he) },
        parent,
        summary: changedFieldNames(be, he),
      });
    }
  }
  return out;
}

// Variables are name-keyed (Record<name, decl>), not id-keyed — so a rename
// reads as remove+add. We pair an add with a remove whose declaration bodies
// match and re-label it as a rename, which is the common real edit.
function diffVariables(
  base: Record<string, VariableDecl> | undefined,
  head: Record<string, VariableDecl> | undefined,
  parent: RefLabel | undefined,
  ctx: Ctx,
): EntityDiff[] {
  void ctx;
  const b = base ?? {};
  const h = head ?? {};
  const added: string[] = [];
  const removed: string[] = [];
  const out: EntityDiff[] = [];

  for (const name of Object.keys(h)) {
    if (!(name in b)) added.push(name);
    else if (!deepEqual(b[name], h[name])) {
      out.push({
        kind: "changed",
        entity: "variable",
        ref: { id: name, name },
        parent,
        summary: changedFieldNames(b[name], h[name]),
      });
    }
  }
  for (const name of Object.keys(b)) {
    if (!(name in h)) removed.push(name);
  }

  // Pair body-identical add/remove as a rename.
  for (const a of [...added]) {
    const match = removed.find((r) => deepEqual(b[r], h[a]));
    if (match) {
      out.push({
        kind: "changed",
        entity: "variable",
        ref: { id: a, name: a },
        parent,
        summary: `renamed from "${match}"`,
      });
      added.splice(added.indexOf(a), 1);
      removed.splice(removed.indexOf(match), 1);
    }
  }
  for (const name of added) out.push({ kind: "added", entity: "variable", ref: { id: name, name }, parent });
  for (const name of removed) out.push({ kind: "removed", entity: "variable", ref: { id: name, name }, parent });
  return out;
}

// ── Field-change helpers ─────────────────────────────────────────────────────

function pushScalar(out: FieldChange[], field: string, a: unknown, b: unknown): void {
  if (!Object.is(a ?? null, b ?? null)) out.push({ field, kind: "scalar", from: a, to: b });
}

function pushRef(out: FieldChange[], field: string, a: string | undefined, b: string | undefined, names: Map<string, string>): void {
  if ((a ?? "") === (b ?? "")) return;
  out.push({ field, kind: "scalar", from: a ? gotoLabel(a, names) : a, to: b ? gotoLabel(b, names) : b });
}

function pushText(out: FieldChange[], field: string, a: string | undefined, b: string | undefined, ctx: Ctx): void {
  const av = a ?? "";
  const bv = b ?? "";
  if (av === bv) return;
  const change: FieldChange = { field, kind: "text", charDelta: bv.length - av.length };
  if (ctx.snippets) {
    if (av) change.fromSnippet = truncate(av, ctx.snippetChars);
    if (bv) change.toSnippet = truncate(bv, ctx.snippetChars);
  }
  out.push(change);
}

function pushCollection(out: FieldChange[], field: string, c: ChangeCount): void {
  if (c.added === 0 && c.removed === 0 && c.changed === 0) return;
  out.push({ field, kind: "collection", ...c });
}

// ── Small value helpers ──────────────────────────────────────────────────────

function conditionStr(c: Condition | undefined): string | undefined {
  if (!c) return undefined;
  return `${c.expression} (${c.method})`;
}

function assignsStr(a: Record<string, unknown> | undefined): string | undefined {
  if (!a) return undefined;
  const keys = Object.keys(a);
  return keys.length > 0 ? keys.sort().join(",") : undefined;
}

function actionsStr(a: ReadonlyArray<{ capability_id: string }> | undefined): string | undefined {
  if (!a || a.length === 0) return undefined;
  return a.map((x) => x.capability_id).join(",");
}

function joinArr(a: string[] | undefined): string | undefined {
  if (!a || a.length === 0) return undefined;
  return a.join(",");
}

function guardrailLabel(g: Guardrail): string {
  return truncate(g.statement, 60);
}

function countList<E>(a: E[] | undefined, b: E[] | undefined, key: (e: E) => string): ChangeCount {
  return countById(a ?? [], b ?? [], key);
}

function countById<E>(base: E[], head: E[], key: (e: E) => string): ChangeCount {
  const baseKeys = new Set(base.map(key));
  const headKeys = new Set(head.map(key));
  const baseByKey = new Map(base.map((e) => [key(e), e]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const e of head) {
    const k = key(e);
    if (!baseKeys.has(k)) added++;
    else if (!deepEqual(baseByKey.get(k), e)) changed++;
  }
  for (const e of base) if (!headKeys.has(key(e))) removed++;
  return { added, removed, changed };
}

// Walk the diff tree (entities + their nested children) and tally by entity
// type. One pass, no entity-string filtering scattered at the call site.
function countByEntity(roots: EntityDiff[]): Partial<Record<EntityType, ChangeCount>> {
  const counts: Partial<Record<EntityType, ChangeCount>> = {};
  const visit = (d: EntityDiff): void => {
    const c = (counts[d.entity] ??= { added: 0, removed: 0, changed: 0 });
    c[d.kind]++;
    d.children?.forEach(visit);
  };
  roots.forEach(visit);
  return counts;
}

// Comma-joined names of the top-level fields that differ between two objects.
// Used as a one-line summary for a "changed" entity without nesting deeper.
function changedFieldNames(a: unknown, b: unknown): string {
  const ao = (a ?? {}) as Record<string, unknown>;
  const bo = (b ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  const changed: string[] = [];
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) changed.push(k);
  return changed.sort().join(", ");
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ── Rendering ────────────────────────────────────────────────────────────────

// Max itemized entries per group before collapsing the tail to "+K more".
// Keeps a large diff bounded in the chat context.
const RENDER_CAP = 25;

// Compact, id-resolved text for the chat tool result. This — never the
// SpecDiff JSON — is what lands in the LLM context.
export function renderSpecDiff(diff: SpecDiff): string {
  const base = diff.baseSha ? diff.baseSha.slice(0, 7) : "base";
  const head = diff.headSha ? diff.headSha.slice(0, 7) : "working copy";
  if (diff.empty) return `diff ${base} → ${head}\nno spec changes`;

  const lines: string[] = [`diff ${base} → ${head}`];

  if (diff.flows.length > 0) {
    lines.push(`flows: ${countStr(diff.counts.flow ?? { added: 0, removed: 0, changed: 0 })}`);
    renderEntityList(lines, diff.flows, "  ");
  }
  if (diff.agent) {
    lines.push("agent:");
    if (diff.agent.fields) for (const f of diff.agent.fields) lines.push(`  ${renderField(f)}`);
    if (diff.agent.children) renderEntityList(lines, diff.agent.children, "  ");
  }
  return lines.join("\n");
}

function renderEntityList(lines: string[], diffs: EntityDiff[], indent: string): void {
  const shown = diffs.slice(0, RENDER_CAP);
  for (const d of shown) renderEntity(lines, d, indent);
  if (diffs.length > shown.length) {
    lines.push(`${indent}… +${diffs.length - shown.length} more`);
  }
}

function renderEntity(lines: string[], d: EntityDiff, indent: string): void {
  const mark = d.kind === "added" ? "+" : d.kind === "removed" ? "-" : "~";
  const head = entityHead(d);
  lines.push(`${indent}${mark} ${head}`);
  if (d.kind !== "changed") return;
  const inner = `${indent}    `;
  if (d.fields) for (const f of d.fields) lines.push(`${inner}${renderField(f)}`);
  if (d.children) renderEntityList(lines, d.children, inner);
}

function entityHead(d: EntityDiff): string {
  if (d.entity === "exit_path") {
    const guard = d.kind === "changed" ? "" : d.summary ? ` ${d.summary}` : "";
    return `exit_path → "${d.ref.name}"${guard}`;
  }
  const suffix = d.summary ? ` ${d.summary}` : "";
  return `${d.entity} "${d.ref.name}"${suffix}`;
}

function renderField(f: FieldChange): string {
  if (f.kind === "scalar") return `${f.field}: ${fmtVal(f.from)} → ${fmtVal(f.to)}`;
  if (f.kind === "collection") return `${f.field}: ${countStr(f)}`;
  // text
  const sign = f.charDelta >= 0 ? `+${f.charDelta}` : `${f.charDelta}`;
  return `${f.field} changed (${sign} chars)`;
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return "∅";
  if (typeof v === "string") return `"${truncate(v, 60)}"`;
  return String(v);
}

function countStr(c: ChangeCount): string {
  return `+${c.added} ~${c.changed} -${c.removed}`;
}
