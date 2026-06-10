import type { Spec } from "@flowstore/core/schema/v0";
import type { RuntimeEvent } from "./eventTypes";

export interface StartSessionResponse {
  session_id: string;
  agent_text: string;
  events: RuntimeEvent[];
  ended: boolean;
}

export interface TurnResponse {
  agent_text: string;
  events: RuntimeEvent[];
  ended: boolean;
}

export class RunnerUnreachableError extends Error {
  constructor(baseUrl: string) {
    super(
      `Runner unreachable at ${baseUrl} — start your runtime server, or change the URL in Settings.`,
    );
    this.name = "RunnerUnreachableError";
  }
}

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RunnerUnreachableError(baseUrl);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text ? `${res.status} ${res.statusText}: ${text}` : `${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

export interface StartSessionArgs {
  baseUrl: string;
  spec: Spec;
  apiKey?: string;
  model?: string;
  // Omit to go multilingual: the runner treats an absent language as "emit
  // every declared language" so the caller can switch mid-conversation. A
  // present code pins the session to one language.
  language?: string;
  contextVars?: Record<string, unknown>;
  mockReturns?: Record<string, Record<string, unknown>>;
}

export async function startSession(args: StartSessionArgs): Promise<StartSessionResponse> {
  const body: Record<string, unknown> = { spec: args.spec };
  if (args.apiKey) body.api_key = args.apiKey;
  if (args.model) body.model = args.model;
  if (args.language) body.language = args.language;
  if (args.contextVars && Object.keys(args.contextVars).length > 0) {
    body.context_vars = args.contextVars;
  }
  if (args.mockReturns && Object.keys(args.mockReturns).length > 0) {
    body.mock_returns = args.mockReturns;
  }
  return postJson<StartSessionResponse>(args.baseUrl, "/api/chat/session", body);
}

export async function sendTurn(args: {
  baseUrl: string;
  sessionId: string;
  userText: string;
}): Promise<TurnResponse> {
  return postJson<TurnResponse>(args.baseUrl, "/api/chat/turn", {
    session_id: args.sessionId,
    user_text: args.userText,
  });
}

export async function endSession(baseUrl: string, sessionId: string): Promise<void> {
  try {
    await postJson<{ ok: boolean }>(baseUrl, "/api/chat/end", { session_id: sessionId });
  } catch {
    // Best-effort. Idle GC will clean up if this fails.
  }
}
