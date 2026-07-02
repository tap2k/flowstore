import type { Flow, Spec } from "@flowstore/core/schema/v0";
import { isEndGoto, isReturnGoto } from "@flowstore/core/schema/v0";
import type { ProviderId } from "@flowstore/core/llm/types";
import { generateStructuredJson } from "./structuredOutput";
import { findExitTo, interruptFlowIds, type TransitionTable } from "./transitionTable";

// The prompt-mode flow watcher: a small structured LLM call that reads the
// conversation and guesses which flow the monolith agent is operating in — the
// attribution the runner gets for free from its flow stack but prompt mode has
// no source for. Its output is fed through `resolveTransition` (deterministic)
// against the licensed-transition table to (a) drive the canvas glow and (b)
// detect illegal jumps (naive read ∉ licensed set). See
// planning/attribution-and-uncertainty.md §8.
//
// This module is pure/logic: the browser supplies creds (default model) and
// owns the call site, race-guarding, and store writes.

const SYSTEM_PROMPT = `You are a conversation analyst observing a customer-service agent that follows a spec made of "flows" (states) connected by exit paths (transitions).

Given the recent conversation and the flow the agent was last operating in, decide which flow the agent is operating in AS OF ITS LATEST TURN. The agent speaks in one natural voice and never announces flow names — infer the flow from what it is actually doing (asking, confirming, handling a complaint, closing, etc.).

Rules:
- Pick current_flow_id from the provided flow list ONLY. Never invent an id.
- If the agent is still doing the same job as before, return the SAME flow id it was last in.
- If it moved and you can tell which exit path it took out of the previous flow, set via_exit_path_id to that exit's id; otherwise "UNKNOWN".
- confidence is 0..1: how sure you are of current_flow_id given the text. Be honest — a genuinely ambiguous boundary turn should score low.`;

export interface FlowWatcherArgs {
  // The flow we believe the agent was in before this turn (seed with the
  // agent's entry_flow_id on the first turn).
  prevFlowId: string;
  // Recent conversation, oldest→newest. Only role/text are used.
  transcript: { role: "agent" | "user"; text: string }[];
  // How many trailing turns to include. Default 6.
  maxTurns?: number;
}

