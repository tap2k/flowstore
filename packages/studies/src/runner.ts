import { sendPromptTurn } from "@flowstore/core/runtime/promptClient";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { ChatUsage } from "@flowstore/core/llm/types";
import type { CellState, ModelDispatch, Scenario } from "./types";

export function sumUsage(
  a: ChatUsage | undefined,
  b: ChatUsage | undefined,
): ChatUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const cost =
    a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined;
  const cached =
    a.cachedInputTokens !== undefined || b.cachedInputTokens !== undefined
      ? (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0)
      : undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

// Run one scenario against one model, reporting progress after every turn.
// Isomorphic: no store/env access — the caller resolves and injects dispatch.
export async function runCell(args: {
  systemPrompt: string;
  scenario: Scenario;
  dispatch: ModelDispatch;
  onUpdate: (patch: Partial<CellState>) => void;
}): Promise<void> {
  const { systemPrompt, scenario, dispatch, onUpdate } = args;
  onUpdate({ status: "running", turns: [], usage: undefined, totalMs: 0, error: undefined });

  const history: TranscriptTurn[] = [];
  let usage: ChatUsage | undefined;
  let totalMs = 0;
  try {
    for (const userText of scenario.turns) {
      const userTurn: TranscriptTurn = { role: "user", text: userText, ts: Date.now(), events: [] };
      history.push(userTurn);
      onUpdate({ turns: [...history] });
      const started = Date.now();
      const res = await sendPromptTurn({
        systemPrompt,
        history: history.slice(0, -1),
        userText,
        apiKey: dispatch.apiKey,
        model: dispatch.wireModel,
        provider: dispatch.provider,
        baseUrl: dispatch.baseUrl,
      });
      const latencyMs = Date.now() - started;
      totalMs += latencyMs;
      usage = sumUsage(usage, res.usage);
      history.push({ role: "agent", text: res.text, ts: Date.now(), events: [], latencyMs });
      onUpdate({ turns: [...history], usage, totalMs });
    }
    onUpdate({ status: "done" });
  } catch (err) {
    onUpdate({ status: "error", error: err instanceof Error ? err.message : String(err) });
  }
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
