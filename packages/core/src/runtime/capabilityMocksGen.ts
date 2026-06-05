import { coerceScalarValue, type Spec, type VariableDecl } from "@flowstore/core/schema/v0";
import type { ProviderId } from "@flowstore/core/llm/types";
import { generateStructuredJson } from "./structuredOutput";
import { agentContextPreamble } from "./llmJson";
import type { MockableCapability } from "./capabilityMocks";

const SYSTEM_PROMPT = `You generate realistic, coherent capability return values for an agent specification. These are mock return values used to simulate the agent's tools without calling real endpoints.

Make values plausible and consistent across capabilities — a claim_id returned by file_claim should match the agent's naming conventions; a policy_active boolean returned by verify_policy should reflect a happy path unless the persona context suggests otherwise. Use realistic-sounding values, NOT obvious placeholders like "Test" or "12345". Default to happy-path values that let the agent proceed through the flow successfully.

For enums, pick from the provided allowed values.`;

function geminiTypeFor(decl: VariableDecl | undefined): string {
  const t = decl?.type ?? "string";
  if (t === "number") return "NUMBER";
  if (t === "boolean") return "BOOLEAN";
  return "STRING";
}

function propertySchemaFor(decl: VariableDecl | undefined): Record<string, unknown> {
  const prop: Record<string, unknown> = { type: geminiTypeFor(decl) };
  if (decl?.description) prop.description = decl.description;
  if (decl?.values && decl.values.length > 0) {
    prop.type = "STRING";
    prop.enum = decl.values.map((v) => String(v));
  }
  return prop;
}

export async function generateCapabilityMocks(
  spec: Spec,
  provider: ProviderId,
  apiKey: string,
  model: string,
  capabilities: MockableCapability[],
  contextVars: Record<string, unknown> = {},
  personaContext?: { name?: string; notes?: string },
): Promise<Record<string, Record<string, unknown>>> {
  if (capabilities.length === 0) return {};

  // Drop blank-named capabilities/outputs: an empty/whitespace key is invalid
  // in a Gemini responseSchema ("properties[]: key cannot be empty"), and a
  // capability left with no usable outputs would be an empty OBJECT (also
  // rejected). Common mid-edit in the editor.
  const usableCaps = capabilities
    .map((c) => ({ ...c, outputs: c.outputs.filter((o) => o.name.trim() !== "") }))
    .filter((c) => c.capabilityName.trim() !== "" && c.outputs.length > 0);
  if (usableCaps.length === 0) return {};

  const capProperties: Record<string, unknown> = {};
  for (const c of usableCaps) {
    const outputProps: Record<string, unknown> = {};
    for (const o of c.outputs) outputProps[o.name] = propertySchemaFor(o.decl);
    capProperties[c.capabilityName] = {
      type: "OBJECT",
      properties: outputProps,
      required: c.outputs.map((o) => o.name),
      description: c.description ?? undefined,
    };
  }

  const filledVars = Object.fromEntries(
    Object.entries(contextVars).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );

  const personaPreamble = personaContext && (personaContext.name || personaContext.notes)
    ? [
        "Persona you're generating returns FOR:",
        personaContext.name ? `  Name: ${personaContext.name}` : null,
        personaContext.notes ? `  Notes: ${personaContext.notes}` : null,
        "Choose returns consistent with this persona — e.g. if the persona notes describe a failure path, surface that in the returns where it matters.",
        "",
      ].filter((s) => s !== null) as string[]
    : [];

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
    ...personaPreamble,
    Object.keys(filledVars).length > 0
      ? `Variables already set in scope (use these as anchors — outputs should be coherent with them; an output whose name matches one of these should default to the same value unless context suggests divergence):\n${JSON.stringify(filledVars, null, 2)}\n`
      : null,
    `Capabilities and their declared outputs:`,
    JSON.stringify(
      usableCaps.map((c) => ({
        name: c.capabilityName,
        description: c.description ?? "",
        outputs: c.outputs.map((o) => ({
          name: o.name,
          type: o.decl?.type ?? "string",
          description: o.decl?.description ?? "",
          enum_values: o.decl?.values,
        })),
      })),
      null,
      2,
    ),
    "",
    `Return a JSON object mapping capability names to objects mapping output names to values.`,
  ]
    .filter((s) => s !== null)
    .join("\n");

  const parsed = await generateStructuredJson<Record<string, Record<string, unknown>>>(
    provider,
    apiKey,
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema: {
        type: "OBJECT",
        properties: capProperties,
        required: usableCaps.map((c) => c.capabilityName),
      },
    },
  );

  const byCapName = new Map(
    capabilities.map((c) => [
      c.capabilityName,
      new Map(c.outputs.map((o) => [o.name, o.decl])),
    ]),
  );
  const out: Record<string, Record<string, unknown>> = {};
  for (const [capName, outputs] of Object.entries(parsed)) {
    const declMap = byCapName.get(capName);
    if (!declMap) continue;
    if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) continue;
    const cleaned: Record<string, unknown> = {};
    for (const [outName, v] of Object.entries(outputs as Record<string, unknown>)) {
      if (!declMap.has(outName)) continue;
      const coerced = coerceScalarValue(declMap.get(outName), v);
      if (coerced !== undefined) cleaned[outName] = coerced;
    }
    if (Object.keys(cleaned).length > 0) out[capName] = cleaned;
  }
  return out;
}
