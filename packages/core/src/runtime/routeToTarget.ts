import type { Condition, ExitPath, Flow, Spec } from "@flowstore/core/schema/v0";
import { isFlowGoto } from "@flowstore/core/schema/v0";

// Derive the route from the agent's entry flow to a target node (a flow) or
// target edge (an exit path = that flow PLUS the branch out of it), and split
// the conditions along the way into the two things that steer a simulated run
// toward it: persona prose (llm-method conditions the user can satisfy by what
// they say) and a seeded fixture (calculation/direct conditions the user can't
// talk their way into — they have to be true at session start).
//
// Best-effort by nature: prompt-mode simulation has no router to observe, so
// reaching the target is never guaranteed. This just compiles the route into a
// goal-directed persona and stacks the odds.

export type RouteTarget =
  | { kind: "flow"; flowId: string }
  | { kind: "exit"; flowId: string; exitPathId: string };

export interface RouteHop {
  // The flow the exit leaves from.
  fromFlowId: string;
  // The exit taken on this hop.
  exitPath: ExitPath;
  // Sibling exits on `fromFlowId` the persona must AVOID firing so the router
  // takes this branch and not another. Conditionless siblings are excluded
  // (nothing to steer away from).
  siblings: ExitPath[];
}

export interface RouteCondition {
  hop: number; // index into hops
  condition: Condition;
  // True when this is a sibling-avoid condition (negative), false for the
  // taken edge (positive). Persona synthesis renders these differently.
  negative: boolean;
}

export interface RouteResult {
  found: boolean;
  target: RouteTarget;
  targetFlowName: string | null;
  // The exit's notes/condition gives the branch a human name when targeting an edge.
  targetExit: ExitPath | null;
  hops: RouteHop[];
  // llm-method conditions (taken edges + sibling-avoids) — go into the persona prose.
  llmConditions: RouteCondition[];
  // calculation/direct conditions on the taken edges — go into the fixture.
  // (Sibling-avoids of these aren't seedable, so they're dropped: you can't
  // steer a deterministic router by NOT setting a variable.)
  structuralConditions: RouteCondition[];
}

function flowsById(spec: Spec): Map<string, Flow> {
  const m = new Map<string, Flow>();
  for (const f of spec.flows ?? []) m.set(f.id, f);
  return m;
}

// BFS the exit-path graph from the entry flow to `targetFlowId`. Returns the
// ordered list of (flow, exit) hops, or null if unreachable. END/RETURN gotos
// are not traversed (they don't lead to a named flow).
function bfsToFlow(spec: Spec, targetFlowId: string): RouteHop[] | null {
  const byId = flowsById(spec);
  const entry = spec.agent.entry_flow_id;
  if (!entry || !byId.has(entry)) return null;
  if (entry === targetFlowId) return [];

  // prev[flowId] = the hop that first reached it.
  const prev = new Map<string, RouteHop>();
  const seen = new Set<string>([entry]);
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const fromFlowId = queue.shift()!;
    const flow = byId.get(fromFlowId);
    if (!flow) continue;
    for (const exit of flow.exit_paths) {
      if (!isFlowGoto(exit.goto)) continue; // END / RETURN
      const to = exit.goto;
      if (!byId.has(to) || seen.has(to)) continue;
      const siblings = flow.exit_paths.filter(
        (xp) => xp.id !== exit.id && xp.condition !== undefined,
      );
      prev.set(to, { fromFlowId, exitPath: exit, siblings });
      if (to === targetFlowId) return reconstruct(prev, targetFlowId);
      seen.add(to);
      queue.push(to);
    }
  }
  return null;
}

function reconstruct(prev: Map<string, RouteHop>, targetFlowId: string): RouteHop[] {
  const hops: RouteHop[] = [];
  let cursor = targetFlowId;
  while (prev.has(cursor)) {
    const hop = prev.get(cursor)!;
    hops.unshift(hop);
    cursor = hop.fromFlowId;
  }
  return hops;
}

function partitionConditions(hops: RouteHop[]): {
  llm: RouteCondition[];
  structural: RouteCondition[];
} {
  const llm: RouteCondition[] = [];
  const structural: RouteCondition[] = [];
  hops.forEach((hop, i) => {
    const taken = hop.exitPath.condition;
    if (taken) {
      const rc: RouteCondition = { hop: i, condition: taken, negative: false };
      (taken.method === "llm" ? llm : structural).push(rc);
    }
    // Only llm-method siblings are steerable-away-from; a deterministic sibling
    // either fires or doesn't based on state, which the positive taken-edge
    // fixture already pins.
    for (const sib of hop.siblings) {
      if (sib.condition && sib.condition.method === "llm") {
        llm.push({ hop: i, condition: sib.condition, negative: true });
      }
    }
  });
  return { llm, structural };
}

