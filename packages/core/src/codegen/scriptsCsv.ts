import type { Flow, ScriptLine } from "@uxflows/core/schema/v0";
import { buildLocalized, defaultLanguage } from "@uxflows/core/schema/v0";
import { genId } from "@uxflows/core/ids";
import { csvSerialize, parseCsv } from "./csv";

// CSV round-trip for a single flow's scripts. Schema:
//   id,EN,ES,...
// One row per script line, one column per language. Variations are intentionally
// not emitted — they remain in the spec and are preserved on import (merge keeps
// existing `variations` on each ScriptLine).

function getLangText(line: ScriptLine, lang: string, defaultLang: string): string {
  const t = line.text;
  if (typeof t === "string") return lang === defaultLang ? t : "";
  return t[lang] ?? "";
}

export function flowToScriptsCsv(flow: Flow, languages: string[]): string {
  const defaultLang = defaultLanguage(languages);
  const langs = languages.length ? languages : [defaultLang];
  const header = ["id", ...langs];
  const rows: string[][] = [header];
  for (const line of flow.scripts ?? []) {
    const row = [line.id];
    for (const lang of langs) row.push(getLangText(line, lang, defaultLang));
    rows.push(row);
  }
  return csvSerialize(rows);
}

// Merge CSV text into existing flow.scripts. Updates `text` per (id, lang);
// preserves `variations`. Empty cells = no change. Unknown ids are appended;
// missing ids are left alone. Missing/empty `id` cells get a generated id —
// translators who hand-author a sheet without ids, or add new rows without
// filling the id, get net-new entries instead of dropped rows.
export function mergeScriptsCsv(
  csvText: string,
  existing: ScriptLine[] | undefined,
  languages: string[],
): ScriptLine[] {
  const rows = parseCsv(csvText);
  if (rows.length < 1) return existing ?? [];

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

  const defaultLang = defaultLanguage(languages);
  const out: ScriptLine[] = (existing ?? []).map((l) => ({ ...l }));
  const byId = new Map(out.map((l, i) => [l.id, i]));

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Collect non-empty cells.
    const nonEmpty: Record<string, string> = {};
    for (const { lang, idx } of langCols) {
      const text = row[idx] ?? "";
      if (text !== "") nonEmpty[lang] = text;
    }
    if (Object.keys(nonEmpty).length === 0) continue;
    const rawId = hasIdCol ? (row[idIdx] ?? "").trim() : "";
    const id = rawId || genId("s");
    const existingIdx = byId.get(id);
    if (existingIdx !== undefined) {
      // Merge non-empty cells into the existing line's text. Empty cells
      // preserve any existing translation.
      const cur = out[existingIdx];
      const curText = cur.text;
      const merged: Record<string, string> = {};
      if (typeof curText === "string") {
        merged[defaultLang] = curText;
      } else {
        Object.assign(merged, curText);
      }
      Object.assign(merged, nonEmpty);
      out[existingIdx] = { ...cur, text: buildLocalized(merged, defaultLang) ?? "" };
    } else {
      out.push({ id, text: buildLocalized(nonEmpty, defaultLang) ?? "" });
      byId.set(id, out.length - 1);
    }
  }

  return out;
}
