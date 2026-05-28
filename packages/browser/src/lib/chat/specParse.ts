import specParsePrompt from "@root/AGENT-SPEC-PROMPT.txt?raw";
import { chat } from "@flowstore/core/llm/dispatch";
import type { ProviderId, ProviderOptions } from "@flowstore/core/llm/types";
import { validateSpec, formatErrors } from "@flowstore/core/validation/ajv";
import type { Spec } from "@flowstore/core/schema/v0";

// The exact prompt docs link to (AGENT-SPEC-PROMPT.txt), bundled so the
// in-editor parser stays identical to the copy users paste into an external LLM.
export const SPEC_PARSE_PROMPT = specParsePrompt;

export interface SourceFile {
  name: string;
  content: string;
}

export type SpecParseResult =
  | { ok: true; spec: Spec }
  | { ok: false; error: string; errors?: string[] };

// Source material the analyst prompt reads. Files are wrapped so a multi-file
// drop stays attributable; free-text notes (e.g. "this is the latest script")
// ride along as guidance.
function buildSourceMessage(files: SourceFile[], notes: string): string {
  const blocks = files.map(
    (f) => `<file name=${JSON.stringify(f.name)}>\n${f.content}\n</file>`,
  );
  const trimmed = notes.trim();
  if (trimmed) blocks.push(`<notes>\n${trimmed}\n</notes>`);
  return blocks.join("\n\n");
}

// The prompt asks for a bare JSON object, but models occasionally wrap it in a
// code fence or add a stray sentence. Recover the object before parsing.
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

// One-shot wrapper around AGENT-SPEC-PROMPT: run the attached source material
// through the model, parse the JSON it returns, and validate it against the v0
// schema. No tools, no agent loop — the prompt emits a complete spec in one turn.
export async function parseSourceToSpec(
  provider: ProviderId,
  apiKey: string,
  wireModel: string,
  files: SourceFile[],
  notes: string,
  opts: ProviderOptions = {},
): Promise<SpecParseResult> {
  const res = await chat(
    provider,
    apiKey,
    wireModel,
    {
      systemPrompt: SPEC_PARSE_PROMPT,
      messages: [{ role: "user", content: buildSourceMessage(files, notes) }],
      tools: [],
    },
    opts,
  );

  // A truncated response is the common failure on endpoints with a low output
  // cap: the JSON is cut off mid-object. Name it so the fix (a model with more
  // output room) is obvious, rather than the generic "invalid JSON".
  if (res.stopReason === "max_tokens") {
    return {
      ok: false,
      error: "The model hit its output limit before finishing the spec. Try a model with a larger output cap, or fewer/smaller source files.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(res.text));
  } catch {
    return { ok: false, error: "The model did not return valid JSON. Try again or a stronger model." };
  }

  const v = validateSpec(parsed);
  if (!v.valid) {
    return {
      ok: false,
      error: "The generated spec failed schema validation.",
      errors: formatErrors(v.errors).slice(0, 30),
    };
  }
  return { ok: true, spec: v.spec };
}
