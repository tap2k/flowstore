import type { Flow, LocalizedString } from "@/lib/schema/v0";

function localizedHasContent(value: LocalizedString | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return Object.values(value).some((v) => typeof v === "string" && v.trim().length > 0);
}

// A "calc-route-after-action junction" is a utility flow whose sole purpose is
// to fan out on calculation-routed exit paths. It speaks nothing, instructs
// nothing, and every exit branches on a calculation. Rendered as a diamond
// (decision shape) instead of a rectangle (conversation shape).
export function isCalcRouteJunction(flow: Flow): boolean {
  if (flow.type !== "utility") return false;
  if (localizedHasContent(flow.instructions)) return false;
  for (const line of flow.scripts ?? []) {
    if (localizedHasContent(line.text)) return false;
  }
  const exits = flow.exit_paths ?? [];
  if (exits.length === 0) return false;
  return exits.every((ep) => ep.condition?.method === "calculation");
}
