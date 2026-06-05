// Derive a short, readable slug from a human label so generated ids carry
// semantic meaning for intuition (flow_greet_route_3f9a2b1c rather than
// flow_3f9a2b1c). Keeps at most the first few words and trims length.
function slugify(seed: string): string {
  return seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .split("_")
    .filter(Boolean)
    .slice(0, 4)
    .join("_")
    .slice(0, 32)
    .replace(/_+$/g, "");
}

// Generate a unique id. The random suffix guarantees uniqueness; an optional
// `seed` (a human-readable name) is slugified in for legibility. Callers that
// pass no seed keep the original opaque form.
export function genId(prefix: string, seed?: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const slug = seed ? slugify(seed) : "";
  return slug ? `${prefix}_${slug}_${rand}` : `${prefix}_${rand}`;
}
