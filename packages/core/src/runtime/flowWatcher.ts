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

// Path DECODING, not per-turn classification. The earlier per-turn classifier
// was fed a `prevFlowId` point estimate that (a) went stale in auto-runs where
// many turns fire before any attribution resolves and (b) only ever showed one
// flow's exits, so a single wrong guess poisoned everything after it. Instead we
// hand the model the WHOLE graph and the WHOLE transcript and ask it to trace the
// flow at each agent turn as a valid walk from the entry flow — a Viterbi-style
// decode. No fed-forward prior (no error propagation), later turns disambiguate
// earlier ones, and the trail self-corrects on every re-decode.
const SYSTEM_PROMPT = `You are tracing a customer-service agent's path through a spec graph. The spec is a set of "flows" (states); the agent moves between them along exit paths whose conditions are predicates on the conversation, plus interrupts that can fire from anywhere.

You are given the WHOLE graph and the WHOLE conversation. For each AGENT turn, decide which flow the agent is operating in — producing the sequence of flows the conversation walks through. The agent speaks in one natural voice and never announces flow names; infer each flow from what it is actually doing.

How the walk works:
- Every conversation starts in the entry flow.
- Inside a flow the agent DOES that flow's job (its gist); it stays there across turns until a transition fires.
- A transition fires only when the conversation satisfies an EXIT condition of the current flow, an INTERRUPT trigger (from any flow), or a RETURN to a caller. Weigh those predicates — don't switch flows just because the wording drifts.
- So the output is mostly RUNS of the same flow with a few sharp changes, not a different flow every turn.

Rules:
- Use flow ids from the graph ONLY; never invent one.
- Each change should follow a real edge (an exit of the flow you were in, an interrupt, or a return). But if a turn clearly matches a flow that is NOT reachable that way, report it anyway — a genuine off-spec jump is a real signal, not something to hide.
- via_exit_path_id: the exit id taken to enter this flow from the previous turn's flow; "SAME" if the flow did not change; "UNKNOWN" if it changed but you can't tell which exit.
- confidence is 0..1 per turn — low at genuinely ambiguous boundaries.`;

export interface FlowDecodeArgs {
  // The full conversation, oldest→newest. Only role/text are used.
  transcript: { role: "agent" | "user"; text: string }[];
  // Cap on turns sent (from the end). Default: all. Windowing loses the walk's
  // start (the "from entry" anchor), so prefer whole transcripts for short sims.
  maxTurns?: number;
}

// One decoded step per agent turn, in order.
export interface FlowPathStep {
  flow_id: string;
  via_exit_path_id: string | null; // null for SAME / UNKNOWN / unrecognized
  confidence: number;
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

// A flow's line for the EMISSION signal — a gist of what the agent does inside
// it, enough to tell flows apart. (In the decode prompt the graph is sent once
// per call, not repeated per candidate, so we can afford a fuller gist than the
// old per-turn frame did.)
function flowLine(f: Flow): string {
  const gist = f.instructions ?? f.notes ?? "";
  const suffix = gist ? ` — ${truncate(gist, 160)}` : "";
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
    return `    - ${ep.id}: ${cond} → ${target}`;
  });
}

// A flow with ITS OWN exits — the full local transition model. In the decode
// prompt every flow shows its exits (the whole connectivity), so the model can
// trace a globally consistent walk instead of guessing from one flow's exits.
function flowBlock(f: Flow, flowNames: Map<string, string>): string[] {
  const exits = exitLine(f, flowNames);
  return [flowLine(f), ...(exits.length ? exits : ["    (no exits)"])];
}

// The global transition predicates. Interrupts are reachable from ANY flow, so
// their triggers are the single biggest omission if left out — the model would
// have to guess an interrupt jump from behavior alone with no predicate to check.
function interruptBlock(spec: Spec): string[] {
  const interrupts = spec.flows.filter((f) => f.type === "interrupt");
  if (interrupts.length === 0) return [];
  return [
    "",
    "Interrupts — can become the current flow from ANY flow when their trigger matches:",
    ...interrupts.map((f) => {
      const trigger = f.entry_condition?.expression
        ? truncate(f.entry_condition.expression, 100)
        : "(no trigger declared)";
      return `- ${f.id} (${f.name}) — trigger: ${trigger}`;
    }),
  ];
}

// Numbers agent turns so each path entry aligns to one.
function renderTranscript(transcript: { role: "agent" | "user"; text: string }[]): string[] {
  let agentIdx = 0;
  return transcript.map((t) =>
    t.role === "agent"
      ? `agent[${agentIdx++}]: ${truncate(t.text, 400)}`
      : `user: ${truncate(t.text, 400)}`,
  );
}