export function routeToTarget(spec: Spec, target: RouteTarget): RouteResult {
  const byId = flowsById(spec);
  const targetFlow = byId.get(target.flowId) ?? null;

  let hops: RouteHop[] | null = bfsToFlow(spec, target.flowId);
  let viaInterruptEntry = false;

  // An interrupt flow is globally callable and may have no incoming edge. If we
  // couldn't route to it but it's an interrupt with an entry_condition, model
  // the target as "trigger this interrupt" via that condition.
  if (hops === null && targetFlow?.type === "interrupt") {
    hops = [];
    viaInterruptEntry = true;
  }

  if (hops === null) {
    return {
      found: false,
      target,
      targetFlowName: targetFlow?.name ?? null,
      targetExit: null,
      hops: [],
      llmConditions: [],
      structuralConditions: [],
    };
  }

  // For an edge target, the final hop must be the targeted exit itself. The
  // BFS routed us TO the flow; append the chosen exit as a terminal hop whose
  // condition is the branch we want to take. (goto may be END/RETURN — fine,
  // we only care about its condition/siblings here, not traversal.)
  if (target.kind === "exit" && targetFlow) {
    const exit = targetFlow.exit_paths.find((xp) => xp.id === target.exitPathId);
    if (!exit) {
      return {
        found: false,
        target,
        targetFlowName: targetFlow.name,
        targetExit: null,
        hops,
        llmConditions: [],
        structuralConditions: [],
      };
    }
    const siblings = targetFlow.exit_paths.filter(
      (xp) => xp.id !== exit.id && xp.condition !== undefined,
    );
    hops = [...hops, { fromFlowId: targetFlow.id, exitPath: exit, siblings }];
  }

  // For an interrupt-entry target, fold the entry_condition in as a positive
  // llm condition (entry conditions are llm-ish judgments by construction).
  const { llm, structural } = partitionConditions(hops);
  if (viaInterruptEntry && targetFlow?.entry_condition) {
    const c = targetFlow.entry_condition;
    (c.method === "llm" ? llm : structural).push({ hop: 0, condition: c, negative: false });
  }

  const targetExit =
    target.kind === "exit" && targetFlow
      ? targetFlow.exit_paths.find((xp) => xp.id === target.exitPathId) ?? null
      : null;

  return {
    found: true,
    target,
    targetFlowName: targetFlow?.name ?? null,
    targetExit,
    hops,
    llmConditions: llm,
    structuralConditions: structural,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic var inversion.
//
// Turn the structural (calculation/direct) conditions of a route into seeded
// vars. Conservative by design: invert ONLY simple, provable forms (equality /
// numeric comparison against a literal). Anything compound or ambiguous is left
// out and reported in `underivable` so the UI can flag it — a wrong-but-confident
// value is worse than an absent one, because the deterministic pass is the one
// the user trusts. Mocks aren't derived here: capability-output gating is always
// the compound case we refuse to guess, so the LLM-guessed mocks stand alone.
// ─────────────────────────────────────────────────────────────────────────────

export interface DerivedVars {
  vars: Record<string, unknown>;
  underivable: string[]; // expressions we couldn't safely invert
}

// `x == "gold"` / `x == 5` / `x == true` — equality against a single literal.
const EQ = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*==\s*(.+?)\s*$/;
// `x > 50` / `x >= 50` / `x < 50` / `x <= 50` — comparison against a number.
const CMP = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/;

function parseLiteral(raw: string): unknown | undefined {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  // Quoted string.
  const q = t.match(/^"([^"]*)"$/) || t.match(/^'([^']*)'$/);
  if (q) return q[1];
  return undefined; // bareword / expression — not a safe literal
}

// Pick a concrete value satisfying a numeric comparison. Integer steps; we
// don't know the variable's true granularity, so ±1 is the honest default.
function satisfyComparison(op: string, n: number): number {
  switch (op) {
    case ">":
      return Math.floor(n) + 1;
    case ">=":
      return n;
    case "<":
      return Math.ceil(n) - 1;
    case "<=":
      return n;
    default:
      return n;
  }
}

export function deriveVarsFromRoute(structuralConditions: RouteCondition[]): DerivedVars {
  const vars: Record<string, unknown> = {};
  const underivable: string[] = [];

  for (const { condition } of structuralConditions) {
    const expr = condition.expression?.trim();
    if (!expr) continue;

    const eq = expr.match(EQ);
    if (eq) {
      const lit = parseLiteral(eq[2]);
      if (lit !== undefined) {
        vars[eq[1]] = lit;
        continue;
      }
    }
    const cmp = expr.match(CMP);
    if (cmp) {
      vars[cmp[1]] = satisfyComparison(cmp[2], Number(cmp[3]));
      continue;
    }
    underivable.push(expr);
  }

  return { vars, underivable };
}
