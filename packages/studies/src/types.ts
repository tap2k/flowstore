import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";
import type { ChatUsage, ProviderId } from "@flowstore/core/llm/types";

// A scenario is a scripted test case in miniature: ordered user turns, a
// language, and a scenario_id shared across language renderings (the study's
// cross-language join key). Serialized as flowstore://test/case/v0.
export type Scenario = {
  id: string;
  scenarioId: string;
  name: string;
  language: string;
  turns: string[];
};

// Resolved credentials for one model column. The engine is isomorphic — it
// never reads a settings store or env; the surface (browser page, node CLI)
// resolves and injects these.
export type ModelDispatch = {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  wireModel: string;
};

export type CellStatus = "idle" | "running" | "done" | "error";

export type CellState = {
  status: CellStatus;
  turns: TranscriptTurn[];
  usage?: ChatUsage;
  totalMs: number;
  error?: string;
  // Set after the incumbent column finishes: true when this cell's agent
  // behavior diverges from the incumbent's on the same scenario (cheap
  // lexical signal — a "look here" marker, not a verdict).
  divergent?: boolean;
};

export const IDLE_CELL: CellState = { status: "idle", turns: [], totalMs: 0 };

// Cell key convention used across runner, report, and bundle. Keyed by COLUMN
// INDEX, not model id: the same model may legitimately appear in two columns
// (variance testing), and the default state does exactly that — model-keyed
// cells would collide and interleave concurrent writes.
export const cellKey = (scenarioId: string, column: number): string =>
  `${scenarioId}::${column}`;

export type Study = {
  title: string;
  prompt: string;
  models: string[];
  incumbent: string;
  scenarios: Scenario[];
  cells: Record<string, CellState>;
  monthlyConversations: number;
};
