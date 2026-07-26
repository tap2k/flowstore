import { useState } from "react";
import { sendPromptTurn } from "@flowstore/core/runtime/promptClient";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { ChatUsage } from "@flowstore/core/llm/types";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import {
  DEFAULT_MODEL_ID,
  resolveDispatch,
  useSettingsStore,
} from "@/lib/store/settings";

// Walking skeleton: hardcoded agent + scenario, N columns, one model each.
// Proves the transport (sendPromptTurn per column, concurrent columns,
// sequential turns within a column) and the cost capture (OpenRouter
// usage.cost). Everything else — paste-your-prompt intake, suggested
// scenarios, agreement scoring — layers on top of this loop.
const SYSTEM_PROMPT = `You are the voice ordering agent for Nimbus Coffee.

Rules:
- Greet briefly, take the order, confirm it, then close. Keep every reply under 40 words — this is a voice line.
- Menu: espresso, americano, latte, cappuccino, drip. Sizes: small, medium, large. Milks: whole, oat, almond.
- Always confirm size and milk before finalizing a milk drink. Never assume.
- If asked for anything not on the menu, apologize and offer the closest item.
- Collect a name for the cup before closing.
- Never discuss anything unrelated to the order; steer back politely.`;

const SCENARIO: string[] = [
  "hey can I get a latte",
  "uh make it large. actually do you have caramel syrup?",
  "fine, no syrup. oat milk. and also what do you think about the election?",
  "it's for Priya. that's all.",
];

type ColumnState = {
  status: "idle" | "running" | "done" | "error";
  turns: TranscriptTurn[];
  usage?: ChatUsage;
  totalMs: number;
  error?: string;
};

const IDLE: ColumnState = { status: "idle", turns: [], totalMs: 0 };

function sumUsage(a: ChatUsage | undefined, b: ChatUsage | undefined): ChatUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const cost =
    a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cost !== undefined ? { cost } : {}),
  };
}

export function ComparePage() {
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL_ID, DEFAULT_MODEL_ID]);
  const [cols, setCols] = useState<ColumnState[]>([IDLE, IDLE]);
  const running = cols.some((c) => c.status === "running");

  const googleApiKey = useSettingsStore((s) => s.googleApiKey);
  const openrouterApiKey = useSettingsStore((s) => s.openrouterApiKey);
  const setGoogleApiKey = useSettingsStore((s) => s.setGoogleApiKey);
  const setOpenrouterApiKey = useSettingsStore((s) => s.setOpenrouterApiKey);

  const patchCol = (i: number, patch: Partial<ColumnState>) =>
    setCols((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const pushTurn = (i: number, turn: TranscriptTurn) =>
    setCols((prev) =>
      prev.map((c, j) => (j === i ? { ...c, turns: [...c.turns, turn] } : c)),
    );

  async function runColumn(i: number, model: string): Promise<void> {
    const dispatch = resolveDispatch(model);
    if (!dispatch.provider || !dispatch.apiKey.trim()) {
      patchCol(i, { status: "error", error: `No API key configured for ${model}.` });
      return;
    }
    patchCol(i, { status: "running", turns: [], usage: undefined, totalMs: 0, error: undefined });

    const history: TranscriptTurn[] = [];
    let usage: ChatUsage | undefined;
    let totalMs = 0;
    try {
      for (const userText of SCENARIO) {
        const userTurn: TranscriptTurn = { role: "user", text: userText, ts: Date.now(), events: [] };
        pushTurn(i, userTurn);
        const started = Date.now();
        const res = await sendPromptTurn({
          systemPrompt: SYSTEM_PROMPT,
          history,
          userText,
          apiKey: dispatch.apiKey,
          model: dispatch.wireModel,
          provider: dispatch.provider,
          baseUrl: dispatch.baseUrl,
        });
        const latencyMs = Date.now() - started;
        totalMs += latencyMs;
        usage = sumUsage(usage, res.usage);
        const agentTurn: TranscriptTurn = {
          role: "agent",
          text: res.text,
          ts: Date.now(),
          events: [],
          latencyMs,
        };
        history.push(userTurn, agentTurn);
        pushTurn(i, agentTurn);
        patchCol(i, { usage, totalMs });
      }
      patchCol(i, { status: "done" });
    } catch (err) {
      patchCol(i, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const run = () => void Promise.all(models.map((m, i) => runColumn(i, m)));

  return (
    <div className="flex flex-col h-screen bg-zinc-50 text-zinc-900">
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold">
          compare <span className="font-normal text-zinc-400">· flowstore</span>
        </h1>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
          walking skeleton — hardcoded scenario
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="password"
            value={googleApiKey}
            onChange={(e) => setGoogleApiKey(e.target.value)}
            placeholder="Google API key"
            className="w-36 rounded border border-zinc-300 px-2 py-1 text-[11px]"
          />
          <input
            type="password"
            value={openrouterApiKey}
            onChange={(e) => setOpenrouterApiKey(e.target.value)}
            placeholder="OpenRouter API key"
            className="w-36 rounded border border-zinc-300 px-2 py-1 text-[11px]"
          />
          <button
            onClick={run}
            disabled={running}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {running ? "running…" : "run"}
          </button>
        </div>
      </header>

      <main className="flex flex-1 min-h-0 divide-x divide-zinc-200">
        {models.map((model, i) => (
          <section key={i} className="flex flex-1 flex-col min-w-0">
            <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
              <ModelPicker
                value={model}
                onChange={(m) => setModels((prev) => prev.map((v, j) => (j === i ? m : v)))}
                disabled={running}
                showUnconfigured
                className="text-xs"
              />
              <ColumnStats col={cols[i]} />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {cols[i].turns.map((t, k) => (
                <div
                  key={k}
                  className={
                    t.role === "user"
                      ? "ml-8 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white"
                      : "mr-8 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs"
                  }
                >
                  {t.text}
                  {t.role === "agent" && t.latencyMs !== undefined && (
                    <div className="mt-1 text-[10px] text-zinc-400">
                      {(t.latencyMs / 1000).toFixed(1)}s
                    </div>
                  )}
                </div>
              ))}
              {cols[i].status === "running" && (
                <div className="mr-8 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-400">
                  …
                </div>
              )}
              {cols[i].status === "error" && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {cols[i].error}
                </div>
              )}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

function ColumnStats({ col }: { col: ColumnState }) {
  if (!col.usage && col.status !== "done") return null;
  const u = col.usage;
  return (
    <span className="ml-auto whitespace-nowrap text-[10px] text-zinc-500">
      {u && `${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out`}
      {u?.cost !== undefined && ` · $${u.cost.toFixed(4)}`}
      {col.totalMs > 0 && ` · ${(col.totalMs / 1000).toFixed(1)}s`}
    </span>
  );
}
