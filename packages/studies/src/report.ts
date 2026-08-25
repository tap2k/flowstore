import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { CellState, Scenario, Study } from "./types";
import { cellKey } from "./types";
import { DIVERGENCE_THRESHOLD, divergence } from "./runner";

// Self-contained HTML report — the forwardable artifact. Audience: the
// agency's client/buyer, not the person who ran the study. Contents: a
// one-line headline, summary (per-model latency distribution, tokens,
// measured cost), an optional per-language speed table, then per-scenario
// side-by-side transcripts. Inline CSS only; no external requests; prints
// cleanly (columns stack).
//
// Voice framing: this is a real-time medium, so the latency columns lead with
// the distribution rather than the mean alone — a model that averages 0.9s
// with a 4.5s p95 loses calls the mean says it wins.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fmtMoney(n: number): string {
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

// Scenario languages are authored free-form — usually a BCP-47 tag ("EN",
// "pt-BR"), occasionally a name already. Codes get expanded for the reader,
// because "ES" tells a buyer nothing and "Spanish" tells them everything.
// Anything Intl cannot resolve, or that is not a well-formed tag at all,
// passes through exactly as the author wrote it.
let langNames: Intl.DisplayNames | null | undefined;
function languageName(lang: string): string {
  if (langNames === undefined) {
    try {
      langNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
    } catch {
      langNames = null;
    }
  }
  if (langNames === null) return lang;
  try {
    return langNames.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

// Nearest-rank percentile over an ascending array. Reply counts here are
// small (scenarios × turns), so no interpolation — the reported p95 is a
// latency that actually happened, not one synthesized between samples.
function pct(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))];
}

const mean = (xs: number[]): number | undefined =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

// Latency stats over the agent replies of a set of cells. Only replies that
// actually recorded a dispatch time count.
function latencyStats(cells: CellState[]) {
  const lat = cells
    .flatMap((c) => c.turns.filter((t) => t.role === "agent"))
    .map((t) => t.latencyMs)
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);
  return {
    n: lat.length,
    avg: mean(lat),
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    max: lat.length > 0 ? lat[lat.length - 1] : undefined,
  };
}

// Lowest value in a column, for emphasis — but only when there is a real
// comparison to make (two or more models, and not all tied).
function bestOf(vals: (number | undefined)[]): number | undefined {
  const d = vals.filter((x): x is number => x !== undefined);
  if (d.length < 2 || new Set(d).size < 2) return undefined;
  return Math.min(...d);
}

type ModelSummary = {
  model: string;
  mi: number;
  lat: ReturnType<typeof latencyStats>;
  costPerConv?: number;
  divergentIdx: number[];
  n: number;
};

// The reference a p95 reply time is scaled against — not derived from any
// model in the study, but from the same voice-UX fact this report's latency
// section is built around: callers start talking over the agent at around
// two seconds of silence. It is a straight multiplier, not a bounded score:
// a p95 at this mark doubles the model's effective cost, one at double the
// mark triples it, and a p95 of 0 leaves cost untouched. No clamping, no
// "undefined past the ceiling" case — it stays defined and keeps climbing
// however slow a model gets, so nothing here needs to exclude a model from
// ranking the way a bounded 0-to-1 score would.
const VOICE_LATENCY_REFERENCE_MS = 2000;

type Score = {
  // Cost per conversation, scaled up by how slow the model is and by how
  // often it diverges. Undefined only when the model has no cost figure —
  // latency and divergence always resolve (0 replies -> 0 scenarios diverge),
  // so cost is the sole reason a model goes unranked.
  value: number | undefined;
  divRate: number;
};

// Scores each model entirely on its own numbers — no incumbent, no column
// privileged as "current." Cost is the base; latency and divergence each
// scale it up, multiplicatively, so a model that is merely a little slow and
// a model that both diverges AND runs slow are not scored as if those two
// problems just add — they compound, the way they would for someone actually
// paying for the bad conversations.
function scoreModels(perModel: ModelSummary[], scenarioCount: number): Score[] {
  return perModel.map((r) => {
    const latMultiplier = r.lat.p95 !== undefined ? 1 + r.lat.p95 / VOICE_LATENCY_REFERENCE_MS : undefined;
    const divRate = scenarioCount > 0 ? r.divergentIdx.length / scenarioCount : 0;
    const value =
      r.costPerConv !== undefined && latMultiplier !== undefined
        ? r.costPerConv * latMultiplier * (1 + divRate)
        : undefined;
    return { value, divRate };
  });
}

