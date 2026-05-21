import type { RuntimeEvent } from "./eventTypes";

export interface TranscriptTurn {
  role: "agent" | "user";
  text: string;
  ts: number;
  events: RuntimeEvent[];
}
