import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Spec } from "@flowstore/core/schema/v0";
import { computeDiagnostics, diagnosticCounts, worstSeverity, anchorLabel } from "@/lib/diagnostics";

const coffee = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../examples/coffee/coffee.json", import.meta.url)), "utf8"),
) as Spec;

describe("worstSeverity", () => {
  it("returns undefined for no issues", () => {
    expect(worstSeverity([])).toBeUndefined();
  });
  it("returns warning when all issues are warnings", () => {
    expect(worstSeverity([{ severity: "warning" }, { severity: "warning" }])).toBe("warning");
  });
  it("returns error when any issue is an error (severity absent = error)", () => {
    expect(worstSeverity([{ severity: "warning" }, {}])).toBe("error");
  });
});

describe("diagnosticCounts", () => {
  it("tallies errors and warnings", () => {
    const counts = diagnosticCounts([
      { severity: "error", message: "", at: { kind: "global" }, source: "graph" },
      { severity: "warning", message: "", at: { kind: "global" }, source: "graph" },
      { severity: "warning", message: "", at: { kind: "global" }, source: "graph" },
    ]);
    expect(counts).toEqual({ errors: 1, warnings: 2 });
  });
});

describe("computeDiagnostics", () => {
  it("is empty for the clean coffee example", () => {
    expect(computeDiagnostics(coffee)).toEqual([]);
  });

  it("surfaces a graph warning (system_prompt missing {{generated}})", () => {
    const s = structuredClone(coffee);
    s.agent.system_prompt = "You are a bot."; // no {{generated}}
    const diags = computeDiagnostics(s);
    const w = diags.find((d) => d.code === "system-prompt-missing-generated");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
    expect(w!.source).toBe("graph");
  });

  it("orders errors before warnings", () => {
    const s = structuredClone(coffee);
    s.agent.system_prompt = "You are a bot."; // warning
    (s.flows[0].exit_paths[0] as { goto: string }).goto = "ghost_flow"; // error (dangling goto)
    const diags = computeDiagnostics(s);
    const firstWarningIdx = diags.findIndex((d) => d.severity === "warning");
    const lastErrorIdx = diags.map((d) => d.severity).lastIndexOf("error");
    expect(lastErrorIdx).toBeLessThan(firstWarningIdx);
  });
});

describe("anchorLabel", () => {
  it("labels flow / edge / global anchors", () => {
    const flowId = coffee.flows[0].id;
    expect(anchorLabel({ kind: "flow", flowId }, coffee)).toContain("flow ·");
    expect(anchorLabel({ kind: "edge", flowId, exitPathId: "x" }, coffee)).toContain("exit ·");
    expect(anchorLabel({ kind: "global" }, coffee)).toBe("spec");
  });
});