// One-line takeaway for the top of the report, entirely arithmetic over numbers
// the summary table already shows — no LLM call, so it can never contradict the
// table beneath it and costs nothing to generate on download. Names whichever
// model has the lowest score; a model with no cost figure is named as
// excluded rather than silently dropped.
function buildHeadline(perModel: ModelSummary[], scenarios: Scenario[]): string | undefined {
  const ran = perModel.filter((r) => r.n > 0);
  if (ran.length === 0) return undefined;
  const scores = scoreModels(perModel, scenarios.length);

  const ranked = perModel
    .map((r, i) => ({ r, s: scores[i] }))
    .filter((x): x is { r: ModelSummary; s: Score & { value: number } } => x.s.value !== undefined)
    .sort((a, b) => a.s.value - b.s.value);

  const unranked = perModel.filter((r, i) => r.n > 0 && scores[i].value === undefined);

  if (ranked.length === 0) {
    return "No model in this study reports a dollar cost, so cost-to-performance can't be ranked.";
  }

  const top = ranked[0];
  const divPct = (top.s.divRate * 100).toFixed(0);
  let line =
    `${esc(top.r.model)} has the best cost-to-performance in this study: ` +
    `${fmtMoney(top.s.value)} effective cost ` +
    `(${fmtMoney(top.r.costPerConv!)}/conversation, ${fmtSec(top.r.lat.p95!)} p95, ${divPct}% of scenarios diverging).`;

  if (ranked.length > 1) {
    const runnerUp = ranked[1];
    const mult = runnerUp.s.value / top.s.value;
    if (mult >= 1.05) {
      line += ` That's ${mult.toFixed(1)}× more cost-efficient than the next best, ${esc(runnerUp.r.model)}.`;
    }
  }

  if (unranked.length > 0) {
    line += ` ${unranked.length} model${unranked.length > 1 ? "s" : ""} could not be ranked — read the table below.`;
  }

  return line;
}

// The score is a number the reader has never seen before, so it never ships
// without this. Deliberately a visible line rather than a hover tooltip: the
// report is forwarded and printed to PDF, where there is nothing to hover.
export const SCORE_EXPLAINER =
  "How to read the score: it starts from cost per conversation, then scales that cost up for " +
  "slower replies and for answers that diverge. A p95 of two seconds doubles the effective cost, " +
  "one second adds half again, and so on — there is no cutoff, slower always costs more. Each " +
  "scenario where the model's behaviour diverges adds its own share on top. Lower is better, and " +
  "the score is absolute — it does not depend on which models happen to be in the study.";

// First agent reply where the candidate departs from the incumbent, by turn
// ordinal — the same lexical measure the runner uses for the cell verdict,
// applied one turn at a time so the reader is pointed at a line rather than
// asked to diff two transcripts by eye.
function firstDivergentReply(
  inc: TranscriptTurn[] | undefined,
  cand: TranscriptTurn[],
): number | undefined {
  if (!inc) return undefined;
  const ia = inc.filter((t) => t.role === "agent");
  const ca = cand.filter((t) => t.role === "agent");
  for (let i = 0; i < ca.length; i++) {
    if (!ia[i]) return i;
    if (divergence([ia[i]], [ca[i]]) > DIVERGENCE_THRESHOLD) return i;
  }
  return undefined;
}

