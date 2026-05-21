import { chat, DEFAULT_PROVIDER } from "@ux4/core/llm/dispatch";
import { coerceScalarValue, type Spec } from "@ux4/core/schema/v0";
import { agentContextPreamble, parseJsonObject } from "./llmJson";
import type { DeclaredVariable } from "./contextVars";

const SYSTEM_PROMPT = `You generate realistic test values for variables declared in an agent specification.

Make values coherent — variables that describe a single user/scenario should be consistent (a phone number, name, account id, balance, etc., should all describe the same plausible person). Use realistic-sounding values, NOT obvious placeholders like "Test User" or "12345".

Return ONLY a JSON object mapping variable names to values. Use the declared type (string/number/boolean/enum). For enums, pick from the provided allowed values. No commentary, no markdown fence.`;

export async function generateContextVars(
  spec: Spec,
  apiKey: string,
  model: string,
  declared: DeclaredVariable[],
): Promise<Record<string, unknown>> {
  if (declared.length === 0) return {};

  const variableSpec = declared.map((d) => ({
    name: d.name,
    type: d.decl.type ?? "string",
    description: d.decl.description ?? "",
    enum_values: d.decl.values,
  }));

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
    `Declared variables:`,
    JSON.stringify(variableSpec, null, 2),
    "",
    `Return the JSON object now.`,
  ].join("\n");

  const res = await chat(DEFAULT_PROVIDER, apiKey, model, {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [],
  });

  const parsed = parseJsonObject(res.text);
  if (!parsed) {
    throw new Error("Generator did not return parseable JSON.");
  }

  const byName = new Map(declared.map((d) => [d.name, d.decl]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const decl = byName.get(k);
    if (!decl) continue;
    const coerced = coerceScalarValue(decl, v);
    if (coerced !== undefined) out[k] = coerced;
  }
  return out;
}
