import type { AgentEndpoint } from "@flowstore/core/files/models";

export interface AgentTurnResponse {
  text: string;
  ended: boolean;
}

// Substitute {{session_id}} and {{input}} in a string.
function interpolate(template: string, sessionId: string, input: string): string {
  return template
    .replace(/\{\{session_id\}\}/g, sessionId)
    .replace(/\{\{input\}\}/g, input);
}

// Recursively walk a JSON-serializable value, substituting {{...}} in strings.
function interpolateDeep(value: unknown, sessionId: string, input: string): unknown {
  if (typeof value === "string") return interpolate(value, sessionId, input);
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, sessionId, input));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, sessionId, input);
    }
    return out;
  }
  return value;
}

// Extract a value from a nested object using dot-notation path (e.g. "data.message").
// Array indices are supported: "choices.0.content".
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur === "object") return (cur as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// Generate a UUID v4 (browser-compatible, no crypto dependency required for
// random UUIDs in modern environments).
export function generateSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function sendAgentTurn(
  agent: AgentEndpoint,
  sessionId: string,
  userText: string,
): Promise<AgentTurnResponse> {
  const url = interpolate(agent.turn_url, sessionId, userText);
  const method = agent.turn_method ?? "POST";

  const body = agent.turn_body !== undefined
    ? JSON.stringify(interpolateDeep(agent.turn_body, sessionId, userText))
    : undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...agent.turn_headers,
  };

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch {
    throw new Error(`Agent unreachable at ${url}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text ? `${res.status} ${res.statusText}: ${text}` : `${res.status} ${res.statusText}`);
  }

  const json = await res.json() as unknown;
  const text = getPath(json, agent.response_text_path);
  const ended = agent.ended_path ? Boolean(getPath(json, agent.ended_path)) : false;

  return {
    text: typeof text === "string" ? text : String(text ?? ""),
    ended,
  };
}
