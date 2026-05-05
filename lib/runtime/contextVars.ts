import type { Spec, VariableDecl } from "@/lib/schema/v0";

export interface DeclaredVariable {
  name: string;
  scope: "agent" | "flow";
  flowId?: string;
  decl: VariableDecl;
}

export function collectDeclaredVariables(spec: Spec | null): DeclaredVariable[] {
  if (!spec) return [];
  const seen = new Map<string, DeclaredVariable>();
  for (const [name, decl] of Object.entries(spec.agent.variables ?? {})) {
    seen.set(name, { name, scope: "agent", decl });
  }
  for (const flow of spec.flows ?? []) {
    for (const [name, decl] of Object.entries(flow.variables ?? {})) {
      // Agent-scope wins on collision; the runner treats them as one flat namespace.
      if (seen.has(name)) continue;
      seen.set(name, { name, scope: "flow", flowId: flow.id, decl });
    }
  }
  return Array.from(seen.values());
}

export function coerceValue(decl: VariableDecl, raw: string | boolean): unknown {
  const type = decl.type ?? "string";
  if (typeof raw === "boolean") return raw;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (type === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return undefined;
  }
  return trimmed;
}

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function findPromptPlaceholders(spec: Spec | null): string[] {
  if (!spec) return [];
  const out = new Set<string>();
  const sources: string[] = [];
  if (spec.agent.system_prompt) sources.push(spec.agent.system_prompt);
  for (const flow of spec.flows ?? []) {
    if (flow.instructions) sources.push(flow.instructions);
    for (const lines of Object.values(flow.scripts ?? {})) {
      for (const line of lines) {
        if (line && typeof line === "object" && "text" in line && typeof line.text === "string") {
          sources.push(line.text);
        }
      }
    }
  }
  for (const text of sources) {
    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      out.add(match[1]);
    }
  }
  return Array.from(out);
}

export function unfilledPlaceholders(
  spec: Spec | null,
  filled: Record<string, unknown>,
): string[] {
  const filledLower = new Set(Object.keys(filled).map((k) => k.toLowerCase()));
  return findPromptPlaceholders(spec).filter((k) => !filledLower.has(k.toLowerCase()));
}
