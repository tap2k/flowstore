import { generateStructuredJson } from "./structuredOutput";
import type { RubricTurn } from "./judgeRubric";
import type { ProviderId } from "@flowstore/core/llm/types";

// Holistic, zero-config evaluation of a transcript against the agent's own
// stated invariants — guardrails and business goals — independent of any test
// case, rubric, or gold. Unlike judgeRubric (per-criterion score) this is a
// single LLM verdict over the whole conversation, mirroring whatsupp2's
// analysis.js agent-test branch but stripped of scenario/should_happen/gold
// inputs. The only inputs are things already on every spec, so it works on any
// session — including a hand-typed manual chat with no test scaffolding.
//
// Pure runtime helper — no spec / browser dependency. Caller pulls
// spec.agent.guardrails and the resolved system
// prompt out of the session and passes them in.

export interface GuardrailCheck {
  statement: string;
  // n/a = the guardrail didn't apply to anything that happened in this
  // conversation (no opportunity to violate or honor it).
  met: "yes" | "no" | "n/a";
  reason: string;
}

export interface HallucinationCheck {
  // The unsupported claim the agent made — quoted or closely paraphrased.
  claim: string;
  // 0-based transcript index of the agent turn that made the claim.
  turn: number;
  reason: string;
}

export interface GuardrailVerdict {
  // Skip / error sentinel — when set, the other fields are empty defaults.
  status: "ok" | "skipped";
  summary: string;
  verdict: "pass" | "partial" | "fail";
  // routing = agent took the wrong path / missed intent; within_node = right
  // path but poor response quality, tone, or accuracy; memory = forgot or
  // re-asked for info already provided; none = nothing went wrong.
  failure_mode: "routing" | "within_node" | "memory" | "none";
  // Indices into the transcript (0-based) where the agent failed.
  failure_turns: number[];
  guardrails: GuardrailCheck[];
  // Unsupported factual claims the agent made — statements not grounded in the
  // system prompt or conversation context. Grounding is universal, so this is
  // judged on every transcript regardless of declared guardrails/goals, and any
  // entry forces verdict = fail.
  hallucinations: HallucinationCheck[];
}

const SYSTEM_PROMPT =
  "You are an impartial expert at evaluating AI chatbot and agent performance in user conversations. You judge only the AGENT's behavior, never the user's.";

function formatTranscript(transcript: RubricTurn[]): string {
  return transcript
    .map(
      (t, i) =>
        `[${i}] ${t.role === "agent" ? "AGENT" : "CUSTOMER"}: ${t.text}`,
    )
    .join("\n");
}

function emptyVerdict(status: GuardrailVerdict["status"], summary: string): GuardrailVerdict {
  return {
    status,
    summary,
    verdict: "pass",
    failure_mode: "none",
    failure_turns: [],
    guardrails: [],
    hallucinations: [],
  };
}

const VALID_MET = new Set(["yes", "no", "n/a"]);

