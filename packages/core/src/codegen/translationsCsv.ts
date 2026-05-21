import type { Spec, LocalizedString } from "@ux4/core/schema/v0";
import { defaultLanguage, getLanguage, setLanguage } from "@ux4/core/schema/v0";
import { csvSerialize, parseCsv } from "./csv";

// Spec-wide CSV round-trip for every LocalizedString field.
//
// Format (wide):
//   key, EN, es-MX, pt-BR, ...
//
// Each row addresses one translatable string by a dotted key built from stable
// entity ids. Plus a single header row. Plus one column per declared language.
//
// Keys:
//   agent.guardrails.<gid>.statement
//   agent.faq.<faq_id>.answer
//   agent.glossary.<gloss_id>.definition
//   <flow_id>.instructions
//   <flow_id>.guardrails.<gid>.statement
//   <flow_id>.faq.<faq_id>.answer
//   <flow_id>.scripts.<line_id>.text
//
// Variations are intentionally not in the CSV — they're authored per-language
// in the Scripts sheet, not via translator round-trip (v1 simplification).

export interface TranslationRow {
  key: string;
  // Per-language text for this string. Empty/absent = not translated.
  byLang: Record<string, string>;
}

// === EXPORT =================================================================

export function specToTranslationsCsv(spec: Spec, languages: string[]): string {
  const defaultLang = defaultLanguage(spec.agent.meta.languages);
  const langs = languages.length ? languages : [defaultLang];
  const rows = collectRows(spec, langs, defaultLang);
  const csvRows: string[][] = [["key", ...langs]];
  for (const r of rows) {
    const cells = [r.key, ...langs.map((l) => r.byLang[l] ?? "")];
    csvRows.push(cells);
  }
  return csvSerialize(csvRows);
}

function collectRows(
  spec: Spec,
  langs: string[],
  defaultLang: string,
): TranslationRow[] {
  const out: TranslationRow[] = [];

  function emit(key: string, value: LocalizedString | undefined): void {
    if (value == null) return;
    const byLang: Record<string, string> = {};
    let hasAny = false;
    for (const lang of langs) {
      const v = getLanguage(value, lang, defaultLang);
      if (v != null) {
        byLang[lang] = v;
        hasAny = true;
      }
    }
    // Always emit a row for fields that are present, even if only the default
    // language is filled. Translators see "EN is set, es-MX is blank" and
    // know to fill the blanks.
    if (hasAny || value !== undefined) {
      out.push({ key, byLang });
    }
  }

  // Agent-level. Translatable = strings the agent SAYS to the user. Excludes
  // LLM-facing prose (guardrails, glossary definitions, flow instructions) —
  // those stay single-language since the LLM handles them multilingually
  // regardless.
  for (const f of spec.agent.knowledge?.faq ?? []) {
    emit(`agent.faq.${f.id}.answer`, f.answer);
  }

  // Per-flow
  for (const flow of spec.flows) {
    // (flow.instructions, flow.guardrails — not translatable, see above)
    for (const f of flow.knowledge?.faq ?? []) {
      emit(`${flow.id}.faq.${f.id}.answer`, f.answer);
    }
    for (const line of flow.scripts ?? []) {
      emit(`${flow.id}.scripts.${line.id}.text`, line.text);
    }
  }

  return out;
}

// === IMPORT =================================================================

export interface ImportPreview {
  csvLanguages: string[];      // languages present as columns in the CSV
  matched: number;             // rows whose key resolves to a known field in the spec
  unmatched: string[];         // keys present in CSV but not in current spec
  newLanguages: string[];      // CSV languages not in agent.meta.languages
  rows: TranslationRow[];      // parsed rows (matched only)
}

