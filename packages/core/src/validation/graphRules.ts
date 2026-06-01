import type { Spec } from "@flowstore/core/schema/v0";
import { isFlowGoto, resolveLocalized, defaultLanguage } from "@flowstore/core/schema/v0";
import { GENERATED_PLACEHOLDER } from "@flowstore/core/codegen/promptGenerator";

export type IssueLocation =
  | { kind: "flow"; flowId: string }
  | { kind: "edge"; flowId: string; exitPathId: string }
  | { kind: "global" };

// Stable, machine-readable identifier per rule. `message` is human prose and may
// be reworded; `code` is the contract consumers switch on (rule suppression, doc
// links, analytics) and tests assert against.
export type GraphIssueCode =
  | "duplicate-flow-id"
  | "entry-flow-missing"
  | "entry-flow-unknown"
  | "system-prompt-missing-generated"
  | "system-prompt-multiple-generated"
  | "interrupt-missing-entry-condition"
  | "goto-unknown"
  | "max-turns-with-condition"
  | "unknown-capability"
  | "unreachable-flow"
  | "variable-casing";

export interface GraphIssue {
  code: GraphIssueCode;
  at: IssueLocation;
  message: string;
  // Absent = error (the default for structural problems). "warning" marks soft
  // advisories the compiler accepts either way (template shape, variable casing).
  severity?: "warning";
}

export function validateGraph(spec: Spec): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const flowIds = new Set<string>();
  const seen = new Set<string>();

  for (const f of spec.flows) {
    if (seen.has(f.id)) {
      issues.push({ code: "duplicate-flow-id", at: { kind: "flow", flowId: f.id }, message: "Duplicate flow id" });
    } else {
      seen.add(f.id);
    }
    flowIds.add(f.id);
  }

  if (!spec.agent.entry_flow_id) {
    issues.push({ code: "entry-flow-missing", at: { kind: "global" }, message: "agent.entry_flow_id is missing" });
  } else if (!flowIds.has(spec.agent.entry_flow_id)) {
    issues.push({
      code: "entry-flow-unknown",
      at: { kind: "global" },
      message: `agent.entry_flow_id "${spec.agent.entry_flow_id}" does not match any flow`,
    });
  }

  // agent.system_prompt template checks. Both are soft advisories — the
  // compiler accepts either case — but the author probably wants to know.
  if (spec.agent.system_prompt !== undefined) {
    const defaultLang = defaultLanguage(spec.agent.meta.languages);
    const resolved = resolveLocalized(spec.agent.system_prompt, defaultLang, defaultLang);
    if (resolved.length > 0) {
      const first = resolved.indexOf(GENERATED_PLACEHOLDER);
      if (first < 0) {
        issues.push({
          code: "system-prompt-missing-generated",
          at: { kind: "global" },
          severity: "warning",
          message: `agent.system_prompt omits ${GENERATED_PLACEHOLDER} — all spec-derived sections will be excluded from the compiled prompt`,
        });
      } else if (resolved.indexOf(GENERATED_PLACEHOLDER, first + GENERATED_PLACEHOLDER.length) >= 0) {
        issues.push({
          code: "system-prompt-multiple-generated",
          at: { kind: "global" },
          severity: "warning",
          message: `agent.system_prompt contains multiple ${GENERATED_PLACEHOLDER} placeholders — only the first is replaced`,
        });
      }
    }
  }

  const capabilityIds = new Set((spec.agent.capabilities ?? []).map((c) => c.id));

  for (const f of spec.flows) {
    if (f.type === "interrupt" && !f.entry_condition) {
      issues.push({
        code: "interrupt-missing-entry-condition",
        at: { kind: "flow", flowId: f.id },
        message: "Interrupt flow is missing entry_condition",
      });
    }
    for (const xp of f.exit_paths) {
      if (isFlowGoto(xp.goto) && !flowIds.has(xp.goto)) {
        issues.push({
          code: "goto-unknown",
          at: { kind: "edge", flowId: f.id, exitPathId: xp.id },
          message: `goto "${xp.goto}" does not match any flow`,
        });
      }
      if (xp.max_turns !== undefined && xp.condition) {
        issues.push({
          code: "max-turns-with-condition",
          at: { kind: "edge", flowId: f.id, exitPathId: xp.id },
          message: "max_turns and condition are mutually exclusive on the same exit_path",
        });
      }
      for (const action of xp.actions ?? []) {
        if (!capabilityIds.has(action.capability_id)) {
          issues.push({
            code: "unknown-capability",
            at: { kind: "edge", flowId: f.id, exitPathId: xp.id },
            message: `capability_id "${action.capability_id}" not in agent.capabilities`,
          });
        }
      }
    }
  }

  // Unreachable (orphaned) flows: a non-interrupt flow with no path from the
  // entry flow. Interrupts are globally callable (they fire on entry_condition),
  // so they seed reachability rather than being orphans. Skipped entirely when
  // the entry flow itself is missing/unknown — that error is the thing to fix
  // first, and running this then would flag nearly everything.
  if (spec.agent.entry_flow_id && flowIds.has(spec.agent.entry_flow_id)) {
    const byId = new Map(spec.flows.map((f) => [f.id, f]));
    const reachable = new Set<string>();
    const stack = [
      spec.agent.entry_flow_id,
      ...spec.flows.filter((f) => f.type === "interrupt").map((f) => f.id),
    ];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const xp of byId.get(id)?.exit_paths ?? []) {
        if (isFlowGoto(xp.goto) && !reachable.has(xp.goto)) stack.push(xp.goto);
      }
    }
    for (const f of spec.flows) {
      if (f.type !== "interrupt" && !reachable.has(f.id)) {
        issues.push({
          code: "unreachable-flow",
          at: { kind: "flow", flowId: f.id },
          severity: "warning",
          message: `Flow "${f.name || f.id}" is unreachable — no path to it from the entry flow`,
        });
      }
    }
  }

  issues.push(...lintVariableCasing(spec));

  return issues;
}