// opts let the surface own surface-specific copy (the browser page claims
// "runs in your browser"; a CLI must not). Defaults are surface-neutral.
export function buildReportHtml(
  study: Study,
  opts: { latencyNote?: string; footer?: string } = {},
): string {
  const { models, scenarios, cells } = study;
  const latencyNote =
    opts.latencyNote ??
    "Latency measured client-side at run time; production latency depends on deployment.";
  const footer =
    opts.footer ??
    'Do you want to run studies like this on your own prompts and agents? Try the tool — <a href="https://create.flowstore.org/compare">create.flowstore.org/compare</a>.';
  const date = new Date().toISOString().slice(0, 10);

  const doneCells = (mi: number, subset = scenarios) =>
    subset
      .map((s) => cells[cellKey(s.id, mi)])
      .filter((c): c is CellState => !!c && c.status === "done");

  // Languages present, in first-appearance order. The per-language table is a
  // multilingual-only concern: with one language it would restate the summary.
  const languages = [...new Set(scenarios.map((s) => s.language))];
  const multiLang = languages.length > 1;

  const perModel = models.map((m, mi) => {
    const modelCells = doneCells(mi);
    const lat = latencyStats(modelCells);
    const tokensIn = modelCells.reduce((a, c) => a + (c.usage?.inputTokens ?? 0), 0);
    const tokensOut = modelCells.reduce((a, c) => a + (c.usage?.outputTokens ?? 0), 0);
    const costs = modelCells.map((c) => c.usage?.cost).filter((x): x is number => x !== undefined);
    const costPerConv =
      costs.length === modelCells.length && modelCells.length > 0
        ? costs.reduce((a, b) => a + b, 0) / modelCells.length
        : undefined;
    // Spoken length of a reply — secondary to cost, but on a call an extra 30
    // words is airtime the caller sits through before they can barge in.
    const replies = modelCells.flatMap((c) => c.turns.filter((t) => t.role === "agent"));
    const wordsPerReply =
      replies.length > 0
        ? replies.reduce((a, t) => a + wordCount(t.text), 0) / replies.length
        : undefined;
    const divergentIdx = scenarios
      .map((s, si) => (cells[cellKey(s.id, mi)]?.divergent ? si : -1))
      .filter((i) => i >= 0);
    return {
      model: m,
      mi,
      lat,
      tokensIn,
      tokensOut,
      costPerConv,
      wordsPerReply,
      divergentIdx,
      n: modelCells.length,
    };
  });

  const headline = buildHeadline(perModel, scenarios);

  const best = {
    avg: bestOf(perModel.map((r) => r.lat.avg)),
    p50: bestOf(perModel.map((r) => r.lat.p50)),
    p95: bestOf(perModel.map((r) => r.lat.p95)),
    max: bestOf(perModel.map((r) => r.lat.max)),
    cost: bestOf(perModel.map((r) => r.costPerConv)),
  };

  // Numeric cell: right-aligned, tabular figures, emphasised when it wins.
  const num = (text: string, v?: number, winner?: number) =>
    `<td class="n${v !== undefined && v === winner ? " best" : ""}">${text}</td>`;

  const summaryRows = perModel
    .map((r) => {
      const isInc = r.mi === 0;
      const div = isInc
        ? "—"
        : r.divergentIdx.length > 0
          ? `<a href="#sc-${r.divergentIdx[0]}">${r.divergentIdx.length} scenario${r.divergentIdx.length > 1 ? "s" : ""}</a>`
          : "none flagged";
      return `<tr${isInc ? ' class="inc"' : ""}>
        <td class="mdl">${esc(r.model)}${isInc ? ' <span class="tag">current</span>' : ""}</td>
        <td class="n">${r.n}/${scenarios.length}</td>
        <td>${div}</td>
        ${num(r.lat.avg !== undefined ? fmtSec(r.lat.avg) : "—", r.lat.avg, best.avg)}
        ${num(r.lat.p50 !== undefined ? fmtSec(r.lat.p50) : "—", r.lat.p50, best.p50)}
        ${num(r.lat.p95 !== undefined ? fmtSec(r.lat.p95) : "—", r.lat.p95, best.p95)}
        ${num(r.lat.max !== undefined ? fmtSec(r.lat.max) : "—", r.lat.max, best.max)}
        <td class="n">${r.tokensIn.toLocaleString()} / ${r.tokensOut.toLocaleString()}${
          r.wordsPerReply !== undefined
            ? `<span class="sub">≈${Math.round(r.wordsPerReply)} words/reply</span>`
            : ""
        }</td>
        ${num(r.costPerConv !== undefined ? fmtMoney(r.costPerConv) : "n/a*", r.costPerConv, best.cost)}
      </tr>`;
    })
    .join("\n");

  // Per-language speed: same latency measure, sliced by the language the
  // scenario was written in. Multilingual only.
  const languageSection = !multiLang
    ? ""
    : (() => {
        const rows = languages
          .map((lang) => {
            const subset = scenarios.filter((s) => s.language === lang);
            const stats = models.map((_, mi) => latencyStats(doneCells(mi, subset)));
            const bAvg = bestOf(stats.map((s) => s.avg));
            const bP95 = bestOf(stats.map((s) => s.p95));
            const tds = stats
              .map(
                (s) =>
                  `${num(s.avg !== undefined ? fmtSec(s.avg) : "—", s.avg, bAvg)}${num(
                    s.p95 !== undefined ? fmtSec(s.p95) : "—",
                    s.p95,
                    bP95,
                  )}`,
              )
              .join("");
            return `<tr><td class="mdl">${esc(languageName(lang))} <span class="sub-inline">${subset.length} scenario${subset.length > 1 ? "s" : ""}</span></td>${tds}</tr>`;
          })
          .join("\n");
        const group = models
          .map((m) => `<th colspan="2" class="grp">${esc(m)}</th>`)
          .join("");
        const sub = models.map(() => `<th class="n">avg</th><th class="n">p95</th>`).join("");
        return `<h2>Speed by language</h2>
<div class="tw"><table class="summary"><thead><tr><th rowspan="2">Language</th>${group}</tr><tr>${sub}</tr></thead>
<tbody>${rows}</tbody></table></div>
<div class="note">Latency per reply, restricted to scenarios written in that language. A model that holds its speed in one language and slips in another shows up here and nowhere else.</div>`;
      })();

  const tocRows = scenarios
    .map((s, si) => {
      const flagged = models
        .map((m, mi) => (mi > 0 && cells[cellKey(s.id, mi)]?.divergent ? m : null))
        .filter((m): m is string => m !== null);
      return `<li><a href="#sc-${si}">${esc(s.name)}</a> <span class="lang">${esc(languageName(s.language))}</span>${
        flagged.length > 0
          ? ` <span class="flag">diverges: ${flagged.map(esc).join(", ")}</span>`
          : ""
      }</li>`;
    })
    .join("\n");

  const scenarioSections = scenarios
    .map((s, si) => {
      const inc = cells[cellKey(s.id, 0)];
      const cols = models
        .map((m, mi) => {
          const c = cells[cellKey(s.id, mi)];
          const markAt =
            mi > 0 && c?.divergent ? firstDivergentReply(inc?.turns, c.turns ?? []) : undefined;
          let ai = -1;
          const turns = (c?.turns ?? [])
            .map((t) => {
              if (t.role === "user") return `<div class="u">${esc(t.text)}</div>`;
              ai++;
              const hit = ai === markAt;
              return `<div class="a${hit ? " d" : ""}">${esc(t.text)}${
                t.latencyMs !== undefined
                  ? `<span class="lat">${(t.latencyMs / 1000).toFixed(1)}s</span>`
                  : ""
              }${hit ? '<span class="dmark">first divergence from current</span>' : ""}</div>`;
            })
            .join("\n");
          const flag = c?.divergent ? ' <span class="flag">diverges</span>' : "";
          return `<div class="col"><h4>${esc(m)}${mi === 0 ? ' <span class="tag">current</span>' : ""}${flag}</h4>${turns || '<div class="none">no run</div>'}</div>`;
        })
        .join("\n");
      return `<section id="sc-${si}"><h3>${esc(s.name)} <span class="lang">${esc(languageName(s.language))}</span> <a class="top" href="#toc">↑ index</a></h3><div class="cols">${cols}</div></section>`;
    })
    .join("\n");

  const latCols = 4;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(study.title)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b;margin:0;background:#fff}
  .page{max-width:1040px;margin:0 auto;padding:32px 24px}
  h1{font-size:23px;letter-spacing:-.01em;margin:0 0 5px} .meta{color:#71717a;font-size:12px;margin-bottom:18px}
  .headline{font-size:14px;font-weight:600;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:10px 14px}
  .headline-note{font-size:11px;line-height:17px;color:#71717a;margin:6px 2px 26px}
  h2{font-size:15px;margin:34px 0 10px;padding-bottom:5px;border-bottom:1px solid #e4e4e7}
  h3{font-size:13px;margin:24px 0 8px}
  h4{font-size:11px;margin:0 0 6px;color:#3f3f46} .lang{color:#a1a1aa;font-weight:400}
  a{color:#18181b}
  .tw{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:12px}
  table.summary{min-width:760px}
  th,td{border:1px solid #e4e4e7;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#e4e4e7;color:#27272a;font-weight:600;white-space:nowrap}
  th.grp{text-align:center;border-bottom-color:#d4d4d8}
  table.summary{font-size:13px}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;padding:6px 7px;white-space:nowrap}
  td.best{font-weight:700}
  td.mdl{font-weight:600;white-space:nowrap}
  tr.inc td{background:#fafafa} tr.inc td:first-child{box-shadow:inset 3px 0 0 #18181b}
  .sub{display:block;color:#a1a1aa;font-size:10px;font-weight:400;margin-top:2px}
  .sub-inline{color:#a1a1aa;font-size:10px;font-weight:400}
  .tag{font-size:10px;color:#71717a;border:1px solid #d4d4d8;border-radius:9999px;padding:0 6px;font-weight:400}
  .flag{font-size:10px;color:#92400e;background:#fef3c7;border-radius:9999px;padding:1px 6px;font-weight:400}
  ol.toc{font-size:12px;margin:0;padding-left:20px;color:#52525b} ol.toc li{margin:3px 0}
  .top{float:right;font-size:10px;color:#a1a1aa;text-decoration:none;font-weight:400}
  .cols{display:flex;gap:12px;overflow-x:auto}
  .col{flex:1;min-width:220px;border:1px solid #e4e4e7;border-radius:8px;padding:10px;font-size:12px}
  .u{background:#18181b;color:#fff;border-radius:8px;padding:6px 9px;margin:6px 0 6px 24px}
  .a{border:1px solid #e4e4e7;border-radius:8px;padding:6px 9px;margin:6px 24px 6px 0;position:relative}
  .a.d{border-color:#fcd34d;background:#fffbeb}
  .lat{display:block;color:#a1a1aa;font-size:10px;margin-top:3px}
  .dmark{display:block;color:#92400e;font-size:10px;margin-top:3px}
  .none{color:#a1a1aa;font-style:italic}
  .note{color:#71717a;font-size:11px;margin-top:6px}
  footer{margin-top:36px;border-top:1px solid #e4e4e7;padding-top:14px;font-size:12px;color:#52525b}
  @media print{
    .page{max-width:none;padding:0}
    .tw{overflow:visible} table.summary{min-width:0;font-size:10px}
    th,td{padding:3px 5px} td.n,th.n,td.mdl{white-space:normal}
    .cols{display:block;overflow:visible}
    .col{margin:0 0 8px;break-inside:avoid;page-break-inside:avoid}
    section{break-inside:auto} h3{break-after:avoid}
    .top{display:none} a{text-decoration:none}
  }
</style></head><body><div class="page">
<h1>${esc(study.title)}</h1>
<div class="meta">${date} · ${models.length} models · ${scenarios.length} scenarios${multiLang ? ` · ${languages.length} languages` : ""} · prompt ${study.prompt.length.toLocaleString()} chars</div>
${headline ? `<div class="headline">${headline}</div><div class="headline-note">${SCORE_EXPLAINER}</div>` : ""}
<h2>Summary</h2>
<div class="tw"><table class="summary"><thead>
<tr><th rowspan="2">Model</th><th rowspan="2" class="n">Completed</th><th rowspan="2">Divergence vs current</th><th colspan="${latCols}" class="grp">Latency per reply</th><th rowspan="2" class="n">Tokens in/out</th><th rowspan="2" class="n">Cost/conversation</th></tr>
<tr><th class="n">avg</th><th class="n">p50</th><th class="n">p95</th><th class="n">max</th></tr>
</thead>
<tbody>${summaryRows}</tbody></table></div>
<div class="note">*Measured dollar cost is reported by OpenRouter-routed models; direct-provider runs show tokens only. ${latencyNote} Percentiles are over individual agent replies (nearest-rank), so p95 and max are latencies that actually occurred — on a call the tail is what the caller notices, not the average. Divergence is a lexical signal marking where to read — it is not a pass/fail verdict; read the transcripts.</div>
${languageSection}
<h2 id="toc">Example transcripts</h2>
<ol class="toc">${tocRows}</ol>
${scenarioSections}
<footer>${footer}</footer>
</div></body></html>`;
}