export async function judgeGuardrails(args: {
  guardrails: string[];
  systemPrompt: string | null;
  transcript: RubricTurn[];
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}): Promise<GuardrailVerdict> {
  const { guardrails, systemPrompt, transcript, provider, apiKey, model, baseUrl } = args;

  // No early skip on empty guardrails/goals: hallucination grounding is
  // universal — we still judge whether the agent stayed grounded in its system
  // prompt and context even when the spec declares no explicit invariants.

  // Judging a 1-2 turn opener is noise. Mirror judgeRubric's floor.
  if (transcript.length < 3) {
    return emptyVerdict(
      "skipped",
      `transcript too short to evaluate (${transcript.length} turns, min 3)`,
    );
  }

  const guardrailsBlock =
    guardrails.length > 0
      ? `Agent guardrails (cross-cutting behavioral invariants that must hold across the whole conversation — judge each one):\n${guardrails
          .map((g) => `- ${g}`)
          .join("\n")}`
      : "";

  const userPrompt = `Evaluate this chatbot/AI agent's performance in a conversation with a user.

CRITICAL — HALLUCINATIONS: If the agent stated information that is not supported by its system prompt or the conversation context, treat that as a failure — we are strict about hallucinations. List every such unsupported claim in the hallucinations array, each with the 0-based transcript index of the agent turn that made it. Grounding is judged on every conversation, independent of any guardrail below. When judging whether a behavior occurred, account for information the user volunteered or made obvious; score against each rule's purpose, not its literal surface form.
${systemPrompt ? `\nThe agent's system prompt (use it to judge whether the agent followed its own rules and whether its claims are grounded):\n---\n${systemPrompt}\n---\n` : ""}
${guardrailsBlock ? `\n${guardrailsBlock}\n` : ""}
Analyze only the AGENT's turns. For each guardrail decide met = yes | no | n/a (n/a when the conversation gave no opportunity to honor or violate it). Set verdict = fail if any guardrail was violated (met "no") OR any hallucination was found, otherwise pass. Classify the dominant failure with failure_mode, and list the 0-based transcript indices of the agent turns where problems occurred.

Transcript:
${formatTranscript(transcript)}`;

  try {
    const parsed = await generateStructuredJson<{
      summary: string;
      verdict: string;
      failure_mode: string;
      failure_turns: number[];
      guardrails: { statement: string; met: string; reason: string }[];
      hallucinations: { claim: string; turn: number; reason: string }[];
    }>(provider, apiKey, model, {
      baseUrl,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          verdict: { type: "STRING" },
          failure_mode: { type: "STRING" },
          failure_turns: { type: "ARRAY", items: { type: "INTEGER" } },
          guardrails: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                statement: { type: "STRING" },
                met: { type: "STRING" },
                reason: { type: "STRING" },
              },
            },
          },
          hallucinations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                claim: { type: "STRING" },
                turn: { type: "INTEGER" },
                reason: { type: "STRING" },
              },
            },
          },
        },
      },
    });

    const hallucinations: HallucinationCheck[] = (parsed.hallucinations ?? [])
      .filter((h) => h && (h.claim ?? "").trim().length > 0)
      .map((h) => ({
        claim: h.claim ?? "",
        turn: Number.isInteger(h.turn) ? h.turn : -1,
        reason: h.reason ?? "",
      }));

    // Normalize free-text enum fields defensively — the schema uses plain
    // STRING (so the OpenAI/Gemini strict paths stay drop-in) and trusts the
    // prompt to constrain values. A hallucination is an unconditional fail,
    // regardless of what the model put in `verdict`.
    // Goals are informational only — partial is no longer a valid verdict.
    // Verdict is fail iff any hallucination found or any guardrail violated.
    const verdict = hallucinations.length > 0 || parsed.verdict === "fail" ? "fail" : "pass";
    const failureMode = (["routing", "within_node", "memory", "none"] as const).includes(
      parsed.failure_mode as never,
    )
      ? (parsed.failure_mode as GuardrailVerdict["failure_mode"])
      : "none";
    // Surface the turns that hallucinated alongside any the model flagged, so
    // the transcript can highlight all problem turns uniformly.
    const modelFailureTurns = Array.isArray(parsed.failure_turns)
      ? parsed.failure_turns.filter((n) => Number.isInteger(n))
      : [];
    const failureTurns = [
      ...new Set([
        ...modelFailureTurns,
        ...hallucinations.map((h) => h.turn).filter((n) => n >= 0),
      ]),
    ];
    return {
      status: "ok",
      summary: parsed.summary ?? "",
      verdict,
      failure_mode: failureMode,
      failure_turns: failureTurns,
      guardrails: (parsed.guardrails ?? []).map((g) => ({
        statement: g.statement ?? "",
        met: (VALID_MET.has(g.met) ? g.met : "n/a") as GuardrailCheck["met"],
        reason: g.reason ?? "",
      })),
      hallucinations,
    };
  } catch (e) {
    return emptyVerdict(
      "skipped",
      `judge error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
