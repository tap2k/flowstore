import type { RuntimeEvent } from "./eventTypes";

export interface TranscriptTurn {
  role: "agent" | "user";
  text: string;
  ts: number;
  events: RuntimeEvent[];
  // Wall-clock latency of the dispatch that produced this turn, in
  // milliseconds. Set on agent turns only (user turns are typed instantly,
  // or arrive from the persona generator — see personaLatencyMs).
  // For prompt mode this is the LLM call alone; for runner mode it's the
  // round-trip including server-side capability dispatch.
  latencyMs?: number;
}
