import { coerceScalarValue, type Spec, type VariableDecl } from "@flowstore/core/schema/v0";
import { generateJson } from "./geminiJson";
import { agentContextPreamble } from "./llmJson";
import type { DeclaredVariable } from "./contextVars";

const SYSTEM_PROMPT = `You generate realistic test values for variables declared in an agent specification.

Make values coherent — variables that describe a single user/scenario should be consistent (a phone number, name, account id, balance, etc., should all describe the same plausible person). Use realistic-sounding values, NOT obvious placeholders like "Test User" or "12345".

For enums, pick from the provided allowed values.`;

function geminiTypeFor(decl: VariableDecl): string {
  const t = decl.type ?? "string";
  if (t === "number") return "NUMBER";
  if (t === "boolean") return "BOOLEAN";
  return "STRING";
}

function propertySchemaFor(decl: VariableDecl): Record<string, unknown> {
  const prop: Record<string, unknown> = { type: geminiTypeFor(decl) };
  if (decl.description) prop.description = decl.description;
  if (decl.values && decl.values.length > 0) {
    // Gemini supports `enum` only on STRING properties; coerce so the
    // constraint actually applies.
    prop.type = "STRING";
    prop.enum = decl.values.map((v) => String(v));
  }
  return prop;
}

export async function generateContextVars(
  spec: Spec,
  apiKey: string,
  model: string,
  declared: DeclaredVariable[],
): Promise<Record<string, unknown>> {
  if (declared.length === 0) return {};

  const properties: Record<string, unknown> = {};
  for (const d of declared) properties[d.name] = propertySchemaFor(d.decl);

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
    `Declared variables:`,
    JSON.stringify(
      declared.map((d) => ({
        name: d.name,
        type: d.decl.type ?? "string",
        description: d.decl.description ?? "",
        enum_values: d.decl.values,
      })),
      null,
      2,
    ),
    "",
    `Return a JSON object mapping each variable name to a value.`,
  ].join("\n");

  const parsed = await generateJson<Record<string, unknown>>(apiKey, model, {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: {
      type: "OBJECT",
      properties,
      required: declared.map((d) => d.name),
    },
  });

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
