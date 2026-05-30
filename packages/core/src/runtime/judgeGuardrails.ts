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
// spec.agent.guardrails / spec.agent.business_goals and the resolved system
// prompt out of the session and passes them in.

export interface GuardrailCheck {
  statement: string;
  // n/a = the guardrail didn't apply to anything that happened in this
  // conversation (no opportunity to violate or honor it).
  met: "yes" | "no" | "n/a";
  reason: string;
}

export interface BusinessGoalCheck {
  id: string;
  met: "yes" | "partially" | "no" | "n/a";
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
  business_goals: BusinessGoalCheck[];
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
    business_goals: [],
  };
}

const VALID_MET = new Set(["yes", "no", "n/a"]);
const VALID_GOAL_MET = new Set(["yes", "partially", "no", "n/a"]);

export async function judgeGuardrails(args: {
  guardrails: string[];
  businessGoals: { id: string; name: string; expression: string }[];
  systemPrompt: string | null;
  transcript: RubricTurn[];
  provider: ProviderId;
  apiKey: string;
  model: string;
}): Promise<GuardrailVerdict> {
  const { guardrails, businessGoals, systemPrompt, transcript, provider, apiKey, model } = args;

  if (guardrails.length === 0 && businessGoals.length === 0) {
    return emptyVerdict("skipped", "no guardrails or business goals defined on this agent");
  }

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
  const goalsBlock =
    businessGoals.length > 0
      ? `Business goals (end-to-end outcomes the agent is judged against — score each independently):\n${businessGoals
          .map((g) => `- [${g.id}] ${g.name}: ${g.expression}`)
          .join("\n")}`
      : "";

  const userPrompt = `Evaluate this chatbot/AI agent's performance in a conversation with a user.

CRITICAL: If the agent stated information that is not supported by its system prompt or the conversation context, treat that as a failure — we are strict about hallucinations. When judging whether a behavior occurred, account for information the user volunteered or made obvious; score against each rule's purpose, not its literal surface form.
${systemPrompt ? `\nThe agent's system prompt (use it to judge whether the agent followed its own rules):\n---\n${systemPrompt}\n---\n` : ""}
${guardrailsBlock ? `\n${guardrailsBlock}\n` : ""}${goalsBlock ? `\n${goalsBlock}\n` : ""}
Analyze only the AGENT's turns. For each guardrail decide met = yes | no | n/a (n/a when the conversation gave no opportunity to honor or violate it). For each business goal decide met = yes | partially | no | n/a. Set verdict = fail if any guardrail was violated (met "no"), partial if a business goal was only partially met but no guardrail was broken, otherwise pass. Classify the dominant failure with failure_mode, and list the 0-based transcript indices of the agent turns where problems occurred.

Transcript:
${formatTranscript(transcript)}`;

  try {
    const parsed = await generateStructuredJson<{
      summary: string;
      verdict: string;
      failure_mode: string;
      failure_turns: number[];
      guardrails: { statement: string; met: string; reason: string }[];
      business_goals: { id: string; met: string; reason: string }[];
    }>(provider, apiKey, model, {
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
          business_goals: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                met: { type: "STRING" },
                reason: { type: "STRING" },
              },
            },
          },
        },
      },
    });

    // Normalize free-text enum fields defensively — the schema uses plain
    // STRING (so the OpenAI/Gemini strict paths stay drop-in) and trusts the
    // prompt to constrain values.
    const verdict =
      parsed.verdict === "fail" || parsed.verdict === "partial"
        ? parsed.verdict
        : "pass";
    const failureMode = (["routing", "within_node", "memory", "none"] as const).includes(
      parsed.failure_mode as never,
    )
      ? (parsed.failure_mode as GuardrailVerdict["failure_mode"])
      : "none";
    return {
      status: "ok",
      summary: parsed.summary ?? "",
      verdict,
      failure_mode: failureMode,
      failure_turns: Array.isArray(parsed.failure_turns)
        ? parsed.failure_turns.filter((n) => Number.isInteger(n))
        : [],
      guardrails: (parsed.guardrails ?? []).map((g) => ({
        statement: g.statement ?? "",
        met: (VALID_MET.has(g.met) ? g.met : "n/a") as GuardrailCheck["met"],
        reason: g.reason ?? "",
      })),
      business_goals: (parsed.business_goals ?? []).map((g) => ({
        id: g.id ?? "",
        met: (VALID_GOAL_MET.has(g.met) ? g.met : "n/a") as BusinessGoalCheck["met"],
        reason: g.reason ?? "",
      })),
    };
  } catch (e) {
    return emptyVerdict(
      "skipped",
      `judge error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
