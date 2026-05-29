import { generateJson } from "./geminiJson";
import type { Rubric } from "@flowstore/core/schema/files/rubric";
import type { Gold } from "@flowstore/core/schema/files/gold";

// Mirror of awaaz-dpd31's scripts/_judge.py judge_one: substitutes the
// rubric's prompt_template placeholders, calls a judge LLM with
// structured output {score, notes}, clamps score to the rubric's scale.
// Pure runtime helper — no spec / browser dependency. Substituted
// placeholders match the Python reference exactly:
//   {criteria}      → rubric.criteria
//   {transcript}    → formatted agent+user transcript
//   {gold_standard} → gold turns formatted, or "(no gold provided)"
//   {scale.min}     → rubric.scale.min
//   {scale.max}     → rubric.scale.max

export interface RubricTurn {
  role: "agent" | "user";
  text: string;
}

export interface RubricVerdict {
  score: number | null;
  notes: string;
}

const SYSTEM_PROMPT =
  "You are an impartial judge. Read the transcript and return a score per the rubric.";

function formatTranscript(transcript: RubricTurn[]): string {
  return transcript
    .map(
      (t, i) =>
        `[turn ${i + 1}] ${t.role === "agent" ? "AGENT" : "CUSTOMER"}: ${t.text}`,
    )
    .join("\n");
}

function formatGold(gold: Gold | null | undefined): string {
  if (!gold || !gold.turns) return "(no gold provided)";
  return gold.turns
    .map(
      (t, i) =>
        `[turn ${i + 1}] ${t.role === "agent" ? "AGENT" : "CUSTOMER"}: ${t.text}`,
    )
    .join("\n");
}

export async function judgeRubric(args: {
  rubric: Rubric;
  transcript: RubricTurn[];
  gold?: Gold | null;
  apiKey: string;
  model: string;
}): Promise<RubricVerdict> {
  const { rubric, transcript, gold, apiKey, model } = args;

  // Skip very short transcripts — judging a 1-turn opener is noise. The
  // Python reference uses 3 as the floor; mirror.
  if (transcript.length < 3) {
    return {
      score: null,
      notes: `skipped — transcript truncated at ${transcript.length} turns (min 3)`,
    };
  }

  const scale = rubric.scale ?? { min: 1, max: 5 };
  const judgePrompt = rubric.prompt_template
    .replace("{criteria}", rubric.criteria ?? "")
    .replace("{transcript}", formatTranscript(transcript))
    .replace("{gold_standard}", formatGold(gold))
    .replace("{scale.min}", String(scale.min))
    .replace("{scale.max}", String(scale.max));

  try {
    const parsed = await generateJson<{ score: number; notes: string }>(
      apiKey,
      rubric.model ?? model,
      {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: judgePrompt,
        responseSchema: {
          type: "OBJECT",
          properties: {
            score: { type: "INTEGER" },
            notes: { type: "STRING" },
          },
          required: ["score", "notes"],
        },
      },
    );
    const clamped = Math.max(scale.min, Math.min(scale.max, parsed.score));
    return { score: clamped, notes: parsed.notes };
  } catch (e) {
    return {
      score: null,
      notes: `judge error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
