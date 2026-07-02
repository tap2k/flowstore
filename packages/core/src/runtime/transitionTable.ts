import type { Method, Spec } from "@flowstore/core/schema/v0";
import { isEndGoto, isReturnGoto } from "@flowstore/core/schema/v0";

// The licensed-transition table: for each flow, the set of transitions the spec
// permits out of it. This is the constrained option-set the prompt-mode flow
// watcher classifies against, AND the oracle for illegal-jump detection — if the
// watcher's naive read of "current flow" isn't reachable from the prior flow via
// this table, the agent behaved like a flow the spec can't reach from there
// (off-spec, or a missing edge). See planning/attribution-and-uncertainty.md §8.
//
// Pure function of the spec; cheap; recompute on spec change. No LLM.

export type TransitionKind = "exit" | "interrupt" | "end" | "return";

export interface LicensedTransition {
  // The exit path this transition leaves by. null for an interrupt-push (an
  // interrupt fires globally, not through any authored exit of the source flow).
  exitPathId: string | null;
  // The destination flow id. null for END (terminal) and RETURN (pops to the
  // caller — the concrete target isn't known statically).
  toFlowId: string | null;
  // The exit condition's method, or the interrupt's entry_condition method.
  // null when there's nothing to evaluate (a conditionless fallback or a
  // turn-budget escape).
  method: Method | null;
  kind: TransitionKind;
  // A conditionless, non-budget exit — the "Otherwise…" catch-all.
  isFallback: boolean;
  // A `max_turns` turn-budget escape (runtime-enforced, not model-decided).
  isBudget: boolean;
}

export type TransitionTable = Map<string, LicensedTransition[]>;

// Interrupt flows are globally callable — their entry_condition can fire on any
// turn, from any flow, with no incoming edge (see routeToTarget's interrupt-entry
// handling and llm/prompts.ts). So every flow's licensed set includes an
// interrupt-push to each interrupt flow.
function interruptTransitions(spec: Spec): LicensedTransition[] {
  return spec.flows
    .filter((f) => f.type === "interrupt")
    .map((f) => ({
      exitPathId: null,
      toFlowId: f.id,
      method: f.entry_condition?.method ?? null,
      kind: "interrupt" as const,
      isFallback: false,
      isBudget: false,
    }));
}

function exitTransitions(flow: Spec["flows"][number]): LicensedTransition[] {
  return (flow.exit_paths ?? []).map((ep) => {
    const isBudget = ep.max_turns !== undefined;
    const isFallback = ep.condition === undefined && !isBudget;
    const method = ep.condition?.method ?? null;
    if (isEndGoto(ep.goto)) {
      return { exitPathId: ep.id, toFlowId: null, method, kind: "end", isFallback, isBudget };
    }
    if (isReturnGoto(ep.goto)) {
      return { exitPathId: ep.id, toFlowId: null, method, kind: "return", isFallback, isBudget };
    }
    return { exitPathId: ep.id, toFlowId: ep.goto, method, kind: "exit", isFallback, isBudget };
  });
}

export function buildTransitionTable(spec: Spec): TransitionTable {
  const interrupts = interruptTransitions(spec);
  const table: TransitionTable = new Map();
  for (const flow of spec.flows) {
    // Authored exits first, then the global interrupt-pushes. RETURN targets are
    // resolved dynamically by the runtime; here they stay null.
    table.set(flow.id, [...exitTransitions(flow), ...interrupts]);
  }
  return table;
}

// The interrupt flow ids the table encodes (globally-callable interrupt-push
// targets). The resolver uses this to tell an interrupt-push from an illegal
// jump without the caller re-deriving the interrupt set from the spec.
export function interruptFlowIds(table: TransitionTable): Set<string> {
  const out = new Set<string>();
  for (const list of table.values()) {
    for (const t of list) {
      if (t.kind === "interrupt" && t.toFlowId !== null) out.add(t.toFlowId);
    }
  }
  return out;
}

// Find the authored exit from `fromFlowId` that lands on `toFlowId`. When several
// exits share a target (e.g. two llm branches both `goto` the same flow), an
// optional `preferExitPathId` (the watcher's guess) disambiguates; otherwise the
// first is returned. null when no such exit exists — i.e. the only way to reach
// `toFlowId` from here is an interrupt-push (or it's unreachable entirely).
export function findExitTo(
  table: TransitionTable,
  fromFlowId: string,
  toFlowId: string,
  preferExitPathId?: string | null,
): LicensedTransition | null {
  const candidates = (table.get(fromFlowId) ?? []).filter(
    (t) => t.kind === "exit" && t.toFlowId === toFlowId,
  );
  if (candidates.length === 0) return null;
  if (preferExitPathId) {
    const preferred = candidates.find((t) => t.exitPathId === preferExitPathId);
    if (preferred) return preferred;
  }
  return candidates[0];
}
