import { coerceScalarValue, type Spec, type VariableDecl } from "@flowstore/core/schema/v0";
import type { ProviderId } from "@flowstore/core/llm/types";
import { generateStructuredJson } from "./structuredOutput";
import { agentContextPreamble } from "./llmJson";
import type { DeclaredVariable } from "./contextVars";

// TODO(editor propagation): this generator is Spec-coupled (typed
// VariableDecls, agent purpose, capabilities). When there is no Spec, the
// editor should fall back to grounding generation on the system prompt
// instead, like compare's generateVars/generateScenarios
// (@flowstore/studies generate.ts) — exact shape to be decided.

const SYSTEM_PROMPT = `You generate realistic test values for variables declared in an agent specification.

Make values coherent — variables that describe a single user/persona should be consistent (a phone number, name, account id, balance, etc., should all describe the same plausible person). Use realistic-sounding values, NOT obvious placeholders like "Test User" or "12345".

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
  provider: ProviderId,
  apiKey: string,
  model: string,
  declared: DeclaredVariable[],
  personaContext?: { name?: string; notes?: string },
  baseUrl?: string,
): Promise<Record<string, unknown>> {
  // Drop blank-named declarations: an empty/whitespace key is invalid in a
  // Gemini responseSchema ("properties[]: key cannot be empty") and couldn't
  // round-trip to a usable value anyway. Common mid-edit in the editor.
  // Also drop variables bound by a capability's declared outputs — those
  // values enter the world as tool results (generate them in the persona's
  // MOCKS, where capabilityMocksGen keeps them consistent with these vars),
  // not as character-sheet facts.
  const capabilityBound = new Set(
    (spec.agent.capabilities ?? []).flatMap((c) => c.outputs ?? []),
  );
  const usable = declared.filter(
    (d) => d.name.trim() !== "" && !capabilityBound.has(d.name),
  );
  if (usable.length === 0) return {};

  const properties: Record<string, unknown> = {};
  for (const d of usable) properties[d.name] = propertySchemaFor(d.decl);

  const personaPreamble = personaContext && (personaContext.name || personaContext.notes)
    ? [
        "Persona you're generating values FOR:",
        personaContext.name ? `  Name: ${personaContext.name}` : null,
        personaContext.notes ? `  Notes: ${personaContext.notes}` : null,
        "Choose values consistent with this persona.",
        "",
      ].filter((s) => s !== null) as string[]
    : [];

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
    ...personaPreamble,
    `Declared variables:`,
    JSON.stringify(
      usable.map((d) => ({
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

  const parsed = await generateStructuredJson<Record<string, unknown>>(provider, apiKey, model, {
    baseUrl,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: {
      type: "OBJECT",
      properties,
      required: usable.map((d) => d.name),
    },
  });

  const byName = new Map(usable.map((d) => [d.name, d.decl]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const decl = byName.get(k);
    if (!decl) continue;
    const coerced = coerceScalarValue(decl, v);
    if (coerced !== undefined) out[k] = coerced;
  }
  return out;
}
