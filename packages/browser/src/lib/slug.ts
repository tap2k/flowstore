// Canonical slug for any filename-derived id (branches, persona files,
// case files, gold files). Mirrors GitHub's branch-name accepted charset
// `[A-Za-z0-9._-]`, lowercased, with leading/trailing punctuation
// trimmed. Empty input or all-punctuation falls back to `fallback`.
export function toSlug(name: string, fallback: string = "untitled"): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || fallback
  );
}
