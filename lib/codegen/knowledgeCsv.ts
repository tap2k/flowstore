import type { FaqEntry, GlossaryEntry, TableEntry } from "@/lib/schema/v0";
import { buildLocalized, defaultLanguage, resolveLocalized } from "@/lib/schema/v0";
import { genId } from "@/lib/ids";
import { csvSerialize, parseCsv } from "./csv";

// CSV round-trips for the three Knowledge shapes.
//
//   Glossary: id, term, EN-definition, es-MX-definition, ...
//   FAQ:      id, question, EN-answer, es-MX-answer, ...
//   Table:    <field_1>, <field_2>, ...        (one CSV per table, columns from
//                                                that table's `structure[]`)
//
// All three use replace-on-import semantics: the imported CSV is the authoritative
// list. Authors edit in a spreadsheet, then re-import — no row-level merge logic
// to reason about. Tables coerce values; glossary/FAQ rebuild LocalizedString
// from per-language columns.

// ─── Glossary ──────────────────────────────────────────────────────────
// Glossary is LLM-facing reference material (the agent doesn't recite definitions
// verbatim to users), so it stays single-language. CSV columns are just
// `id, term, definition`.

export function glossaryToCsv(entries: GlossaryEntry[]): string {
  const rows: string[][] = [["id", "term", "definition"]];
  for (const e of entries) rows.push([e.id, e.term, e.definition]);
  return csvSerialize(rows);
}

export function parseGlossaryCsv(csvText: string): GlossaryEntry[] {
  const rows = parseCsv(csvText);
  if (rows.length < 1) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf("id");
  const termIdx = header.indexOf("term");
  const defIdx = header.indexOf("definition");
  if (termIdx === -1 || defIdx === -1) {
    throw new Error('Glossary CSV needs "term" and "definition" columns');
  }
  const out: GlossaryEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const term = (row[termIdx] ?? "").trim();
    const definition = row[defIdx] ?? "";
    if (!term && !definition) continue;
    const id = idIdx >= 0 ? (row[idIdx] ?? "").trim() : "";
    out.push({ id: id || genId("gloss"), term, definition });
  }
  return out;
}

// ─── FAQ ───────────────────────────────────────────────────────────────

export function faqToCsv(entries: FaqEntry[], languages: string[]): string {
  const defaultLang = defaultLanguage(languages);
  const langs = languages.length ? languages : [defaultLang];
  const header = ["id", "question", ...langs];
  const rows: string[][] = [header];
  for (const e of entries) {
    const row = [e.id, e.question];
    for (const lang of langs) {
      const v = typeof e.answer === "string"
        ? lang === defaultLang ? e.answer : ""
        : e.answer[lang] ?? "";
      row.push(v);
    }
    rows.push(row);
  }
  return csvSerialize(rows);
}

export function parseFaqCsv(csvText: string, languages: string[]): FaqEntry[] {
  const rows = parseCsv(csvText);
  if (rows.length < 1) return [];
  const header = rows[0].map((h) => h.trim());
  const headerLower = header.map((h) => h.toLowerCase());
  const idIdx = headerLower.indexOf("id");
  const qIdx = headerLower.indexOf("question");
  if (qIdx === -1) {
    throw new Error('FAQ CSV needs a "question" column');
  }
  const defaultLang = defaultLanguage(languages);
  const langCols: Array<{ lang: string; idx: number }> = [];
  for (let i = 0; i < header.length; i++) {
    if (i === idIdx || i === qIdx) continue;
    const lang = header[i].trim();
    if (lang.toLowerCase() === "answer") {
      // Legacy single-column "answer" maps to default language.
      langCols.push({ lang: defaultLang, idx: i });
    } else if (lang) {
      langCols.push({ lang, idx: i });
    }
  }
  const out: FaqEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const question = row[qIdx] ?? "";
    const byLang: Record<string, string> = {};
    for (const { lang, idx } of langCols) {
      const v = row[idx] ?? "";
      if (v !== "") byLang[lang] = v;
    }
    if (!question && Object.keys(byLang).length === 0) continue;
    const id = idIdx >= 0 ? (row[idIdx] ?? "").trim() : "";
    out.push({
      id: id || genId("faq"),
      question,
      answer: buildLocalized(byLang, defaultLang) ?? "",
    });
  }
  return out;
}

// Unused helper kept exported so future call sites can reuse it.
export function _faqAnswerInLang(entry: FaqEntry, lang: string, defaultLang: string): string {
  return resolveLocalized(entry.answer, lang, defaultLang);
}

// ─── Tables (per-table) ────────────────────────────────────────────────

// Cells are stringified for CSV but coerced back on import using the table's
// `structure[].type`:
//   - "number" → parseFloat (NaN falls back to the raw string)
//   - "boolean" → "true"/"false" (case-insensitive); anything else → raw string
//   - everything else → string
// Empty cells become `""`.
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function coerceCell(raw: string, type: string): unknown {
  const t = type.toLowerCase();
  if (t === "number") {
    if (raw === "") return "";
    const n = parseFloat(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (t === "boolean") {
    const lower = raw.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    return raw;
  }
  return raw;
}

export function tableToCsv(table: TableEntry): string {
  const fields = table.structure.map((f) => f.field);
  const header = fields.length > 0 ? fields : Object.keys(table.rows[0] ?? {});
  const rows: string[][] = [header];
  for (const row of table.rows) {
    rows.push(header.map((f) => cellToString(row[f])));
  }
  return csvSerialize(rows);
}

export function parseTableRowsCsv(
  csvText: string,
  table: TableEntry
): Array<Record<string, unknown>> {
  const rows = parseCsv(csvText);
  if (rows.length < 1) return [];
  const header = rows[0].map((h) => h.trim());
  const typeByField = new Map<string, string>(
    table.structure.map((f) => [f.field, f.type ?? "string"])
  );
  const out: Array<Record<string, unknown>> = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((v) => (v ?? "") === "")) continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) {
      const field = header[c];
      if (!field) continue;
      const raw = row[c] ?? "";
      obj[field] = coerceCell(raw, typeByField.get(field) ?? "string");
    }
    out.push(obj);
  }
  return out;
}
