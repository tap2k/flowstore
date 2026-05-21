import type { RuntimeEvent } from "./eventTypes";

// Render a runtime event as a single-line summary. Returns null for events
// that are redundant with other UI (turn bubbles, flow_exited paired with
// exit_path_taken). `formatValue` controls how variable_set values are
// rendered — UI consumers truncate for brevity, LLM transcripts keep JSON.
export function formatEvent(
  ev: RuntimeEvent,
  formatValue: (v: unknown) => string = (v) => JSON.stringify(v),
): string | null {
  switch (ev.type) {
    case "session_started":
      return `session_started(${ev.lang})`;
    case "session_ended":
      return `session_ended(${ev.reason})`;
    case "flow_entered":
      return `flow_entered(${ev.flow_id}${ev.via !== "transition" ? `, via=${ev.via}` : ""})`;
    case "flow_exited":
      return null; // redundant with exit_path_taken
    case "exit_path_taken":
      return `exit_path_taken(${ev.from_flow_id} → ${ev.to_flow_id ?? "∅"}, ${ev.method})`;
    case "interrupt_triggered":
      return `interrupt_triggered(${ev.from_flow_id} → ${ev.interrupt_flow_id})`;
    case "turn_started":
    case "turn_completed":
      return null; // implied by transcript bubbles
    case "variable_set":
      return `variable_set(${ev.variable_name} = ${formatValue(ev.value)}, ${ev.method})`;
    case "capability_invoked":
      return `capability_invoked(${ev.capability_name})`;
    case "capability_returned":
      return ev.error
        ? `capability_returned(${ev.capability_name}, error=${ev.error})`
        : `capability_returned(${ev.capability_name})`;
    case "error":
      return `error(${ev.code}: ${ev.message})`;
  }
}

// Compact UI-friendly value renderer: truncates strings, hides objects.
export function formatValueTruncated(v: unknown, maxLen = 30): string {
  if (typeof v === "string") {
    const s = v.length > maxLen ? `${v.slice(0, maxLen)}…` : v;
    return `"${s}"`;
  }
  if (v === null || typeof v === "number" || typeof v === "boolean") return String(v);
  return "…";
}