// The decode user prompt. Exported (pure) so it's unit-testable and renderable.
// Structure: the whole graph (flows + their exits) → global interrupt triggers →
// entry flow → the whole (numbered) transcript → the ask.
export function buildDecodeUserPrompt(spec: Spec, args: FlowDecodeArgs): string {
  const flowNames = new Map(spec.flows.map((f) => [f.id, f.name]));
  const turns = args.maxTurns ? args.transcript.slice(-args.maxTurns) : args.transcript;
  const agentTurns = turns.filter((t) => t.role === "agent").length;

  return [
    "GRAPH — each flow (what the agent does inside it) with its exit paths (which govern movement):",
    ...spec.flows.flatMap((f) => flowBlock(f, flowNames)),
    ...interruptBlock(spec),
    "",
    `Entry flow (every conversation starts here): ${spec.agent.entry_flow_id}`,
    "",
    "TRANSCRIPT (agent turns are numbered):",
    ...renderTranscript(turns),
    "",
    `Output one path entry for each of the ${agentTurns} agent turn(s), in order — the flow the agent is operating in at that turn.`,
  ].join("\n");
}

interface RawStep {
  flow_id: string;
  via_exit_path_id: string;
  confidence: number;
}

function normalizeStep(s: RawStep): FlowPathStep {
  const via = s.via_exit_path_id;
  return {
    flow_id: s.flow_id,
    via_exit_path_id: via && via !== "UNKNOWN" && via !== "SAME" ? via : null,
    confidence: s.confidence,
  };
}

export async function runFlowDecode(
  spec: Spec,
  provider: ProviderId,
  apiKey: string,
  model: string,
  args: FlowDecodeArgs,
): Promise<FlowPathStep[]> {
  const parsed = await generateStructuredJson<{ path: RawStep[] }>(provider, apiKey, model, {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildDecodeUserPrompt(spec, args),
    responseSchema: {
      type: "OBJECT",
      properties: {
        path: {
          type: "ARRAY",
          description: "One entry per agent turn, in order.",
          items: {
            type: "OBJECT",
            properties: {
              flow_id: {
                type: "STRING",
                enum: spec.flows.map((f) => f.id),
                description: "Flow the agent is operating in at this agent turn.",
              },
              via_exit_path_id: {
                type: "STRING",
                description: "Exit id taken to enter this flow; SAME if unchanged; UNKNOWN if changed but unclear.",
              },
              confidence: { type: "NUMBER", description: "0..1 confidence for this turn." },
            },
            required: ["flow_id", "via_exit_path_id", "confidence"],
          },
        },
      },
      required: ["path"],
    },
  });
  return (parsed.path ?? []).map(normalizeStep);
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
  step: FlowPathStep,
  table: TransitionTable,
): ResolvedAttribution {
  const confidence = clamp01(step.confidence);
  const naive = step.flow_id;
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
  const exit = findExitTo(table, prevFlowId, naive, step.via_exit_path_id);
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

// Resolve a decoded path (one step per agent turn) into the canvas fields. Walk
// from the entry flow, resolve each step against the flow believed active before
// it, collect the legal edges and the distinct flow runs, and keep the LAST
// step's resolution as the current attribution (what the live glow shows).
// Rebuilt fresh on every decode, so the whole trail self-corrects rather than
// accreting past mistakes.
export interface ResolvedPath {
  traversedEdgeIds: string[];
  traversedFlowIds: string[];
  current: ResolvedAttribution;
}

export function resolveDecodedPath(
  entryFlowId: string,
  steps: FlowPathStep[],
  table: TransitionTable,
): ResolvedPath | null {
  if (steps.length === 0) return null;
  const traversedEdgeIds: string[] = [];
  const traversedFlowIds: string[] = [entryFlowId];
  let prev = entryFlowId;
  let current: ResolvedAttribution = {
    flowId: entryFlowId,
    fromFlowId: entryFlowId,
    edgeId: null,
    exitPathId: null,
    status: "stay",
    confidence: clamp01(steps[0].confidence),
  };
  for (const step of steps) {
    const resolved = resolveTransition(prev, step, table);
    current = resolved;
    if (resolved.edgeId && !traversedEdgeIds.includes(resolved.edgeId)) {
      traversedEdgeIds.push(resolved.edgeId);
    }
    if (
      resolved.status !== "unknown" &&
      traversedFlowIds[traversedFlowIds.length - 1] !== resolved.flowId
    ) {
      traversedFlowIds.push(resolved.flowId);
    }
    prev = resolved.flowId;
  }
  return { traversedEdgeIds, traversedFlowIds, current };
}