export function previewTranslationsCsv(csvText: string, spec: Spec): ImportPreview {
  const parsed = parseCsv(csvText);
  if (parsed.length < 1) {
    return { csvLanguages: [], matched: 0, unmatched: [], newLanguages: [], rows: [] };
  }
  const header = parsed[0].map((h) => h.trim());
  const headerLower = header.map((h) => h.toLowerCase());
  const keyIdx = headerLower.indexOf("key");
  if (keyIdx === -1) throw new Error('CSV must have a "key" column.');

  const langCols: Array<{ lang: string; idx: number }> = [];
  for (let i = 0; i < header.length; i++) {
    if (i === keyIdx) continue;
    const lang = header[i];
    if (lang) langCols.push({ lang, idx: i });
  }

  const knownKeys = collectKnownKeys(spec);
  const rows: TranslationRow[] = [];
  const unmatched: string[] = [];

  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    const key = (cells[keyIdx] ?? "").trim();
    if (!key) continue;
    const byLang: Record<string, string> = {};
    for (const { lang, idx } of langCols) {
      const v = cells[idx] ?? "";
      if (v !== "") byLang[lang] = v;
    }
    if (Object.keys(byLang).length === 0) continue;
    if (knownKeys.has(key)) {
      rows.push({ key, byLang });
    } else {
      unmatched.push(key);
    }
  }

  const declaredLanguages = new Set(spec.agent.meta.languages ?? []);
  const newLanguages = langCols
    .map(({ lang }) => lang)
    .filter((l) => !declaredLanguages.has(l));

  return {
    csvLanguages: langCols.map(({ lang }) => lang),
    matched: rows.length,
    unmatched,
    newLanguages,
    rows,
  };
}

function collectKnownKeys(spec: Spec): Set<string> {
  const keys = new Set<string>();
  // Only strings the agent speaks to the user are translatable.
  for (const f of spec.agent.knowledge?.faq ?? []) {
    keys.add(`agent.faq.${f.id}.answer`);
  }
  for (const flow of spec.flows) {
    for (const f of flow.knowledge?.faq ?? []) {
      keys.add(`${flow.id}.faq.${f.id}.answer`);
    }
    for (const line of flow.scripts ?? []) {
      keys.add(`${flow.id}.scripts.${line.id}.text`);
    }
  }
  return keys;
}

// Apply preview rows to a spec, returning a new spec. Per-row, per-lang:
// non-empty cell → write translation; empty cell → leave existing alone.
// Translations are written using setLanguage so a plain-string field morphs
// into a Record<lang, string> the first time a non-default lang is added.
export function applyTranslations(spec: Spec, rows: TranslationRow[]): Spec {
  const defaultLang = defaultLanguage(spec.agent.meta.languages);
  // Build a mutable working copy. JSON round-trip is the simplest safe deep
  // clone for our shape (no class instances, no Dates).
  const next: Spec = JSON.parse(JSON.stringify(spec));

  for (const row of rows) {
    applyRow(next, row, defaultLang);
  }
  return next;
}

function applyRow(spec: Spec, row: TranslationRow, defaultLang: string): void {
  const parts = row.key.split(".");
  // Translatable paths (strings the agent says to the user):
  //   agent.faq.<fid>.answer
  //   <flow_id>.faq.<fid>.answer
  //   <flow_id>.scripts.<sid>.text

  if (parts[0] === "agent") {
    if (parts[1] === "faq") {
      const fid = parts[2];
      const f = spec.agent.knowledge?.faq?.find((x) => x.id === fid);
      if (f) f.answer = applyLangs(f.answer, row.byLang, defaultLang)!;
    }
    return;
  }

  // Flow-scoped paths: <flow_id>.<...>
  const flow = spec.flows.find((f) => f.id === parts[0]);
  if (!flow) return;

  if (parts[1] === "faq") {
    const fid = parts[2];
    const f = flow.knowledge?.faq?.find((x) => x.id === fid);
    if (f) f.answer = applyLangs(f.answer, row.byLang, defaultLang)!;
    return;
  }
  if (parts[1] === "scripts") {
    const sid = parts[2];
    const line = flow.scripts?.find((x) => x.id === sid);
    if (line) line.text = applyLangs(line.text, row.byLang, defaultLang)!;
    return;
  }
}

function applyLangs(
  current: LocalizedString | undefined,
  byLang: Record<string, string>,
  defaultLang: string,
): LocalizedString | undefined {
  let next: LocalizedString | undefined = current;
  for (const [lang, text] of Object.entries(byLang)) {
    if (text === "") continue;
    next = setLanguage(next, lang, text, defaultLang);
  }
  return next;
}