// Variables are spontaneous — referencing one anywhere conjures it — so a
// mis-cased reference (`{Customer_Name}` vs `customer_name`) silently creates a
// second, always-empty variable instead of erroring. This rule buckets every
// variable reference case-insensitively and warns when one logical variable is
// written with more than one casing, anchored at each off-casing site.
function lintVariableCasing(spec: Spec): GraphIssue[] {
  // lowercase key -> spelling -> the locations it appears at.
  const refs = new Map<string, Map<string, IssueLocation[]>>();
  const declaredKeys = new Set<string>();

  const record = (name: string, at: IssueLocation) => {
    if (!name) return;
    const lc = name.toLowerCase();
    let spellings = refs.get(lc);
    if (!spellings) {
      spellings = new Map();
      refs.set(lc, spellings);
    }
    const locs = spellings.get(name) ?? [];
    locs.push(at);
    spellings.set(name, locs);
  };

  // Anchors — sites that are unambiguously variable names (no expression
  // parsing): declarations, {placeholder} substitutions, and assign targets.
  const declared = spec.agent.variables ?? {};
  for (const name of Object.keys(declared)) {
    declaredKeys.add(name);
    record(name, { kind: "global" });
  }
  for (const t of localizedValues(spec.agent.system_prompt)) {
    for (const name of placeholderNames(t)) record(name, { kind: "global" });
  }
  for (const f of spec.flows) {
    const flowAt: IssueLocation = { kind: "flow", flowId: f.id };
    for (const name of placeholderNames(f.instructions ?? "")) record(name, flowAt);
    for (const s of f.scripts ?? []) {
      for (const t of localizedValues(s.text)) {
        for (const name of placeholderNames(t)) record(name, flowAt);
      }
      for (const arr of Object.values(s.variations ?? {})) {
        for (const v of arr) for (const name of placeholderNames(v)) record(name, flowAt);
      }
    }
    for (const xp of f.exit_paths ?? []) {
      const edgeAt: IssueLocation = { kind: "edge", flowId: f.id, exitPathId: xp.id };
      for (const key of Object.keys(xp.assigns ?? {})) record(key, edgeAt);
    }
  }

  // Expressions are scanned only for tokens that match an already-known variable
  // name — so function names, enum literals, and llm-prose words can't trip the
  // rule. Only deterministic (calculation / visible_when) grammar is scanned;
  // llm-method expressions are natural-language prose, not variable algebra.
  const known = new Set(refs.keys());
  const scanExpr = (expr: string | undefined, at: IssueLocation) => {
    if (!expr) return;
    for (const tok of expr.match(IDENTIFIER_RE) ?? []) {
      if (known.has(tok.toLowerCase())) record(tok, at);
    }
  };
  for (const name of Object.keys(declared)) {
    scanExpr(declared[name].visible_when, { kind: "global" });
  }
  for (const f of spec.flows) {
    if (f.entry_condition?.method === "calculation") {
      scanExpr(f.entry_condition.expression, { kind: "flow", flowId: f.id });
    }
    for (const xp of f.exit_paths ?? []) {
      const edgeAt: IssueLocation = { kind: "edge", flowId: f.id, exitPathId: xp.id };
      if (xp.condition?.method === "calculation") scanExpr(xp.condition.expression, edgeAt);
      for (const a of Object.values(xp.assigns ?? {})) {
        if (a?.method === "calculation" && typeof a.value === "string") scanExpr(a.value, edgeAt);
      }
    }
  }

  const issues: GraphIssue[] = [];
  for (const [lc, spellings] of refs) {
    if (spellings.size <= 1) continue;
    // Canonical = the declared key if one exists at this casing, else the
    // most-referenced spelling.
    const declaredSpelling = [...declaredKeys].find((k) => k.toLowerCase() === lc);
    const canonical =
      declaredSpelling ??
      [...spellings.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
    for (const [spelling, locs] of spellings) {
      if (spelling === canonical) continue;
      for (const at of dedupeLocations(locs)) {
        issues.push({
          code: "variable-casing",
          at,
          severity: "warning",
          message: `variable "${spelling}" is written "${canonical}" elsewhere — references are case-sensitive, so this likely creates a separate, empty variable. Use one casing.`,
        });
      }
    }
  }
  return issues;
}

const IDENTIFIER_RE = /[A-Za-z_]\w*/g;
const PLACEHOLDER_RE = /\{([A-Za-z_]\w*)\}/g;

function placeholderNames(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (m[1] !== "generated") names.push(m[1]); // {generated} is the codegen splice, not a var
  }
  return names;
}

