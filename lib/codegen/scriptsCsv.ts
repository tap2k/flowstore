import type { Flow, ScriptLine } from "@/lib/schema/v0";
import { genId } from "@/lib/ids";
import { csvSerialize, parseCsv } from "./csv";

// CSV round-trip for a single flow's scripts. Schema:
//   id,EN,ES,...
// One row per script id, one column per language. Variations are intentionally
// not emitted — they remain in the spec and are preserved on import (merge keeps
// existing `variations` on each ScriptLine).

export function flowToScriptsCsv(flow: Flow, languages: string[]): string {
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const lang of languages) {
    for (const line of flow.scripts?.[lang] ?? []) {
      if (!seen.has(line.id)) {
        seen.add(line.id);
        orderedIds.push(line.id);
      }
    }
  }
  const header = ["id", ...languages];
  const rows: string[][] = [header];
  for (const id of orderedIds) {
    const row = [id];
    for (const lang of languages) {
      const line = flow.scripts?.[lang]?.find((l) => l.id === id);
      row.push(line?.text ?? "");
    }
    rows.push(row);
  }
  return csvSerialize(rows);
}

// Merge CSV text into existing flow.scripts. Updates `text` per (id, lang);
// preserves `variations`. Empty cells = no change (no-op). Unknown ids are
// appended; missing ids are left alone. New language columns extend the dict.
// Missing/empty `id` cells are filled with a generated id — translators who
// hand-author a sheet without ids, or add new rows without filling the id,
// get net-new entries instead of dropped rows.
export function mergeScriptsCsv(
  csvText: string,
  existing: Record<string, ScriptLine[]> | undefined
): Record<string, ScriptLine[]> {
  const rows = parseCsv(csvText);
  if (rows.length < 1) return existing ?? {};

  const headerRow = rows[0].map((h) => h.trim());
  const idIdx = headerRow.findIndex((h) => h.toLowerCase() === "id");
  const hasIdCol = idIdx !== -1;

  const langCols: Array<{ lang: string; idx: number }> = [];
  for (let i = 0; i < headerRow.length; i++) {
    if (i === idIdx) continue;
    const lang = headerRow[i];
    if (lang) langCols.push({ lang, idx: i });
  }
  if (langCols.length === 0) throw new Error("CSV has no language columns");

  const out: Record<string, ScriptLine[]> = {};
  for (const lang of Object.keys(existing ?? {})) {
    out[lang] = (existing![lang] ?? []).map((l) => ({ ...l }));
  }
  for (const { lang } of langCols) {
    if (!out[lang]) out[lang] = [];
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const hasAnyText = langCols.some(({ idx }) => (row[idx] ?? "") !== "");
    if (!hasAnyText) continue;
    const rawId = hasIdCol ? (row[idIdx] ?? "").trim() : "";
    const id = rawId || genId("s");
    for (const { lang, idx } of langCols) {
      const text = row[idx] ?? "";
      if (text === "") continue; // preserve existing, including variations
      const bucket = out[lang];
      const existingIdx = bucket.findIndex((l) => l.id === id);
      if (existingIdx >= 0) {
        bucket[existingIdx] = { ...bucket[existingIdx], text };
      } else {
        bucket.push({ id, text });
      }
    }
  }

  return out;
}
