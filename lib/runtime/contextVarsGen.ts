import { chat, DEFAULT_PROVIDER } from "@/lib/llm/dispatch";
import type { Spec } from "@/lib/schema/v0";
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
    `Agent purpose: ${spec.agent.meta.purpose || "(not specified)"}`,
    spec.agent.meta.client ? `Client: ${spec.agent.meta.client}` : null,
    "",
    `Declared variables:`,
    JSON.stringify(variableSpec, null, 2),
    "",
    `Return the JSON object now.`,
  ]
    .filter((s) => s !== null)
    .join("\n");

  const res = await chat(DEFAULT_PROVIDER, apiKey, model, {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [],
  });

  const parsed = parseJsonObject(res.text);
  if (!parsed) {
    throw new Error("Generator did not return parseable JSON.");
  }
  return coerceToDeclared(parsed, declared);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    const v = JSON.parse(stripped) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // Try extracting the first {...} block.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const v = JSON.parse(match[0]) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          return v as Record<string, unknown>;
        }
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function coerceToDeclared(
  raw: Record<string, unknown>,
  declared: DeclaredVariable[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byName = new Map(declared.map((d) => [d.name, d.decl]));
  for (const [k, v] of Object.entries(raw)) {
    const decl = byName.get(k);
    if (!decl) continue;
    if (v === null || v === undefined || v === "") continue;
    const type = decl.type ?? "string";
    if (type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (type === "boolean") {
      if (typeof v === "boolean") out[k] = v;
      else if (v === "true") out[k] = true;
      else if (v === "false") out[k] = false;
    } else {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}
