import { addUsage, sendPromptTurn } from "@flowstore/core/runtime/promptClient";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { ChatUsage } from "@flowstore/core/llm/types";
import type { CellState, ModelDispatch, Scenario } from "./types";
import { IDLE_CELL, cellKey } from "./types";

// Resolves a model id to dispatch credentials, or null when the model can't
// be dispatched (no key). Injected by the surface (browser settings store,
// node CLI env) — the engine never reads config itself.
export type ResolveDispatch = (model: string) => ModelDispatch | null;

// Only a PAUSED conversation resumes (status idle — errored cells restart so
// the failure isn't silently swallowed into a continuation), and only if its
// kept turns are complete user/agent pairs whose user side is a prefix of
// the current script — an edited scenario invalidates the prefix and the
// conversation restarts.
function resumablePrefix(
  prior: CellState | undefined,
  scenario: Scenario,
): TranscriptTurn[] | null {
  if (prior?.status !== "idle") return null;
  const t = prior.turns;
  if (t.length === 0 || t.length % 2 !== 0) return null;
  if (t.length / 2 >= scenario.turns.length) return null;
  for (let i = 0; i < t.length; i += 2) {
    if (t[i].role !== "user" || t[i].text !== scenario.turns[i / 2]) return null;
    if (t[i + 1].role !== "agent") return null;
  }
  return t;
}

// Run one scenario against one model, reporting progress after every turn.
// Stop (signal) follows the simulate panel's semantics: cooperative, checked
// at turn boundaries, the in-flight LLM call completes but its result is
// dropped — and, like simulate, the transcript so far is KEPT (status idle,
// completed pairs only), so the next run picks up mid-conversation via
// `resume`.
export async function runCell(args: {
  systemPrompt: string;
  scenario: Scenario;
  dispatch: ModelDispatch;
  onUpdate: (patch: Partial<CellState>) => void;
  signal?: AbortSignal;
  resume?: CellState;
}): Promise<void> {
  const { systemPrompt, scenario, dispatch, onUpdate, signal } = args;
  // S2S columns route to the Live driver (same onUpdate contract, no resume —
  // a closed Live session can't be re-seeded, so stopped cells restart).
  if (dispatch.live) {
    const { runLiveCell } = await import("./liveCell");
    return runLiveCell({ systemPrompt, scenario, dispatch, onUpdate, signal });
  }
  const prior = resumablePrefix(args.resume, scenario);
  const history: TranscriptTurn[] = prior ? [...prior] : [];
  let usage: ChatUsage | undefined = prior ? args.resume?.usage : undefined;
  let totalMs = prior ? (args.resume?.totalMs ?? 0) : 0;
  onUpdate({ status: "running", turns: [...history], usage, totalMs, error: undefined });
  const settle = () => onUpdate({ status: "idle", turns: [...history], usage, totalMs });

  try {
    for (const userText of scenario.turns.slice(history.length / 2)) {
      if (signal?.aborted) return settle();
      const userTurn: TranscriptTurn = { role: "user", text: userText, ts: Date.now(), events: [] };
      onUpdate({ turns: [...history, userTurn] });
      const started = Date.now();
      const res = await sendPromptTurn({
        systemPrompt,
        history,
        userText,
        apiKey: dispatch.apiKey,
        model: dispatch.wireModel,
        provider: dispatch.provider,
        baseUrl: dispatch.baseUrl,
      });
      if (signal?.aborted) return settle();
      const latencyMs = Date.now() - started;
      totalMs += latencyMs;
      usage = addUsage(usage, res.usage);
      history.push(userTurn, { role: "agent", text: res.text, ts: Date.now(), events: [], latencyMs });
      onUpdate({ turns: [...history], usage, totalMs });
    }
    onUpdate({ status: "done" });
  } catch (err) {
    onUpdate({ status: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

// The matrix: columns (models) in parallel, scenarios within a column
// sequential; then the divergence pass vs column 0 (the incumbent). Owns the
// whole engine policy so every surface (browser page, node CLI) shares it —
// including setting `divergent`, which report/bundle consume. Returns the
// final cells; emits every patch through onCell for live rendering.
export async function runMatrix(args: {
  systemPrompt: string;
  scenarios: Scenario[];
  models: string[];
  resolveDispatch: ResolveDispatch;
  onCell: (key: string, patch: Partial<CellState>) => void;
  signal?: AbortSignal;
  // Resume after a stop: done cells seed the matrix and are skipped;
  // partially-run cells continue mid-conversation (see runCell's resume).
  // Divergence recomputes over the union.
  resumeFrom?: Record<string, CellState>;
}): Promise<Record<string, CellState>> {
  const { systemPrompt, scenarios, models, resolveDispatch, onCell, signal } = args;
  const cells: Record<string, CellState> = {};
  for (const [k, c] of Object.entries(args.resumeFrom ?? {})) {
    if (c.status === "done") cells[k] = c;
  }
  const emit = (key: string, patch: Partial<CellState>) => {
    cells[key] = { ...(cells[key] ?? IDLE_CELL), ...patch };
    onCell(key, patch);
  };

  await Promise.all(
    models.map(async (model, mi) => {
      for (const s of scenarios) {
        if (signal?.aborted) break;
        const key = cellKey(s.id, mi);
        if (cells[key]?.status === "done") continue;
        // Resolved per cell on purpose: a key entered mid-run is picked up
        // by the remaining scenarios in the column.
        const dispatch = resolveDispatch(model);
        if (!dispatch) {
          emit(key, { status: "error", error: `No API key for ${model}.` });
          continue;
        }
        await runCell({
          systemPrompt,
          scenario: s,
          dispatch,
          onUpdate: (p) => emit(key, p),
          signal,
          resume: args.resumeFrom?.[key],
        });
      }
    }),
  );

  for (const s of scenarios) {
    const inc = cells[cellKey(s.id, 0)];
    if (!inc || inc.status !== "done") continue;
    for (let mi = 1; mi < models.length; mi++) {
      const key = cellKey(s.id, mi);
      const c = cells[key];
      if (!c || c.status !== "done") continue;
      emit(key, { divergent: divergence(inc.turns, c.turns) > DIVERGENCE_THRESHOLD });
    }
  }
  return cells;
}

// Cheap lexical divergence between two columns' agent turns on the same
// scenario: 1 - Jaccard over word sets. Deliberately not a verdict — it only
// ranks where a human should look first.
export function divergence(a: TranscriptTurn[], b: TranscriptTurn[]): number {
  const words = (turns: TranscriptTurn[]) =>
    new Set(
      turns
        .filter((t) => t.role === "agent")
        .map((t) => t.text.toLowerCase())
        .join(" ")
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 && wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

export const DIVERGENCE_THRESHOLD = 0.72;
