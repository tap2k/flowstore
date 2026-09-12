import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// Markdown source conventions shared by the emitter (decompose.ts) and the
// parser (load.ts). A source file is YAML frontmatter (the typed skeleton the
// machine reads) followed by a markdown body (the prose the model reads).
//
//   ---
//   type: happy
//   exit_paths: [...]
//   ---
//   # Flow name
//   instructions...
//   ## Scripts
//   ### s_id
//   - EN: text
//
// Entities inside a body are addressed by explicit ids: a `### id: title`
// heading, or a `- id: text` list line. Ids are never derived from text.

// agent.md flattens `meta` into the frontmatter; these are the keys that fold
// back into it on parse. Keep in step with AgentMetaSchema (schema/v0.ts).
export const AGENT_META_KEYS: ReadonlySet<string> = new Set(["identity", "purpose", "tone", "modality", "languages"]);

export interface Doc {
  meta: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(text: string, path: string): Doc {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { meta: {}, body: text };
  let meta: unknown;
  try {
    meta = parseYaml(m[1]) ?? {};
  } catch (e) {
    throw new Error(`${path}: frontmatter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error(`${path}: frontmatter must be a YAML mapping`);
  }
  return { meta: meta as Record<string, unknown>, body: text.slice(m[0].length) };
}

export function joinFrontmatter(meta: Record<string, unknown>, body: string): string {
  const clean = dropUndefined(meta);
  const head = Object.keys(clean).length > 0 ? `---\n${toYaml(clean)}---\n` : "";
  const trimmed = body.replace(/\s+$/, "");
  return head + (trimmed ? trimmed + "\n" : "");
}

// Machine-only collections (variables, business goals) are plain YAML files.
export function toYaml(value: unknown): string {
  return stringifyYaml(value, { lineWidth: 0, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" });
}

export function fromYaml<T>(text: string, path: string): T {
  try {
    return (parseYaml(text) ?? null) as T;
  } catch (e) {
    throw new Error(`${path}: not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function dropUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}

// ---------- Multi-file text bundle ----------
//
// One text document carrying a whole project: what an LLM emits from
// AGENT-SPEC-PROMPT and what the editor's import paste accepts.
//
//   --- file: agent.md ---
//   ...
//   --- file: flows/opening.md ---
//   ...

const BUNDLE_DELIM_RE = /^--- file: (.+?) ---\s*$/;

export function isFileBundleText(text: string): boolean {
  return /^--- file: .+ ---\s*$/m.test(text);
}

export function parseFileBundleText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current !== null) out[current] = lines.join("\n").replace(/\s+$/, "") + "\n";
  };
  for (const line of text.split(/\r?\n/)) {
    const m = BUNDLE_DELIM_RE.exec(line);
    if (m) {
      flush();
      current = m[1].trim();
      lines = [];
      continue;
    }
    if (current !== null) lines.push(line);
  }
  flush();
  return out;
}

export function formatFileBundleText(files: Record<string, string>): string {
  return Object.keys(files)
    .sort()
    .map((path) => `--- file: ${path} ---\n${files[path].replace(/\s+$/, "")}\n`)
    .join("\n");
}

// ---------- Sections ----------

export interface Section {
  title: string; // heading text, without the leading "## "
  body: string;
}

// Split a body at level-2 headings. The text before the first `## ` is the
// preamble (a flow's instructions). Section titles are matched
// case-insensitively by callers.
export function splitSections(body: string): { preamble: string; sections: Section[] } {
  const lines = body.split(/\r?\n/);
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: { title: string; lines: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence ? /^## (.+?)\s*$/.exec(line) : null;
    if (h) {
      if (current) sections.push({ title: current.title, body: current.lines.join("\n") });
      current = { title: h[1], lines: [] };
      continue;
    }
    (current ? current.lines : preamble).push(line);
  }
  if (current) sections.push({ title: current.title, body: current.lines.join("\n") });
  return { preamble: preamble.join("\n"), sections };
}

export function findSection(sections: Section[], title: string): Section | undefined {
  const t = title.toLowerCase();
  return sections.find((s) => s.title.toLowerCase() === t);
}

// Split a section body at level-3 headings of the form `### id` or
// `### id: title`. Text before the first heading is returned as `lead`.
export interface Entry {
  id: string;
  title: string;
  body: string;
}

