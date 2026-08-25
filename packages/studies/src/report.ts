import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { CellState, Scenario, Study } from "./types";
import { cellKey } from "./types";
import { DIVERGENCE_THRESHOLD, divergence } from "./runner";

// Self-contained HTML report — the forwardable artifact. Audience: the
// agency's client/buyer, not the person who ran the study. In order: a
// response-time chart, cost per conversation, divergence against the current
// agent (table plus the full conversation for every flagged scenario), then
// the full per-model numbers. Inline CSS only; no external requests.
//
// It deliberately names no winner. The tool has no idea which model is
// actually in production — column 0 is "current" only by position — so any
// "best model" line would be dressing an assumption up as a finding. The
// reader gets the measurements and draws the conclusion.
//
// Voice framing: this is a real-time medium, so latency leads with the
// distribution rather than the mean — a model that averages 0.9s with a 4.5s
// p95 loses calls the mean says it wins.

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

// The mark on the response-time axis where a caller starts talking over the
// agent. Drawn as a reference line only — nothing is scored or excluded by it.
const INTERRUPT_MARK_MS = 2000;

type ModelSummary = {
  model: string;
  mi: number;
  lat: ReturnType<typeof latencyStats>;
  tokensIn: number;
  tokensOut: number;
  costPerConv?: number;
  wordsPerReply?: number;
  divergentIdx: number[];
  n: number;
};

// Axis top for the response-time chart: the slowest reply rounded up to a
// whole second, never below the interrupt mark so that line always has room.
function axisMaxMs(perModel: ModelSummary[]): number {
  const worst = Math.max(0, ...perModel.map((r) => r.lat.max ?? 0));
  return Math.max(INTERRUPT_MARK_MS, Math.ceil(worst / 1000) * 1000);
}

// Whole-second ticks, thinned once a long axis would crowd them.
function axisTicks(maxMs: number): number[] {
  const step = maxMs > 8000 ? 2000 : 1000;
  const out: number[] = [];
  for (let t = 0; t <= maxMs; t += step) out.push(t);
  return out;
}

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