// The raw structured output — before reachability resolution. Whether the agent
// moved is derived (current_flow_id vs the prior flow), not self-reported, so
// there's no `transitioned` field to keep honest.
export interface FlowWatcherRaw {
  current_flow_id: string;
  via_exit_path_id: string | null;
  confidence: number;
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function flowLine(f: Flow): string {
  const gist = f.instructions ?? f.notes ?? "";
  const suffix = gist ? ` — ${truncate(gist, 140)}` : "";
  return `- ${f.id} (${f.name}) [${f.type}]${suffix}`;
}

function exitLine(f: Flow, flowNames: Map<string, string>): string[] {
  return (f.exit_paths ?? []).map((ep) => {
    const target = isEndGoto(ep.goto)
      ? "END"
      : isReturnGoto(ep.goto)
        ? "RETURN to caller"
        : `${flowNames.get(ep.goto) ?? ep.goto} (${ep.goto})`;
    const cond = ep.condition
      ? `when ${truncate(ep.condition.expression, 100)}`
      : ep.max_turns !== undefined
        ? `after ${ep.max_turns} turns`
        : "otherwise";
    return `  - ${ep.id}: ${cond} → ${target}`;
  });
}

// Exit ids the watcher may cite for via_exit_path_id, plus the escape hatch.
function viaEnum(prevFlow: Flow | undefined): string[] {
  const ids = (prevFlow?.exit_paths ?? []).map((ep) => ep.id);
  return [...ids, "UNKNOWN"];
}

export async function runFlowWatcher(
  spec: Spec,
  provider: ProviderId,
  apiKey: string,
  model: string,
  args: FlowWatcherArgs,
): Promise<FlowWatcherRaw> {
  const flowNames = new Map(spec.flows.map((f) => [f.id, f.name]));
  const prevFlow = spec.flows.find((f) => f.id === args.prevFlowId);
  const recent = args.transcript.slice(-(args.maxTurns ?? 6));

  const userPrompt = [
    "Flows in this spec:",
    ...spec.flows.map(flowLine),
    "",
    prevFlow
      ? `The agent was last operating in flow: ${prevFlow.id} (${prevFlow.name}). Its exit paths:`
      : `The agent was last operating in flow: ${args.prevFlowId}.`,
    ...(prevFlow ? exitLine(prevFlow, flowNames) : []),
    "",
    "Recent conversation (oldest first):",
    ...recent.map((t) => `${t.role}: ${truncate(t.text, 400)}`),
    "",
    "Which flow is the agent operating in as of its latest turn?",
  ].join("\n");

  const raw = await generateStructuredJson<FlowWatcherRaw>(provider, apiKey, model, {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: {
      type: "OBJECT",
      properties: {
        current_flow_id: {
          type: "STRING",
          enum: spec.flows.map((f) => f.id),
          description: "The flow the agent is operating in as of its latest turn.",
        },
        via_exit_path_id: {
          type: "STRING",
          enum: viaEnum(prevFlow),
          description: "The exit path taken out of the previous flow, or UNKNOWN.",
        },
        confidence: {
          type: "NUMBER",
          description: "0..1 confidence in current_flow_id.",
        },
      },
      required: ["current_flow_id", "via_exit_path_id", "confidence"],
    },
  });
  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic resolution: naive watcher read → reachability-checked attribution.
// "Corrections are the error signal" — where the licensed set has to override the
// naive read (illegal jump), that's the off-spec flag. No second LLM call.
// ─────────────────────────────────────────────────────────────────────────────

export type AttributionStatus =
  | "stay" // same flow as before
  | "legal" // moved via a licensed exit
  | "interrupt" // moved into a (globally licensed) interrupt flow
  | "return" // moved somewhere not via an exit, but the prev flow can RETURN — likely a pop
  | "illegal" // moved to a flow the spec can't reach from here → off-spec, or a missing edge
  | "unknown"; // watcher named a flow id that isn't in the spec

export interface ResolvedAttribution {
  flowId: string; // where we now believe the agent is
  fromFlowId: string; // where it was
  edgeId: string | null; // `${from}__${exitPathId}` when a concrete exit was taken
  exitPathId: string | null;
  status: AttributionStatus;
  confidence: number; // 0..1, clamped
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function resolveTransition(
  prevFlowId: string,
  raw: FlowWatcherRaw,
  table: TransitionTable,
): ResolvedAttribution {
  const confidence = clamp01(raw.confidence);
  const naive = raw.current_flow_id;
  const base = { fromFlowId: prevFlowId, edgeId: null, exitPathId: null, confidence };

  // The watcher named a flow that isn't in the spec — treat as no-move; keep the
  // prior position rather than jumping to a phantom node.
  if (!table.has(naive)) {
    return { ...base, flowId: prevFlowId, status: "unknown" };
  }

  // Same job as before.
  if (naive === prevFlowId) {
    return { ...base, flowId: prevFlowId, status: "stay" };
  }

  // Interrupts are globally licensed — a push is always legal. Derived from the
  // table rather than a passed-in set (the table already encodes interrupts).
  if (interruptFlowIds(table).has(naive)) {
    return { ...base, flowId: naive, status: "interrupt" };
  }

  // Reachable via an authored exit of the previous flow → a legal transition;
  // build the edge id the canvas already animates.
  const exit = findExitTo(table, prevFlowId, naive, raw.via_exit_path_id);
  if (exit && exit.exitPathId) {
    return {
      ...base,
      flowId: naive,
      edgeId: `${prevFlowId}__${exit.exitPathId}`,
      exitPathId: exit.exitPathId,
      status: "legal",
    };
  }

  // Not an exit and not an interrupt. A RETURN pops to a CALLER — a flow with an
  // exit into `prevFlowId`. Only excuse the move as a return when `naive` is
  // actually such a caller AND the previous flow can RETURN; otherwise it's an
  // illegal jump (the agent behaves like a flow the spec can't reach from here).
  // The tighter test stops a returnable flow from masking every off-spec jump.
  const prevCanReturn = (table.get(prevFlowId) ?? []).some((t) => t.kind === "return");
  const naiveIsCaller = findExitTo(table, naive, prevFlowId) !== null;
  return { ...base, flowId: naive, status: prevCanReturn && naiveIsCaller ? "return" : "illegal" };
}
