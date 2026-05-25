import { coerceScalarValue, type Spec, type VariableDecl } from "@uxflows/core/schema/v0";
import { generateJson } from "./geminiJson";
import { agentContextPreamble } from "./llmJson";
import type { MockableCapability } from "./capabilityMocks";

const SYSTEM_PROMPT = `You generate realistic, coherent capability return values for an agent specification. These are mock return values used to simulate the agent's tools without calling real endpoints.

Make values plausible and consistent across capabilities — a claim_id returned by file_claim should match the agent's naming conventions; a policy_active boolean returned by verify_policy should reflect a happy-path scenario unless context suggests otherwise. Use realistic-sounding values, NOT obvious placeholders like "Test" or "12345". Default to happy-path values that let the agent proceed through the flow successfully.

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
  apiKey: string,
  model: string,
  capabilities: MockableCapability[],
  contextVars: Record<string, unknown> = {},
): Promise<Record<string, Record<string, unknown>>> {
  if (capabilities.length === 0) return {};

  const capProperties: Record<string, unknown> = {};
  for (const c of capabilities) {
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

  const userPrompt = [
    ...agentContextPreamble(spec),
    "",
    Object.keys(filledVars).length > 0
      ? `Variables already set in scope (use these as anchors — outputs should be coherent with them; an output whose name matches one of these should default to the same value unless context suggests divergence):\n${JSON.stringify(filledVars, null, 2)}\n`
      : null,
    `Capabilities and their declared outputs:`,
    JSON.stringify(
      capabilities.map((c) => ({
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

  const parsed = await generateJson<Record<string, Record<string, unknown>>>(
    apiKey,
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema: {
        type: "OBJECT",
        properties: capProperties,
        required: capabilities.map((c) => c.capabilityName),
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
