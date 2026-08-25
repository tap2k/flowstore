import { describe, it, expect } from "vitest";
import { buildReportHtml } from "../src/report";
import type { CellState, Study } from "../src/types";
import { cellKey } from "../src/types";

// The runner copies the scenario script into the transcript verbatim, so the
// fixture keeps the two in sync — the report draws caller lines from the
// script and agent replies from the transcript.
const CALLER = "hi <script>alert(1)</script>";

const cell = (over: Partial<CellState> = {}): CellState => ({
  status: "done",
  totalMs: 1000,
  usage: { inputTokens: 50, outputTokens: 20, cost: 0.01 },
  turns: [
    { role: "user", text: CALLER, ts: 0, events: [] },
    { role: "agent", text: "Hello & welcome", ts: 0, events: [], latencyMs: 900 },
  ],
  ...over,
});

const study: Study = {
  title: "Clinic study <unsafe>",
  prompt: "You are Asha.",
  models: ["incumbent-model", "candidate-model"],
  scenarios: [
    { id: "s1", scenarioId: "s1", name: "Reschedule <b>fast</b>", language: "EN", turns: [CALLER] },
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

  it("never inlines the prompt text", () => {
    expect(html).not.toContain("You are Asha.");
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

  // ------------------------------------------------------------- no verdict

  it("names no best model anywhere — the reader draws the conclusion", () => {
    expect(html).not.toContain("headline");
    expect(html).not.toContain("cost-to-performance");
    expect(html).not.toContain("effective cost");
    expect(html).not.toContain("Top performer");
    expect(html).not.toContain("How to read the score");
  });

  // ------------------------------------------------------------- latency

  it("reports the latency distribution, not just the mean", () => {
    expect(html).toContain(">Latency<");
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

  it("plots each model on the response-time chart with p50, p95 and max", () => {
    expect(html).toContain('class="chart"');
    expect(html).toContain("dot p50");
    expect(html).toContain("dot p95");
    expect(html).toContain('class="tick');
    expect(html).toContain("max — the single slowest reply");
    // The interrupt reference line, drawn but never used to score or exclude.
    expect(html).toContain("2s — the point a caller starts talking over the agent");
  });

  it("scales the chart axis to the slowest reply, with a 2s floor", () => {
    const slow: Study = {
      ...study,
      models: ["only-model"],
      cells: {
        [cellKey("s1", 0)]: cell({
          turns: [{ role: "agent", text: "x", ts: 0, events: [], latencyMs: 4600 }],
        }),
      },
    };
    // 4.6s rounds the axis up to 5s, so a 5s tick exists and 4s is not the top.
    expect(buildReportHtml(slow)).toContain(">5s<");
    // A fast study still shows the 2s mark rather than collapsing the axis.
    expect(html).toContain(">2s<");
  });

  // ---------------------------------------------------------------- cost

  it("draws a cost bar per model and marks the cheapest", () => {
    const spread: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.02 } }),
        [cellKey("s1", 1)]: cell({ usage: { inputTokens: 50, outputTokens: 20, cost: 0.01 } }),
      },
    };
    const out = buildReportHtml(spread);
    expect(out).toContain("Cost per conversation");
    // Dearest model sets the scale at 100%, the other is drawn proportionally.
    expect(out).toContain('style="width:100.00%"');
    expect(out).toContain('style="width:50.00%"');
    expect(out).toContain('class="c-val good"');
  });

  it("carries words per reply beside tokens", () => {
    expect(html).toContain("Words<br><span>/reply</span>");
  });

  // ----------------------------------------------------------- divergence

  it("tabulates every scenario as matching or diverging, per model", () => {
    expect(html).toContain("Divergence vs current agent");
    expect(html).toContain('class="pill ok">matches');
    expect(html).toContain('class="pill warn" href="#d0">diverges');
  });

  it("marks a cell that never completed as no run rather than as matching", () => {
    const partial: Study = {
      ...study,
      cells: { [cellKey("s1", 0)]: cell() },
    };
    expect(buildReportHtml(partial)).toContain('class="pill none">no run');
  });

  it("shows the full conversation for flagged scenarios, anchored from the table", () => {
    expect(html).toContain('id="d0"');
    expect(html).toContain('class="convo"');
    // The caller line appears once per turn, not once per model column.
    expect(html.match(/class="caller"/g)?.length).toBe(1);
  });

  it("points at the first diverging reply inside a flagged column", () => {
    // The base fixture flags the cell but both models say the same thing, so
    // there is no diverging LINE to point at — the marker needs real drift.
    expect(html).not.toContain("first divergence from current");
    const diverging: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell(),
        [cellKey("s1", 1)]: cell({
          divergent: true,
          turns: [
            { role: "user", text: CALLER, ts: 0, events: [] },
            { role: "agent", text: "totally different wording entirely", ts: 0, events: [] },
          ],
        }),
      },
    };
    expect(buildReportHtml(diverging)).toContain("first divergence from current");
  });

  it("falls back to every scenario when nothing is flagged, so evidence is never empty", () => {
    const clean: Study = {
      ...study,
      cells: {
        [cellKey("s1", 0)]: cell(),
        [cellKey("s1", 1)]: cell(),
      },
    };
    const out = buildReportHtml(clean);
    expect(out).toContain('class="convo"');
    expect(out).not.toContain("diverges");
  });

  it("labels a missing reply instead of silently shortening the conversation", () => {
    const short: Study = {
      ...study,
      scenarios: [{ ...study.scenarios[0], turns: [CALLER, "and another thing"] }],
      cells: {
        [cellKey("s1", 0)]: cell(),
        [cellKey("s1", 1)]: cell({ divergent: true }),
      },
    };
    expect(buildReportHtml(short)).toContain("no reply");
  });

  // ------------------------------------------------------------ languages

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
    expect(out).toContain("2</span>languages");
    // Models are the rows, languages the columns, average latency only — the
    // distribution belongs to the chart, so this table carries no percentiles.
    const langTable = out.slice(out.indexOf("Speed by language"));
    const head = langTable.slice(0, langTable.indexOf("</thead>"));
    expect(head).toContain("English");
    expect(head).toContain("Spanish");
    expect(head).not.toContain("p95");
    expect(head).not.toContain("avg");
    expect(langTable).toContain('class="mdl">incumbent-model');
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

  // --------------------------------------------------------------- print

  it("flips the colour tokens for print so a dark report is not printed blank", () => {
    // Whitening the page while leaving near-white text would print nothing.
    expect(html).toContain("@media print");
    expect(html).toContain("--fg:#18181b");
    expect(html).toContain("--bg:#fff");
  });
});
