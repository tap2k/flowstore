import type { Spec } from "@/lib/schema/v0";

// Extract a JSON object from an LLM response. Tolerates a `​```json` fence and,
// as a last resort, picks out the first `{...}` block. Returns null when the
// text doesn't contain a parseable object.
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const direct = tryParseObject(stripped);
  if (direct) return direct;
  const match = stripped.match(/\{[\s\S]*\}/);
  return match ? tryParseObject(match[0]) : null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

export function agentContextPreamble(spec: Spec): string[] {
  const lines = [`Agent purpose: ${spec.agent.meta.purpose || "(not specified)"}`];
  if (spec.agent.meta.client) lines.push(`Client: ${spec.agent.meta.client}`);
  return lines;
}