export function splitEntries(body: string): { lead: string; entries: Entry[] } {
  const lines = body.split(/\r?\n/);
  const lead: string[] = [];
  const entries: Entry[] = [];
  let current: Entry | null = null;
  const bodyLines: string[] = [];
  const flush = () => {
    if (current) entries.push({ ...current, body: bodyLines.join("\n") });
    bodyLines.length = 0;
  };
  for (const line of lines) {
    const h = /^### (\S+?)(?::\s*(.*?))?\s*$/.exec(line);
    if (h) {
      flush();
      current = { id: h[1], title: h[2] ?? "", body: "" };
      continue;
    }
    (current ? bodyLines : lead).push(line);
  }
  flush();
  return { lead: lead.join("\n"), entries };
}

// ---------- Id-prefixed list lines ----------
//
//   - g_never_take_credentials: Never ask for a password.
//     A continuation line is indented by two spaces.
//
// Used for guardrails and for per-language text lines (`- EN: ...`).

export interface ListItem {
  key: string;
  text: string;
}

// Whitespace after the colon is not content: `- id:  text` and `- id: text`
// are the same item, so a spacing edit does not move the spec hash.
const ITEM_RE = /^- ([^\s:]+):(?:\s+(.*))?$/;

export function parseItems(body: string, keyFilter?: (key: string) => boolean): { items: ListItem[]; rest: string } {
  const lines = body.split(/\r?\n/);
  const items: ListItem[] = [];
  const rest: string[] = [];
  let current: ListItem | null = null;
  let pendingBlank = 0;
  for (const line of lines) {
    const m = ITEM_RE.exec(line);
    if (m && (!keyFilter || keyFilter(m[1]))) {
      if (current) items.push(current);
      current = { key: m[1], text: (m[2] ?? "").trim() };
      pendingBlank = 0;
      continue;
    }
    if (current && line.trim() === "") {
      pendingBlank++;
      continue;
    }
    if (current && /^  /.test(line)) {
      current.text += "\n".repeat(pendingBlank + 1) + line.slice(2);
      pendingBlank = 0;
      continue;
    }
    // Not part of the list: the list ends here.
    if (current) {
      items.push(current);
      current = null;
    }
    for (let i = 0; i < pendingBlank; i++) rest.push("");
    pendingBlank = 0;
    rest.push(line);
  }
  if (current) items.push(current);
  return { items, rest: rest.join("\n") };
}

export function formatItem(key: string, text: string): string {
  return `- ${key}: ${text.replace(/\n/g, "\n  ")}`.replace(/\s+$/, "");
}

// ---------- Localized text ----------
//
// A LocalizedString that is a plain string renders as a paragraph; a
// per-language map renders as `- <lang>: text` lines. The two shapes
// round-trip exactly, so the parser never has to guess which was meant.

export type Localized = string | Record<string, string>;

export function formatLocalized(value: Localized): string {
  if (typeof value === "string") return value;
  return Object.entries(value).map(([lang, text]) => formatItem(lang, text)).join("\n");
}

export function parseLocalized(body: string, languages: string[]): Localized {
  const isLang = (k: string) => languages.includes(k);
  const { items, rest } = parseItems(body, isLang);
  if (items.length === 0) return body.trim();
  if (rest.trim() !== "") {
    // Mixed paragraph + language lines is not a localized value; callers that
    // allow a paragraph followed by lines (scripts) handle it themselves.
    throw new Error(`localized text mixes a paragraph with per-language lines: ${rest.trim().slice(0, 60)}`);
  }
  const out: Record<string, string> = {};
  for (const it of items) {
    if (it.key in out) throw new Error(`duplicate language "${it.key}" in localized text`);
    out[it.key] = it.text;
  }
  return out;
}

// ---------- Pipe tables (knowledge tables) ----------

export function formatTable(fields: string[], rows: Array<Record<string, unknown>>): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  };
  const lines = [
    `| ${fields.join(" | ")} |`,
    `| ${fields.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${fields.map((f) => cell(r[f])).join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function parseTable(body: string): { header: string[]; rows: string[][] } {
  const lines = body.split(/\r?\n/).filter((l) => /^\s*\|/.test(l));
  if (lines.length < 2) return { header: [], rows: [] };
  const split = (line: string): string[] => {
    const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells: string[] = [];
    let cur = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "\\" && i + 1 < inner.length) {
        cur += inner[i + 1];
        i++;
      } else if (ch === "|") {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim().replace(/<br>/g, "\n"));
  };
  const header = split(lines[0]);
  const rows = lines.slice(2).map(split);
  return { header, rows };
}
