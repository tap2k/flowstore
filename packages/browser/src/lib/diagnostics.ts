import type { Spec } from "@flowstore/core/schema/v0";
import { validateGraph, type IssueLocation } from "@flowstore/core/validation/graphRules";
import { validateSpec, formatErrors } from "@flowstore/core/validation/ajv";

// One unified diagnostic, the way an IDE's Problems pane treats compiler output:
// schema (ajv) errors and graph-rule issues collapsed into a single list. The
// compile of a spec produces the prompt AND these — so they live with the
// compiled-output view (the System Prompt panel) plus a count on the pill.
export type Diagnostic = {
  severity: "error" | "warning";
  message: string;
  at: IssueLocation;
  source: "schema" | "graph";
  code?: string;
};

export function computeDiagnostics(spec: Spec): Diagnostic[] {
  const out: Diagnostic[] = [];

  const schema = validateSpec(spec);
  if (!schema.valid) {
    for (const message of formatErrors(schema.errors)) {
      out.push({ severity: "error", message, at: { kind: "global" }, source: "schema" });
    }
  }

  // Defensive: validateGraph walks spec.flows; a structurally broken spec is
  // already covered by the schema errors above, so don't let it throw the list.
  try {
    for (const i of validateGraph(spec)) {
      out.push({
        severity: i.severity === "warning" ? "warning" : "error",
        message: i.message,
        at: i.at,
        source: "graph",
        code: i.code,
      });
    }
  } catch {
    /* schema errors already explain the breakage */
  }

  // Errors before warnings; stable within each.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export function diagnosticCounts(diags: Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    if (d.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

// Worst severity over a set of graph issues, for canvas node/edge coloring.
export function worstSeverity(
  issues: { severity?: "warning" }[],
): "error" | "warning" | undefined {
  if (issues.length === 0) return undefined;
  return issues.some((i) => i.severity !== "warning") ? "error" : "warning";
}

export function anchorLabel(at: IssueLocation, spec: Spec): string {
  if (at.kind === "flow") return `flow · ${flowName(spec, at.flowId)}`;
  if (at.kind === "edge") return `exit · ${flowName(spec, at.flowId)}`;
  return "spec";
}

export function flowName(spec: Spec, flowId: string): string {
  return spec.flows.find((f) => f.id === flowId)?.name || flowId;
}
