import { describe, it, expect } from "vitest";
import { buildReportHtml } from "../src/report";
import type { CellState, Study } from "../src/types";
import { cellKey } from "../src/types";

const cell = (over: Partial<CellState> = {}): CellState => ({
  status: "done",
  totalMs: 1000,
  usage: { inputTokens: 50, outputTokens: 20, cost: 0.01 },
  turns: [
    { role: "user", text: "hi <script>alert(1)</script>", ts: 0, events: [] },
    { role: "agent", text: "Hello & welcome", ts: 0, events: [], latencyMs: 900 },
  ],
  ...over,
});

const study: Study = {
  title: "Clinic study <unsafe>",
  prompt: "You are Asha.",
  models: ["incumbent-model", "candidate-model"],
  scenarios: [
    { id: "s1", scenarioId: "s1", name: "Reschedule <b>fast</b>", language: "EN", turns: ["hi"] },
  ],
  cells: {
    [cellKey("s1", 0)]: cell(),
    [cellKey("s1", 1)]: cell({ divergent: true }),
  },
};

describe("buildReportHtml", () => {
  const html = buildReportHtml(study);

  it("escapes user-controlled text everywhere it appears", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>fast</b>");
    expect(html).not.toContain("<unsafe>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Hello &amp; welcome");
  });

  it("reports measured per-conversation cost (no volume projection — readers do that math)", () => {
    expect(html).toContain("$0.01");
    expect(html).not.toContain("conversations/month");
  });

  it("marks the incumbent row and flags divergent columns", () => {
    expect(html).toContain("current");
    expect(html).toContain("diverges");
  });

  it("never inlines the prompt text — only its length", () => {
    expect(html).not.toContain("You are Asha.");
    expect(html).toContain("prompt 13 chars");
  });

  it("surface opts override the default copy", () => {
    const custom = buildReportHtml(study, {
      latencyNote: "CUSTOM LATENCY NOTE.",
      footer: "CUSTOM FOOTER.",
    });
    expect(custom).toContain("CUSTOM LATENCY NOTE.");
    expect(custom).toContain("CUSTOM FOOTER.");
    expect(custom).not.toContain("compare.flowstore.org");
  });

  it("shows n/a for cost when a model has token counts but no dollar figure", () => {
    const noCost: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell({ usage: { inputTokens: 50, outputTokens: 20 } }),
        [cellKey("s1", 1)]: cell(),
      },
    };
    expect(buildReportHtml(noCost)).toContain("n/a*");
  });

  it("reports the latency distribution, not just the mean", () => {
    expect(html).toContain("Latency per reply");
    for (const h of [">avg<", ">p50<", ">p95<", ">max<"]) expect(html).toContain(h);
  });

  it("computes p50/p95/max by nearest rank over individual replies", () => {
    const reply = (ms: number) => ({
      role: "agent" as const,
      text: "ok",
      ts: 0,
      events: [],
      latencyMs: ms,
    });
    const spread: Study = {
      ...study,
      models: ["only-model"],
      cells: {
        [cellKey("s1", 0)]: cell({
          turns: [100, 200, 300, 3400].map(reply),
        }),
      },
    };
    const out = buildReportHtml(spread);
    // avg 1.0s, p50 0.2s, p95 3.4s, max 3.4s — the mean hides the tail.
    expect(out).toContain("1.0s");
    expect(out).toContain("0.2s");
    expect(out).toContain("3.4s");
  });

  it("carries words per reply as a secondary figure beside tokens", () => {
    expect(html).toContain("words/reply");
  });

  it("no longer offers a voice cost column", () => {
    expect(html).not.toContain("Est. voice cost");
    expect(html).not.toContain("voice cost");
  });

  it("adds the per-language speed table only for multilingual studies", () => {
    expect(html).not.toContain("Speed by language");
    const bilingual: Study = {
      ...study,
      scenarios: [
        ...study.scenarios,
        { id: "s2", scenarioId: "s1", name: "Reschedule", language: "ES", turns: ["hola"] },
      ],
      cells: {
        ...study.cells,
        [cellKey("s2", 0)]: cell(),
        [cellKey("s2", 1)]: cell(),
      },
    };
    const out = buildReportHtml(bilingual);
    expect(out).toContain("Speed by language");
    expect(out).toContain("Spanish");
    expect(out).toContain("2 languages");
  });

  it("explains the score in plain words wherever the score appears", () => {
    const better: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.02 } }),
        [cellKey("s1", 1)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.004 } }),
      },
    };
    const out = buildReportHtml(better);
    // Tied latency (900ms both -> ×1.45), neither diverges, so the ranking
    // comes down to cost alone: candidate wins 5.0× on a 5.0× lower price.
    expect(out).toContain("candidate-model has the best cost-to-performance in this study");
    expect(out).toContain("$0.0058 effective cost");
    expect(out).toContain("$0.0040/conversation, 0.9s p95, 0% of scenarios diverging");
    expect(out).toContain("5.0× more cost-efficient than the next best, incumbent-model");
    expect(out).toContain("it starts from cost per conversation, then scales that cost up for");
    // A visible line, not a hover-only tooltip — the report gets printed to PDF.
    expect(out).toContain('class="headline-note"');
  });

  it("spells languages out rather than leaving two-letter codes", () => {
    const bilingual: Study = {
      ...study,
      scenarios: [
        ...study.scenarios,
        { id: "s2", scenarioId: "s1", name: "Reschedule", language: "ES", turns: ["hola"] },
      ],
      cells: {
        ...study.cells,
        [cellKey("s2", 0)]: cell(),
        [cellKey("s2", 1)]: cell(),
      },
    };
    const out = buildReportHtml(bilingual);
    expect(out).toContain("English");
    expect(out).toContain("Spanish");
    expect(out).not.toContain(">ES<");
    expect(out).not.toContain(">EN<");
  });

  it("passes through a language it cannot resolve, rather than blanking it", () => {
    const odd: Study = {
      ...study,
      scenarios: [{ ...study.scenarios[0], language: "Klingon-ish" }],
    };
    expect(buildReportHtml(odd)).toContain("Klingon-ish");
  });

  it("indexes the transcripts and anchors each scenario", () => {
    expect(html).toContain('id="sc-0"');
    expect(html).toContain('href="#sc-0"');
  });

  it("points at the first diverging reply inside a flagged column", () => {
    const diverging: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell(),
        [cellKey("s1", 1)]: cell({
          divergent: true,
          turns: [
            { role: "user", text: "hi", ts: 0, events: [] },
            { role: "agent", text: "totally different wording entirely", ts: 0, events: [] },
          ],
        }),
      },
    };
    expect(buildReportHtml(diverging)).toContain("first divergence from current");
  });

  it("computes score as cost × a latency multiplier × a divergence multiplier", () => {
    // Candidate: p95 1000ms -> ×1.5; the only scenario, and it's flagged, so
    // divergence is 100% -> ×2. value = 0.01 × 1.5 × 2 = $0.03. Incumbent uses
    // the default fixture's 900ms p95 (×1.45) with cost bumped to $0.05, so
    // it's the candidate's OWN numbers under test here, not just "whichever
    // one is cheaper wins by coincidence": incumbent value = 0.05 × 1.45 = 0.0725.
    const withDivergence: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.05 } }),
        [cellKey("s1", 1)]: cell({
          divergent: true,
          usage: { inputTokens: 50, outputTokens: 20, cost: 0.01 },
          turns: [
            { role: "user", text: "hi", ts: 0, events: [] },
            { role: "agent", text: "Hello & welcome", ts: 0, events: [], latencyMs: 1000 },
          ],
        }),
      },
    };
    const out = buildReportHtml(withDivergence);
    expect(out).toContain("candidate-model has the best cost-to-performance in this study");
    expect(out).toContain("$0.03 effective cost");
    expect(out).toContain("$0.01/conversation, 1.0s p95, 100% of scenarios diverging");
    expect(out).toContain("2.4× more cost-efficient than the next best, incumbent-model");
  });

  it("lets divergence outweigh a modestly cheaper, faster candidate", () => {
    // Candidate is 10% cheaper and a little faster than the incumbent, but
    // flagged on the only scenario. The divergence doubling (×2) outweighs
    // that modest edge: incumbent 0.01×1.45=0.0145 beats candidate
    // 0.009×1.425×2=0.02565, so the CHEAPER, FASTER model still loses.
    const risky: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.01 } }),
        [cellKey("s1", 1)]: cell({
          divergent: true,
          usage: { inputTokens: 50, outputTokens: 20, cost: 0.009 },
          turns: [
            { role: "user", text: "hi", ts: 0, events: [] },
            { role: "agent", text: "Hello & welcome", ts: 0, events: [], latencyMs: 850 },
          ],
        }),
      },
    };
    expect(buildReportHtml(risky)).toContain("incumbent-model has the best cost-to-performance");
  });

  it("picks the best score regardless of which column it sits in", () => {
    // Three models; the best cost-to-performance belongs to the LAST column,
    // proving the winner is found by number, not by position.
    const threeWay: Study = {
      ...study,
      models: ["model-a", "model-b", "model-c"],
      cells: {
        [cellKey("s1", 0)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.01 } }),
        [cellKey("s1", 1)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.02 } }),
        [cellKey("s1", 2)]: cell({
          usage: { inputTokens: 50, outputTokens: 20, cost: 0.002 },
          turns: [
            { role: "user", text: "hi", ts: 0, events: [] },
            { role: "agent", text: "Hello & welcome", ts: 0, events: [], latencyMs: 100 },
          ],
        }),
      },
    };
    expect(buildReportHtml(threeWay)).toContain(
      "model-c has the best cost-to-performance in this study",
    );
  });

  it("never excludes a model for being slow — a high p95 only scales its cost", () => {
    // No ceiling, no clamp: candidate at exactly the 2s reference point still
    // gets a real, finite score (×2 on its cost), not an "unrankable" verdict.
    const slow: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell({
          usage: { inputTokens: 50, outputTokens: 20, cost: 0.001 },
          turns: [
            { role: "user", text: "hi", ts: 0, events: [] },
            { role: "agent", text: "Hello & welcome", ts: 0, events: [], latencyMs: 0 },
          ],
        }),
        [cellKey("s1", 1)]: cell({
          usage: { inputTokens: 50, outputTokens: 20, cost: 0.006 },
          turns: [
            { role: "user", text: "hi", ts: 0, events: [] },
            { role: "agent", text: "Hello & welcome", ts: 0, events: [], latencyMs: 2000 },
          ],
        }),
      },
    };
    const out = buildReportHtml(slow);
    // An instant, non-diverging model's effective cost equals its raw cost.
    expect(out).toContain(
      "incumbent-model has the best cost-to-performance in this study: $0.0010 effective cost " +
        "($0.0010/conversation, 0.0s p95, 0% of scenarios diverging)",
    );
    expect(out).toContain("12.0× more cost-efficient than the next best, candidate-model");
    expect(out).not.toContain("could not be ranked");
    expect(out).not.toContain("ceiling");
  });

  it("reports plainly when no model has cost data", () => {
    const noCost: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell({ usage: { inputTokens: 50, outputTokens: 20 } }),
        [cellKey("s1", 1)]: cell({ usage: { inputTokens: 50, outputTokens: 20 } }),
      },
    };
    expect(buildReportHtml(noCost)).toContain(
      "No model in this study reports a dollar cost, so cost-to-performance can't be ranked",
    );
  });

  it("explains the score as absolute, not relative to any column", () => {
    expect(html).toContain("the score is absolute — it does not depend on which models happen to be in the study");
    expect(html).not.toContain("agent you run today is 1.00");
  });

  it("still scores column 1 when column 0 has no completed cells", () => {
    // No column is privileged, so an empty first column must not suppress
    // the score for whichever column actually ran.
    const emptyFirst: Study = {
      ...study,
      cells: { [cellKey("s1", 1)]: cell() },
    };
    const out = buildReportHtml(emptyFirst);
    expect(out).toContain('<div class="headline">');
    expect(out).toContain("candidate-model has the best cost-to-performance in this study");
  });

  it("scores a single model on its own, with no comparison implied", () => {
    const solo: Study = {
      ...study,
      models: ["incumbent-model"],
      cells: { [cellKey("s1", 0)]: cell() },
    };
    const out = buildReportHtml(solo);
    expect(out).toContain("incumbent-model has the best cost-to-performance in this study");
    // Nothing to be more cost-efficient than, so that clause is absent.
    expect(out).not.toContain("more cost-efficient than the next best");
  });

  it("omits the headline entirely when nothing has completed", () => {
    const nothingRan: Study = {
      ...study,
      cells: {},
    };
    expect(buildReportHtml(nothingRan)).not.toContain('<div class="headline">');
  });
});
