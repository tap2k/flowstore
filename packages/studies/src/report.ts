import type { CellState, Study } from "./types";
import { cellKey } from "./types";
import { SPEECH_WPM, estimateVoiceCost } from "./voiceCost";
import { estimateLiveCost } from "./liveRates";

// Self-contained HTML report — the forwardable artifact. Audience: the
// agency's client/buyer, not the person who ran the study. Contents: summary
// (per-model latency, tokens, measured cost), then per-scenario side-by-side
// transcripts. Inline CSS only; no external requests; prints cleanly.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fmtMoney(n: number): string {
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

// opts let the surface own surface-specific copy (the browser page claims
// "runs in your browser"; a CLI must not). Defaults are surface-neutral.
export function buildReportHtml(
  study: Study,
  opts: { latencyNote?: string; footer?: string } = {},
): string {
  const { models, scenarios, cells } = study;
  const rates = study.voiceRates ?? {};
  const withVoice = rates.asrPerMin !== undefined || rates.ttsPerMChars !== undefined;
  const latencyNote =
    opts.latencyNote ??
    "Latency measured client-side at run time; production latency depends on deployment.";
  const footer =
    opts.footer ??
    'Do you want to run studies like this on your own prompts and agents? Try the tool — <a href="https://create.flowstore.org/compare">create.flowstore.org/compare</a>.';
  const date = new Date().toISOString().slice(0, 10);

  const perModel = models.map((m, mi) => {
    const modelCells = scenarios
      .map((s) => cells[cellKey(s.id, mi)])
      .filter((c): c is CellState => !!c && c.status === "done");
    const replies = modelCells.flatMap((c) =>
      c.turns.filter((t) => t.role === "agent" && t.latencyMs !== undefined),
    );
    const avgLatency =
      replies.length > 0
        ? replies.reduce((a, t) => a + (t.latencyMs ?? 0), 0) / replies.length / 1000
        : undefined;
    const tokensIn = modelCells.reduce((a, c) => a + (c.usage?.inputTokens ?? 0), 0);
    const tokensOut = modelCells.reduce((a, c) => a + (c.usage?.outputTokens ?? 0), 0);
    const audioIn = modelCells.reduce((a, c) => a + (c.usage?.audioInputTokens ?? 0), 0);
    const audioOut = modelCells.reduce((a, c) => a + (c.usage?.audioOutputTokens ?? 0), 0);
    const costs = modelCells.map((c) => c.usage?.cost).filter((x): x is number => x !== undefined);
    const costPerConv =
      costs.length === modelCells.length && modelCells.length > 0
        ? costs.reduce((a, b) => a + b, 0) / modelCells.length
        : undefined;
    // S2S columns: no provider-reported dollars — estimate from measured
    // tokens × Live rates, shown with "~" to keep measured/modeled apart.
    const liveEsts = modelCells
      .map((c) => estimateLiveCost(c.usage, m))
      .filter((x): x is number => x !== null);
    const liveEstPerConv =
      costPerConv === undefined && liveEsts.length === modelCells.length && modelCells.length > 0
        ? liveEsts.reduce((a, b) => a + b, 0) / modelCells.length
        : undefined;
    const divergent = scenarios.filter((s) => cells[cellKey(s.id, mi)]?.divergent).length;
    // Estimated cascade voice cost per conversation, averaged over done cells.
    const voiceEstimates = withVoice
      ? modelCells
          .map((c) => estimateVoiceCost(c.turns, c.usage?.cost, rates))
          .filter((e): e is NonNullable<typeof e> => e !== null)
      : [];
    const voicePerConv =
      voiceEstimates.length > 0
        ? voiceEstimates.reduce((a, e) => a + e.total, 0) / voiceEstimates.length
        : undefined;
    return { model: m, mi, avgLatency, tokensIn, tokensOut, audioIn, audioOut, costPerConv, liveEstPerConv, voicePerConv, divergent, n: modelCells.length };
  });
  const withLiveEst = perModel.some((r) => r.liveEstPerConv !== undefined);

  const summaryRows = perModel
    .map((r) => {
      const isInc = r.mi === 0;
      return `<tr${isInc ? ' class="inc"' : ""}>
        <td>${esc(r.model)}${isInc ? ' <span class="tag">current</span>' : ""}</td>
        <td>${r.n}/${scenarios.length}</td>
        <td>${isInc ? "—" : r.divergent > 0 ? `${r.divergent} scenario${r.divergent > 1 ? "s" : ""}` : "none flagged"}</td>
        <td>${r.avgLatency !== undefined ? r.avgLatency.toFixed(1) + "s" : "—"}</td>
        <td>${r.tokensIn.toLocaleString()} / ${r.tokensOut.toLocaleString()}${r.audioIn + r.audioOut > 0 ? `<span class="sub">audio ${r.audioIn.toLocaleString()} / ${r.audioOut.toLocaleString()}</span>` : ""}</td>
        <td>${r.costPerConv !== undefined ? fmtMoney(r.costPerConv) : r.liveEstPerConv !== undefined ? "~" + fmtMoney(r.liveEstPerConv) : "n/a*"}</td>
        ${withVoice ? `<td>${r.voicePerConv !== undefined ? "≈" + fmtMoney(r.voicePerConv) : "n/a*"}</td>` : ""}
      </tr>`;
    })
    .join("\n");

  const scenarioSections = scenarios
    .map((s) => {
      const cols = models
        .map((m, mi) => {
          const c = cells[cellKey(s.id, mi)];
          const turns = (c?.turns ?? [])
            .map((t) =>
              t.role === "user"
                ? `<div class="u">${esc(t.text)}</div>`
                : `<div class="a">${esc(t.text)}${t.latencyMs !== undefined ? `<span class="lat">${(t.latencyMs / 1000).toFixed(1)}s</span>` : ""}</div>`,
            )
            .join("\n");
          const flag = c?.divergent ? ' <span class="flag">diverges</span>' : "";
          return `<div class="col"><h4>${esc(m)}${flag}</h4>${turns || '<div class="none">no run</div>'}</div>`;
        })
        .join("\n");
      return `<section><h3>${esc(s.name)} <span class="lang">${esc(s.language)}</span></h3><div class="cols">${cols}</div></section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(study.title)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b;margin:0;background:#fff}
  .page{max-width:960px;margin:0 auto;padding:32px 24px}
  h1{font-size:20px;margin:0 0 4px} .meta{color:#71717a;font-size:12px;margin-bottom:24px}
  h2{font-size:14px;margin:28px 0 8px} h3{font-size:13px;margin:22px 0 8px}
  h4{font-size:11px;margin:0 0 6px;color:#3f3f46} .lang{color:#a1a1aa;font-weight:400}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{border:1px solid #e4e4e7;padding:6px 8px;text-align:left}
  th{background:#fafafa;font-weight:600} tr.inc td{background:#fafafa}
  .tag{font-size:10px;color:#71717a;border:1px solid #d4d4d8;border-radius:9999px;padding:0 6px}
  .flag{font-size:10px;color:#92400e;background:#fef3c7;border-radius:9999px;padding:1px 6px;font-weight:400}
  .cols{display:flex;gap:12px;overflow-x:auto}
  .col{flex:1;min-width:220px;border:1px solid #e4e4e7;border-radius:8px;padding:10px;font-size:12px}
  .u{background:#18181b;color:#fff;border-radius:8px;padding:6px 9px;margin:6px 0 6px 24px}
  .a{border:1px solid #e4e4e7;border-radius:8px;padding:6px 9px;margin:6px 24px 6px 0;position:relative}
  .lat{display:block;color:#a1a1aa;font-size:10px;margin-top:3px}
  .sub{display:block;color:#a1a1aa;font-size:10px}
  .none{color:#a1a1aa;font-style:italic}
  .note{color:#71717a;font-size:11px;margin-top:6px}
  footer{margin-top:36px;border-top:1px solid #e4e4e7;padding-top:14px;font-size:12px;color:#52525b}
  footer a{color:#18181b}
  @media print{.cols{overflow:visible}}
</style></head><body><div class="page">
<h1>${esc(study.title)}</h1>
<div class="meta">${date} · ${models.length} models · ${scenarios.length} scenarios · prompt ${study.prompt.length.toLocaleString()} chars</div>
<h2>Summary</h2>
<table><thead><tr><th>Model</th><th>Completed</th><th>Divergence vs current</th><th>Avg latency/reply</th><th>Tokens in/out</th><th>Cost/conversation</th>${withVoice ? "<th>Est. voice cost/conv</th>" : ""}</tr></thead>
<tbody>${summaryRows}</tbody></table>
<div class="note">*Measured dollar cost is reported by OpenRouter-routed models; direct-provider runs show tokens only. ${latencyNote} Divergence is a lexical signal marking where to read — it is not a pass/fail verdict; read the transcripts.${
    withLiveEst
      ? " S2S cost (~) is estimated: measured audio/text tokens × published Gemini Live rates — the provider reports tokens, not dollars. S2S latency/reply is time-to-first-audio; the audio itself streams near real time beyond that."
      : ""
  }${
    withVoice
      ? ` Voice estimate (≈): measured LLM cost${rates.ttsPerMChars !== undefined ? ` + TTS at $${rates.ttsPerMChars}/1M characters over the agent's transcript characters` : ""}${rates.asrPerMin !== undefined ? ` + ASR at $${rates.asrPerMin}/min over caller speech time` : ""}; speech time is modeled at ~${SPEECH_WPM} wpm. ASR billed on session duration (rather than caller speech) runs higher.`
      : ""
  }</div>
<h2>Example transcripts</h2>
${scenarioSections}
<footer>${footer}</footer>
</div></body></html>`;
}
