import Ajv, { type ValidateFunction } from "ajv";
import { chat } from "../llm/dispatch";
import type { ChatMessage, ProviderId } from "../llm/types";
import { extractLooseJson } from "./jsonRecovery";
import { toJsonSchema } from "./openaiJson";

// Structured output over plain chat, for providers with no strict-schema
// mode (OpenRouter / generic openai-compatible). The contract matches the
// strict paths: the reply must validate against the SAME translated JSON
// Schema the OpenAI strict path enforces — checked with ajv here, since the
// provider won't. One corrective retry feeds the validation errors back;
// then the call throws like any other provider failure (consumers already
// treat that non-fatally or per-item).
//
// Known limitation: ChatRequest has no output-token cap, so a very large
// response schema on a verbose model can truncate mid-JSON and surface as a
// parse failure after the retry. Acceptable for the current consumers (the
// watcher fails soft; judge schemas are small).

// Module-local Ajv instance, separate from validation/ajv.ts on purpose:
// that one is configured (formats, spec compilation) for artifact
// validation; this one only checks chat replies against translated response
// schemas. Sharing would couple runtime dispatch to the validation module.
const ajv = new Ajv({ allErrors: true, strict: false });
// Cache compiled validators by schema object identity — consumer schemas are
// module-level constants, so this hits after the first call.
const compiledCache = new WeakMap<object, ValidateFunction>();

function validatorFor(responseSchema: Record<string, unknown>): ValidateFunction {
  let v = compiledCache.get(responseSchema);
  if (!v) {
    v = ajv.compile(toJsonSchema(responseSchema) as object);
    compiledCache.set(responseSchema, v);
  }
  return v;
}

export interface ChatJsonOpts {
  systemPrompt?: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  baseUrl?: string;
}

export async function generateJsonChat<T = unknown>(
  provider: ProviderId,
  apiKey: string,
  model: string,
  opts: ChatJsonOpts,
): Promise<T> {
  const validate = validatorFor(opts.responseSchema);
  const schemaText = JSON.stringify(toJsonSchema(opts.responseSchema));
  const systemPrompt =
    (opts.systemPrompt ? opts.systemPrompt + "\n\n" : "") +
    "Reply with ONLY a JSON value that matches this JSON Schema exactly — no commentary, no code fences:\n" +
    schemaText;

  const messages: ChatMessage[] = [{ role: "user", content: opts.userPrompt }];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat(
      provider,
      apiKey,
      model,
      { systemPrompt, messages, tools: [] },
      { baseUrl: opts.baseUrl },
    );
    const parsed = extractLooseJson(res.text);
    if (parsed !== null && validate(parsed)) return parsed as T;
    lastError = parsed === null ? "the reply was not parseable JSON" : ajv.errorsText(validate.errors);
    // Feed the failure back as conversation so the retry is corrective, not
    // a blind re-roll.
    messages.push(
      { role: "assistant", content: res.text },
      {
        role: "user",
        content: `That reply was invalid: ${lastError}. Reply again with ONLY corrected JSON matching the schema.`,
      },
    );
  }
  throw new Error(`Structured output failed validation after retry: ${lastError}`);
}