function localizedValues(value: string | Record<string, string> | undefined): string[] {
  if (!value) return [];
  return typeof value === "string" ? [value] : Object.values(value);
}

function dedupeLocations(locs: IssueLocation[]): IssueLocation[] {
  const seen = new Set<string>();
  const out: IssueLocation[] = [];
  for (const at of locs) {
    const key = JSON.stringify(at);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(at);
  }
  return out;
}

export function groupIssuesByFlow(issues: GraphIssue[]): Map<string, GraphIssue[]> {
  const map = new Map<string, GraphIssue[]>();
  for (const i of issues) {
    let id: string | null = null;
    if (i.at.kind === "flow") id = i.at.flowId;
    else if (i.at.kind === "edge") id = i.at.flowId;
    if (id) {
      const arr = map.get(id) ?? [];
      arr.push(i);
      map.set(id, arr);
    }
  }
  return map;
}

export function groupIssuesByEdge(issues: GraphIssue[]): Map<string, GraphIssue[]> {
  const map = new Map<string, GraphIssue[]>();
  for (const i of issues) {
    if (i.at.kind === "edge") {
      const key = `${i.at.flowId}__${i.at.exitPathId}`;
      const arr = map.get(key) ?? [];
      arr.push(i);
      map.set(key, arr);
    }
  }
  return map;
}
