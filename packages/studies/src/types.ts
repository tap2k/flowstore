import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { ChatUsage, ProviderId } from "@flowstore/core/llm/types";

// A scenario is a scripted conversation: ordered role-tagged turns, a
// language, and a scenario_id shared across language renderings (the study's
// cross-language join key). User turns are the script the runner sends;
// agent turns, when present, are the expected replies — the gold standard the
// divergence pass reads against. Serialized as flowstore://test/case/v0
// (user side) plus flowstore://test/gold/v0 (full conversation) — the
// case/gold split is serialization only, this type is the whole thing.
export type ScenarioTurn = {
  role: "user" | "agent";
  text: string;
};

export type Scenario = {
  id: string;
  scenarioId: string;
  name: string;
  language: string;
  turns: ScenarioTurn[];
  // Round-trip identity: the file path of the gold these agent turns were
  // merged from at import. Export writes the gold back to this path (golds
  // bind by id, not filename — without it an edited import would duplicate).
  goldPath?: string;
};

const userTexts = (turns: { role: string; text: string }[]): string[] =>
  turns.filter((t) => t.role === "user").map((t) => t.text);

const sameScript = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

// The script — user-turn texts in order, what the runner sends. All the
// runner's pair arithmetic (script index i ↔ transcript index 2i) holds
// against this, not against `turns`.
export const scriptOf = (sc: Scenario): string[] => userTexts(sc.turns);

// The gold standard — expected agent turns. Empty = no baseline: cells are
// side-by-side reading material, no divergence verdict.
export const goldOf = (sc: Scenario): ScenarioTurn[] =>
  sc.turns.filter((t) => t.role === "agent");

// Transcript → scenario turns: trim, drop empties, strip run artifacts
// (ts/latency/events). Used by save-as-gold.
export const toScenarioTurns = (turns: TranscriptTurn[]): ScenarioTurn[] =>
  turns
    .map((t) => ({ role: t.role, text: t.text.trim() }))
    .filter((t) => t.text.length > 0);

// A gold merges into a scenario only when the two agree on the script —
// same user turns, same order. Returns the gold's turns (the fuller
// conversation) on match, null otherwise. One rule shared by bundle import
// and the storage migration, so both doors admit the same golds.
export const mergeGoldTurns = (
  scenarioTurns: ScenarioTurn[],
  goldTurns: ScenarioTurn[],
): ScenarioTurn[] | null =>
  sameScript(userTexts(goldTurns), userTexts(scenarioTurns))
    ? // Clone deliberately: legacy storage golds can carry extra fields.
      goldTurns.map((t) => ({ role: t.role, text: t.text }))
    : null;

// Resolved credentials for one model column. The engine is isomorphic — it
// never reads a settings store or env; the surface (browser page, node CLI)
// resolves and injects these.
export type ModelDispatch = {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  wireModel: string;
  // Speech-to-speech column: dispatch over the provider's live socket (text
  // turns in, audio + transcription out) instead of chat completions. The
  // runner picks the driver by provider (S2S_DRIVERS).
  live?: boolean;
  // Speaker persona for live sessions (vendor's namespace; blank/absent =
  // vendor default).
  voice?: string;
};

export type CellStatus = "idle" | "running" | "done" | "error";

export type CellState = {
  status: CellStatus;
  turns: TranscriptTurn[];
  usage?: ChatUsage;
  totalMs: number;
  error?: string;
  // Set by the divergence pass: true when this cell's agent behavior
  // diverges from the scenario's gold turns (cheap lexical signal — a
  // "look here" marker, not a verdict). Absent when the scenario has no
  // gold or the cell went off-script.
  divergent?: boolean;
};

export const IDLE_CELL: CellState = { status: "idle", turns: [], totalMs: 0 };

// A conversation is on-script when its user side is exactly the scenario's
// script. One definition gates both the divergence verdict (runner) and
// save-as-gold (compare UI), so the two can't silently disagree.
export const cellOnScript = (c: CellState, sc: Scenario): boolean =>
  sameScript(userTexts(c.turns), scriptOf(sc));

// Cell key convention used across runner, report, and bundle. Keyed by COLUMN
// INDEX, not model id: the same model may legitimately appear in two columns
// (variance testing), and the default state does exactly that — model-keyed
// cells would collide and interleave concurrent writes.
export const cellKey = (scenarioId: string, column: number): string =>
  `${scenarioId}::${column}`;

import type { VoiceRates } from "./voiceCost";

export type Study = {
  title: string;
  prompt: string;
  models: string[];
  scenarios: Scenario[];
  cells: Record<string, CellState>;
  // User-supplied cascade rates (display assumption, not an artifact); when
  // present the report adds the estimated voice-cost column.
  voiceRates?: VoiceRates;
};
