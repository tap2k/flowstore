import type { Spec } from "@flowstore/core/schema/v0";
import { isFlowGoto } from "@flowstore/core/schema/v0";

export type IssueLocation =
  | { kind: "flow"; flowId: string }
  | { kind: "edge"; flowId: string; exitPathId: string }
  | { kind: "global" };

export interface GraphIssue {
  at: IssueLocation;
  message: string;
}

export function validateGraph(spec: Spec): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const flowIds = new Set<string>();
  const seen = new Set<string>();

  for (const f of spec.flows) {
    if (seen.has(f.id)) {
      issues.push({ at: { kind: "flow", flowId: f.id }, message: "Duplicate flow id" });
    } else {
      seen.add(f.id);
    }
    flowIds.add(f.id);
  }

  if (!spec.agent.entry_flow_id) {
    issues.push({ at: { kind: "global" }, message: "agent.entry_flow_id is missing" });
  } else if (!flowIds.has(spec.agent.entry_flow_id)) {
    issues.push({
      at: { kind: "global" },
      message: `agent.entry_flow_id "${spec.agent.entry_flow_id}" does not match any flow`,
    });
  }

  const capabilityIds = new Set((spec.agent.capabilities ?? []).map((c) => c.id));

  for (const f of spec.flows) {
    if (f.type === "interrupt" && !f.entry_condition) {
      issues.push({
        at: { kind: "flow", flowId: f.id },
        message: "Interrupt flow is missing entry_condition",
      });
    }
    for (const xp of f.exit_paths) {
      if (isFlowGoto(xp.goto) && !flowIds.has(xp.goto)) {
        issues.push({
          at: { kind: "edge", flowId: f.id, exitPathId: xp.id },
          message: `goto "${xp.goto}" does not match any flow`,
        });
      }
      for (const action of xp.actions ?? []) {
        if (!capabilityIds.has(action.capability_id)) {
          issues.push({
            at: { kind: "edge", flowId: f.id, exitPathId: xp.id },
            message: `capability_id "${action.capability_id}" not in agent.capabilities`,
          });
        }
      }
    }
  }

  return issues;
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
