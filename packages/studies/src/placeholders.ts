// {{name}} placeholders in an imported prompt — the fill-sample-values step's
// input. Excludes the reserved {{generated}} codegen splice. First-appearance
// order, deduped, so the fill UI reads in prompt order.
const PLACEHOLDER_RE = /\{\{([A-Za-z_]\w*)\}\}/g;

export function detectPlaceholders(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (m[1] !== "generated" && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}
