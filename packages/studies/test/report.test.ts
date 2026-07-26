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
  monthlyConversations: 30000,
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

  it("projects measured per-conversation cost at the stated monthly volume", () => {
    // one done cell at $0.01 → $0.01/conversation, $300.00 at 30k conv/mo
    expect(html).toContain("$0.01");
    expect(html).toContain("$300.00");
    expect(html).toContain("30,000 conversations/month");
  });

  it("marks the incumbent row and flags divergent columns", () => {
    expect(html).toContain("current");
    expect(html).toContain("diverges");
  });

  it("never inlines the prompt text — only its length", () => {
    expect(html).not.toContain("You are Asha.");
    expect(html).toContain("prompt run verbatim");
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
});