// Explains the chart in the reader's terms, but only where the tail actually
// tells a story the mean hides — a model whose p95 is both past the interrupt
// mark and well clear of its own average. Silent otherwise rather than
// manufacturing a finding.
function tailNote(perModel: ModelSummary[]): string | undefined {
  const worst = perModel
    .filter((r) => r.lat.p95 !== undefined && r.lat.avg !== undefined)
    .sort((a, b) => (b.lat.p95 ?? 0) - (a.lat.p95 ?? 0))[0];
  if (!worst) return undefined;
  const p95 = worst.lat.p95!;
  const avg = worst.lat.avg!;
  if (p95 < INTERRUPT_MARK_MS || p95 < avg * 1.5) return undefined;
  return (
    `Averages hide this. ${esc(worst.model)} averages ${fmtSec(avg)}, but one reply in twenty ` +
    `takes <strong>${fmtSec(p95)}</strong> — long enough on a live call that the caller ` +
    `assumes the line dropped.`
  );
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

  const perModel: ModelSummary[] = models.map((m, mi) => {
    const modelCells = doneCells(mi);
    const lat = latencyStats(modelCells);
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
      tokensIn: modelCells.reduce((a, c) => a + (c.usage?.inputTokens ?? 0), 0),
      tokensOut: modelCells.reduce((a, c) => a + (c.usage?.outputTokens ?? 0), 0),
      costPerConv,
      wordsPerReply,
      divergentIdx,
      n: modelCells.length,
    };
  });

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

  // ---------------------------------------------------------------- chart
  const axisMax = axisMaxMs(perModel);
  const posOf = (ms: number) => (ms / axisMax) * 100;
  const slowest = Math.max(0, ...perModel.map((r) => r.lat.p95 ?? 0));

  const chartRows = perModel
    .map((r) => {
      const { p50, p95, max } = r.lat;
      if (p50 === undefined || p95 === undefined || max === undefined) {
        return `<div class="row"><div class="r-name">${esc(r.model)}</div>
        <div class="track"></div><div class="r-val">—</div></div>`;
      }
      // Amber only for the model actually setting the worst tail, so colour
      // marks the finding rather than decorating every row.
      const tone = p95 >= INTERRUPT_MARK_MS && p95 === slowest ? " warn" : "";
      return `<div class="row">
        <div class="r-name">${esc(r.model)}</div>
        <div class="track">
          <div class="thresh" style="left:${posOf(INTERRUPT_MARK_MS).toFixed(2)}%"></div>
          <div class="bar${tone}" style="left:0;width:${posOf(p50).toFixed(2)}%"></div>
          <div class="ext${tone}" style="left:${posOf(p50).toFixed(2)}%;width:${(posOf(max) - posOf(p50)).toFixed(2)}%"></div>
          <div class="dot p50${tone}" style="left:${posOf(p50).toFixed(2)}%"></div>
          <div class="dot p95${tone}" style="left:${posOf(p95).toFixed(2)}%"></div>
          <div class="tick${tone}" style="left:${posOf(max).toFixed(2)}%"></div>
        </div>
        <div class="r-val${tone}">${fmtSec(p95)}</div>
      </div>`;
    })
    .join("\n");

  const axis = axisTicks(axisMax)
    .map((t) => `<span style="left:${posOf(t).toFixed(2)}%">${(t / 1000).toFixed(0)}s</span>`)
    .join("");

  const note = tailNote(perModel);

  // ---------------------------------------------------------------- cost
  const costMax = Math.max(0, ...perModel.map((r) => r.costPerConv ?? 0));
  const costRows = perModel
    .map((r) => {
      const c = r.costPerConv;
      const width = c !== undefined && costMax > 0 ? (c / costMax) * 100 : 0;
      const win = c !== undefined && c === best.cost ? " good" : "";
      return `<div class="c-row">
        <div class="c-name">${esc(r.model)}</div>
        <div class="c-track"><div class="c-bar${win}" style="width:${width.toFixed(2)}%"></div></div>
        <div class="c-val${win}">${c !== undefined ? fmtMoney(c) : "n/a*"}</div>
      </div>`;
    })
    .join("\n");

  // ----------------------------------------------------------- divergence
  const divergenceRows = scenarios
    .map((s, si) => {
      const cellsFor = models
        .map((_, mi) => {
          const c = cells[cellKey(s.id, mi)];
          if (!c || c.status !== "done") return `<td class="c"><span class="pill none">no run</span></td>`;
          return c.divergent
            ? `<td class="c"><a class="pill warn" href="#d${si}">diverges</a></td>`
            : `<td class="c"><span class="pill ok">matches</span></td>`;
        })
        .join("");
      return `<tr><td>${esc(s.name)} <span class="lang">${esc(languageName(s.language))}</span></td>${cellsFor}</tr>`;
    })
    .join("\n");

  // Full conversations for the scenarios worth reading — the flagged ones.
  // With nothing flagged the report would otherwise carry no transcript at
  // all, so it falls back to showing every scenario rather than none.
  const flaggedIdx = scenarios
    .map((s, si) => (models.some((_, mi) => cells[cellKey(s.id, mi)]?.divergent) ? si : -1))
    .filter((i) => i >= 0);
  const shownIdx = flaggedIdx.length > 0 ? flaggedIdx : scenarios.map((_, i) => i);

  const cols = `grid-template-columns:repeat(${Math.max(1, models.length)},minmax(0,1fr))`;

  const conversations = shownIdx
    .map((si) => {
      const s = scenarios[si];
      const inc = cells[cellKey(s.id, 0)];
      const marks = models.map((_, mi) => {
        const c = cells[cellKey(s.id, mi)];
        return mi > 0 && c?.divergent ? firstDivergentReply(inc?.turns, c.turns ?? []) : undefined;
      });
      const agentTurns = models.map((_, mi) =>
        (cells[cellKey(s.id, mi)]?.turns ?? []).filter((t) => t.role === "agent"),
      );
      const headers = models
        .map((m, mi) => {
          const flagged = cells[cellKey(s.id, mi)]?.divergent;
          return `<div class="cv-col${flagged ? " warn" : ""}">${esc(m)}</div>`;
        })
        .join("");

      // The script is the spine: each caller line once, then every model's
      // reply to it side by side. Beats repeating the caller in N columns,
      // and lines the replies up against the prompt that produced them.
      const turns = s.turns
        .map((userText, ti) => {
          const replies = models
            .map((_, mi) => {
              const t = agentTurns[mi][ti];
              if (!t) return `<div class="rep empty">no reply</div>`;
              const markAt = marks[mi];
              const hit = markAt !== undefined && ti === markAt;
              const after = markAt !== undefined && ti > markAt;
              const cls = hit ? " flag" : after ? " dim" : "";
              const meta =
                (t.latencyMs !== undefined ? fmtSec(t.latencyMs) : "—") +
                ` · ${wordCount(t.text)} w`;
              return `<div class="rep${cls}"><p>${esc(t.text)}</p><em${hit || after ? ' class="warn"' : ""}>${meta}</em>${
                hit ? '<div class="flag-note">first divergence from current</div>' : ""
              }</div>`;
            })
            .join("");
          return `<div class="turn">
            <div class="caller"><i>Caller</i>${esc(userText)}</div>
            <div class="replies" style="${cols}">${replies}</div>
          </div>`;
        })
        .join("\n");

      return `<div class="convo" id="d${si}">
        <div class="cv-head">${esc(s.name)} <span class="lang">${esc(languageName(s.language))}</span></div>
        <div class="cv-cols" style="${cols}">${headers}</div>
        ${turns}
      </div>`;
    })
    .join("\n");

  // -------------------------------------------------------- full numbers
  const summaryRows = perModel
    .map((r) => {
      return `<tr>
        <td class="mdl">${esc(r.model)}</td>
        <td class="n">${r.n}/${scenarios.length}</td>
        ${num(r.lat.avg !== undefined ? fmtSec(r.lat.avg) : "—", r.lat.avg, best.avg)}
        ${num(r.lat.p50 !== undefined ? fmtSec(r.lat.p50) : "—", r.lat.p50, best.p50)}
        ${num(r.lat.p95 !== undefined ? fmtSec(r.lat.p95) : "—", r.lat.p95, best.p95)}
        ${num(r.lat.max !== undefined ? fmtSec(r.lat.max) : "—", r.lat.max, best.max)}
        <td class="n">${r.wordsPerReply !== undefined ? Math.round(r.wordsPerReply) : "—"}</td>
        <td class="n">${r.tokensIn.toLocaleString()} / ${r.tokensOut.toLocaleString()}</td>
        ${num(r.costPerConv !== undefined ? fmtMoney(r.costPerConv) : "n/a*", r.costPerConv, best.cost)}
      </tr>`;
    })
    .join("\n");

  // Per-language speed: average latency only — the distribution belongs to
  // the chart above, this table exists to show a model slipping in one
  // language and holding in another.
  const languageSection = !multiLang
    ? ""
    : (() => {
        const perLang = languages.map((lang) => {
          const subset = scenarios.filter((s) => s.language === lang);
          return {
            lang,
            count: subset.length,
            avgs: models.map((_, mi) => latencyStats(doneCells(mi, subset)).avg),
          };
        });
        const bestPerLang = perLang.map((l) => bestOf(l.avgs));
        const head = perLang
          .map(
            (l) =>
              `<th class="n">${esc(languageName(l.lang))} <span>${l.count} scenario${l.count > 1 ? "s" : ""}</span></th>`,
          )
          .join("");
        const rows = models
          .map((m, mi) => {
            const tds = perLang
              .map((l, li) => num(l.avgs[mi] !== undefined ? fmtSec(l.avgs[mi]!) : "—", l.avgs[mi], bestPerLang[li]))
              .join("");
            return `<tr><td class="mdl">${esc(m)}</td>${tds}</tr>`;
          })
          .join("\n");
        return `<div class="tw" style="margin-top:20px"><table class="data"><thead>
<tr><th>Speed by language</th>${head}</tr></thead>
<tbody>${rows}</tbody></table></div>`;
      })();

  const latCols = 4;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(study.title)}</title>
<style>
  /* Dark by default. Print flips the TOKENS rather than just the page
     background — whitening the paper while leaving near-white text would
     print blank. */
  :root{
    --bg:#0a0a0a;--panel:#121212;--node:#181818;--raised:#1f1f1f;
    --line:#262626;--line-2:#303030;--line-3:#525252;
    --fg:#f2f2f2;--fg-2:#b0b0b0;--fg-3:#8e8e8e;--fg-4:#525252;
    --ok:#7dd69b;--ok-line:#2e9e5b;--ok-bg:#0c1a12;
    --warn:#f5c86b;--warn-line:#c68a15;--warn-bg:#1a1408;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:Geist,system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:450;
    -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums slashed-zero}
  .page{max-width:1040px;margin:0 auto;padding:44px 28px 64px}
  a{color:var(--fg-2)}

  .hd{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
    padding-bottom:20px;border-bottom:1px solid var(--line-2)}
  .brand{font-size:11px;font-weight:560;letter-spacing:.06em;text-transform:uppercase;
    color:var(--fg-3);margin-bottom:8px}
  .brand span{color:var(--fg-4)}
  h1{font-size:24px;line-height:30px;font-weight:640;letter-spacing:-.025em;margin:0}
  .sub{font-size:12px;color:var(--fg-3);margin-top:6px}
  .hd-meta{display:flex;gap:22px;padding-bottom:2px}
  .m{text-align:right;font-size:11px;color:var(--fg-3);white-space:nowrap}
  .m span{display:block;font-size:17px;font-weight:560;color:var(--fg);margin-bottom:2px}

  section{margin-top:38px}
  .sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:16px}
  h2{font-size:15px;line-height:20px;font-weight:560;letter-spacing:-.011em;margin:0}
  .sec-note{font-size:11px;color:var(--fg-3);text-align:right}

  .chart{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:22px 24px 18px}
  .axis{position:relative;height:16px;margin-left:196px;margin-right:56px;margin-bottom:10px}
  .axis span{position:absolute;transform:translateX(-50%);font-size:11px;color:var(--fg-4)}
  .axis span:first-child{transform:none}
  .axis span:last-child{transform:translateX(-100%)}
  .row{display:flex;align-items:center;margin-bottom:14px}
  .r-name{width:196px;flex:none;font-size:13px;padding-right:16px;color:var(--fg-2);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .track{flex:1;position:relative;height:22px}
  .track:before{content:"";position:absolute;left:0;right:0;top:10px;height:2px;background:var(--raised);border-radius:999px}
  .thresh{position:absolute;top:-2px;bottom:-2px;width:0;border-left:1px dashed var(--line-3)}
  .bar{position:absolute;top:9px;height:4px;background:var(--fg-4);border-radius:999px}
  .bar.warn{background:var(--warn-line)}
  .ext{position:absolute;top:10.5px;height:1px;background:var(--fg-4)}
  .ext.warn{background:var(--warn-line)}
  .dot{position:absolute;border-radius:999px;transform:translateX(-50%)}
  .dot.p50{top:6px;width:10px;height:10px;background:var(--fg-2)}
  .dot.p50.warn{background:var(--warn)}
  .dot.p95{top:6px;width:10px;height:10px;background:var(--panel);border:2px solid var(--fg-2)}
  .dot.p95.warn{border-color:var(--warn)}
  .tick{position:absolute;top:2px;bottom:2px;width:2px;border-radius:1px;background:var(--fg-3);transform:translateX(-50%)}
  .tick.warn{background:var(--warn)}
  .r-val{width:56px;flex:none;text-align:right;font-size:15px;font-weight:560}
  .r-val.warn{color:var(--warn)}
  .legend{display:flex;gap:20px;align-items:center;margin-left:196px;margin-top:16px;
    padding-top:14px;border-top:1px solid var(--line);flex-wrap:wrap;font-size:11px;color:var(--fg-3)}
  .legend span{display:flex;align-items:center;gap:6px}
  .k-dot{width:9px;height:9px;border-radius:999px;background:var(--fg-2);display:inline-block}
  .k-hollow{background:transparent;border:2px solid var(--fg-2)}
  .k-tick{width:2px;height:11px;border-radius:1px;background:var(--fg-3);display:inline-block}
  .k-line{width:12px;height:0;border-top:1px dashed var(--line-3);display:inline-block}
  .takeaway{font-size:14px;line-height:22px;color:var(--fg-2);margin:16px 2px 0}
  .takeaway strong{color:var(--warn);font-weight:560}

  .cost{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:20px 24px}
  .c-row{display:flex;align-items:center;margin-bottom:12px}
  .c-row:last-child{margin-bottom:0}
  .c-name{width:196px;flex:none;font-size:13px;padding-right:16px;color:var(--fg-2);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .c-track{flex:1;height:8px;background:var(--raised);border-radius:999px;overflow:hidden}
  .c-bar{height:100%;background:var(--fg-4);border-radius:999px}
  .c-bar.good{background:var(--ok-line)}
  .c-val{width:76px;flex:none;text-align:right;font-size:13px;font-weight:500}
  .c-val.good{color:var(--ok)}

  table{border-collapse:collapse;width:100%}
  .tw{overflow-x:auto;border:1px solid var(--line);border-radius:6px}
  .grid{font-size:13px}
  .grid th{font-size:10px;font-weight:560;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3);
    text-align:left;padding:11px 14px;border-bottom:1px solid var(--line-2);background:var(--node);white-space:nowrap}
  .grid th.c,.grid td.c{text-align:center}
  .grid td{padding:12px 14px;border-bottom:1px solid var(--line);color:var(--fg-2)}
  .grid tbody tr:last-child td{border-bottom:none}
  .pill{display:inline-block;font-size:11px;font-weight:500;border-radius:999px;padding:2px 10px;text-decoration:none}
  .pill.ok{color:var(--fg-3);background:var(--raised)}
  .pill.none{color:var(--fg-4);background:transparent;border:1px dashed var(--line-2)}
  .pill.warn{color:var(--warn);background:var(--warn-bg);border:1px solid var(--warn-line)}
  .lang{font-size:11px;color:var(--fg-4);margin-left:4px}

  .convo{margin-top:16px;background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden}
  .cv-head{padding:12px 16px;background:var(--node);border-bottom:1px solid var(--line);
    font-size:13px;font-weight:500}
  .cv-cols{display:grid;gap:10px;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
  .cv-col{font-size:10px;font-weight:560;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cv-col.warn{color:var(--warn)}
  .turn{padding:14px 16px;border-bottom:1px solid var(--line)}
  .turn:last-child{border-bottom:none}
  .caller{font-size:13px;line-height:20px;color:var(--fg);background:var(--raised);
    border-radius:6px;padding:9px 12px;margin-bottom:12px}
  .caller i{font-style:normal;font-size:9px;font-weight:560;letter-spacing:.06em;text-transform:uppercase;
    color:var(--fg-4);margin-right:9px}
  .replies{display:grid;gap:10px;align-items:start}
  .rep{background:var(--node);border:1px solid var(--line);border-radius:6px;padding:10px 12px}
  .rep p{margin:0;font-size:12px;line-height:19px;color:var(--fg)}
  .rep em{display:block;font-style:normal;font-size:10px;color:var(--fg-3);margin-top:8px}
  .rep em.warn{color:var(--warn)}
  .rep.flag{border-color:var(--warn-line);background:var(--warn-bg)}
  .rep.dim{border-color:rgba(198,138,21,.35);background:rgba(198,138,21,.05)}
  .rep.empty{color:var(--fg-4);font-size:12px;font-style:italic;border-style:dashed}
  .flag-note{font-size:9px;font-weight:560;letter-spacing:.06em;text-transform:uppercase;color:var(--warn);
    margin-top:7px;padding-top:7px;border-top:1px solid rgba(198,138,21,.3)}

  .data{font-size:12px;min-width:640px}
  .data th{background:var(--node);font-size:11px;font-weight:500;color:var(--fg-3);text-align:left;
    padding:10px 12px;border-bottom:1px solid var(--line-2);white-space:nowrap;vertical-align:bottom}
  .data th span{font-weight:450;color:var(--fg-4)}
  .data th.grp{text-align:center;font-size:10px;font-weight:560;letter-spacing:.06em;text-transform:uppercase;
    padding-bottom:6px;border-bottom:1px solid var(--line)}
  .data th.sm{padding-top:0;font-size:10px;color:var(--fg-4)}
  .data td{padding:11px 12px;border-bottom:1px solid var(--line);color:var(--fg-2)}
  .data tbody tr:last-child td{border-bottom:none}
  .data .n,.data th.n{text-align:right;white-space:nowrap}
  .data .mdl{color:var(--fg);font-weight:500;white-space:nowrap}
  .data .best{color:var(--ok);font-weight:640}
  .note{font-size:11px;line-height:18px;color:var(--fg-3);margin:14px 2px 0}

  footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);
    font-size:12px;line-height:20px;color:var(--fg-3)}

  @media print{
    :root{
      --bg:#fff;--panel:#fff;--node:#fafafa;--raised:#f4f4f5;
      --line:#e4e4e7;--line-2:#d4d4d8;--line-3:#a1a1aa;
      --fg:#18181b;--fg-2:#3f3f46;--fg-3:#71717a;--fg-4:#a1a1aa;
      --ok:#146c36;--ok-line:#22a356;--ok-bg:#edf7f0;
      --warn:#8a5300;--warn-line:#de9a17;--warn-bg:#fdf6e9;
    }
    .page{max-width:none;padding:0}
    .tw{overflow:visible}
    .data{min-width:0;font-size:10px}
    .data th,.data td{padding:6px 7px}
    section,.convo,.chart,.turn,.cost{break-inside:avoid}
    h2{break-after:avoid}
  }
  @media (max-width:760px){
    .page{padding:28px 18px 44px}
    .hd{flex-direction:column;align-items:flex-start;gap:16px}
    .hd-meta{gap:18px}.m{text-align:left}
    .r-name,.c-name{width:120px;font-size:12px}
    .axis{margin-left:120px}.legend{margin-left:0}
    .replies,.cv-cols{grid-template-columns:1fr !important}
    .cv-cols{display:none}
  }
</style></head><body><div class="page">

<header class="hd">
  <div>
    <div class="brand">flowstore<span>/compare</span></div>
    <h1>${esc(study.title)}</h1>
    <div class="sub">Model comparison study · ${date}</div>
  </div>
  <div class="hd-meta">
    <div class="m"><span>${models.length}</span>model${models.length === 1 ? "" : "s"}</div>
    <div class="m"><span>${scenarios.length}</span>scenario${scenarios.length === 1 ? "" : "s"}</div>
    ${multiLang ? `<div class="m"><span>${languages.length}</span>languages</div>` : ""}
    <div class="m"><span>${perModel.reduce((a, r) => a + r.n, 0)}/${models.length * scenarios.length}</span>cells run</div>
    <div class="m"><span>${study.prompt.length.toLocaleString()}</span>prompt chars</div>
  </div>
</header>

<section>
  <div class="sec-head"><h2>Response time</h2>
    <div class="sec-note">Per agent reply · p50 → p95 → max</div></div>
  <div class="chart">
    <div class="axis">${axis}</div>
    ${chartRows}
    <div class="legend">
      <span><i class="k-dot"></i>p50</span>
      <span><i class="k-dot k-hollow"></i>p95</span>
      <span><i class="k-tick"></i>max — the single slowest reply</span>
      <span><i class="k-line"></i>${(INTERRUPT_MARK_MS / 1000).toFixed(0)}s — the point a caller starts talking over the agent</span>
    </div>
  </div>
  ${note ? `<p class="takeaway">${note}</p>` : ""}
</section>

<section>
  <div class="sec-head"><h2>Cost per conversation</h2>
    <div class="sec-note">Measured, as reported by the provider</div></div>
  <div class="cost">${costRows}</div>
</section>

<section>
  <div class="sec-head"><h2>Divergence vs current agent</h2>
    <div class="sec-note">A lexical signal marking where to read — not a pass/fail verdict</div></div>
  <table class="grid"><thead><tr><th>Scenario</th>${models.map((m) => `<th class="c">${esc(m)}</th>`).join("")}</tr></thead>
  <tbody>${divergenceRows}</tbody></table>
  ${conversations}
</section>

<section>
  <div class="sec-head"><h2>Full numbers</h2>
    <div class="sec-note">Everything measured, per model</div></div>
  <div class="tw"><table class="data"><thead>
  <tr><th rowspan="2">Model</th><th rowspan="2" class="n">Completed</th><th colspan="${latCols}" class="grp">Latency</th><th rowspan="2" class="n">Words<br><span>/reply</span></th><th rowspan="2" class="n">Tokens<br><span>in / out</span></th><th rowspan="2" class="n">Cost<br><span>/conv</span></th></tr>
  <tr><th class="n sm">avg</th><th class="n sm">p50</th><th class="n sm">p95</th><th class="n sm">max</th></tr>
  </thead><tbody>${summaryRows}</tbody></table></div>
  ${languageSection}
  <p class="note">*Measured dollar cost is reported by OpenRouter-routed models; direct-provider runs show tokens only. ${latencyNote} Percentiles are nearest-rank over individual agent replies, so p95 and max are times that actually occurred. Divergence is a lexical signal marking where to read — it is not a pass/fail verdict; read the transcripts.</p>
</section>

<footer>${footer}</footer>
</div></body></html>`;
}
