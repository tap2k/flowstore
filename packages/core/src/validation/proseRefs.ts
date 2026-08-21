import type { LocalizedString, Spec } from "@flowstore/core/schema/v0";

// ─────────────────────────────────────────────────────────────────────────
// Rename-aware prose-reference check.
//
// Flow names and variable names get mentioned inside opaque free-text fields
// (instructions, condition expressions, FAQ answers, scripts). After a rename,
// those mentions dangle: the compiled prompt still says "go to Payment Plan"
// while the flow is now "Repayment Plan".
//
// This is deliberately NOT a stateless validateGraph rule: a stateless scan
// cannot know that a given word used to be an entity name — it would have to
// guess, and guessing over prose is exactly the fuzzy matching we ruled out.
// Instead the editor records the rename (old → new) and calls
// findDanglingReferences(spec, oldName); the results surface as non-blocking
// warnings with one-click fixes. Fixes are never auto-applied — a prose
// mention may be caller-facing wording the author wants to keep.
//
// Detection is conservative: exact, case-sensitive matches of the old name at
// word boundaries (which also covers `backticked` mentions and {{placeholder}}
// occurrences, since backticks and braces are non-word characters). No fuzzy
// matching.
// ─────────────────────────────────────────────────────────────────────────

// Identifies the single editable field a fix applies to. FAQ answers and
// script texts are LocalizedString — a fix replaces across all languages of
// that one field (the rename is language-independent).
export type ProseFieldRef =
  | { field: "instructions"; flowId: string }
  | { field: "entry-condition"; flowId: string }
  | { field: "exit-condition"; flowId: string; exitPathId: string }
  | { field: "faq-answer"; flowId?: string; faqId: string }
  | { field: "script"; flowId: string; scriptId: string };

export interface ProseReference {
  ref: ProseFieldRef;
  count: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcher(name: string): RegExp {
  // Word-boundary lookarounds rather than \b so names that start or end with
  // non-word characters still anchor correctly.
  return new RegExp(`(?<![\\w])${escapeRegExp(name)}(?![\\w])`, "g");
}

function countIn(text: string | undefined, re: RegExp): number {
  if (!text) return 0;
  return [...text.matchAll(re)].length;
}

function countLocalized(value: LocalizedString | undefined, re: RegExp): number {
  if (value == null) return 0;
  if (typeof value === "string") return countIn(value, re);
  let n = 0;
  for (const t of Object.values(value)) n += countIn(t, re);
  return n;
}

// True when `name` still names a current entity (a flow, or a declared
// variable). A mention of a still-live name is not dangling.
export function nameInUse(spec: Spec, name: string): boolean {
  return (
    spec.flows.some((f) => (f.name || f.id) === name) ||
    name in (spec.agent.variables ?? {}) ||
    spec.flows.some((f) => name in (f.variables ?? {}))
  );
}

// All prose-field mentions of `name`, regardless of whether it is dangling.
export function findProseReferences(spec: Spec, name: string): ProseReference[] {
  if (!name.trim()) return [];
  const re = matcher(name);
  const out: ProseReference[] = [];
  const add = (ref: ProseFieldRef, count: number) => {
    if (count > 0) out.push({ ref, count });
  };

  for (const e of spec.agent.knowledge?.faq ?? []) {
    add({ field: "faq-answer", faqId: e.id }, countLocalized(e.answer, re));
  }
  for (const f of spec.flows) {
    add({ field: "instructions", flowId: f.id }, countIn(f.instructions, re));
    add({ field: "entry-condition", flowId: f.id }, countIn(f.entry_condition?.expression, re));
    for (const xp of f.exit_paths ?? []) {
      add(
        { field: "exit-condition", flowId: f.id, exitPathId: xp.id },
        countIn(xp.condition?.expression, re),
      );
    }
    for (const e of f.knowledge?.faq ?? []) {
      add({ field: "faq-answer", flowId: f.id, faqId: e.id }, countLocalized(e.answer, re));
    }
    for (const s of f.scripts ?? []) {
      let n = countLocalized(s.text, re);
      for (const arr of Object.values(s.variations ?? {})) {
        for (const v of arr) n += countIn(v, re);
      }
      add({ field: "script", flowId: f.id, scriptId: s.id }, n);
    }
  }
  return out;
}

// Mentions of a renamed-away name. Empty when the name still names an entity
// (nothing dangles) — e.g. two flows shared the name and only one was renamed.
export function findDanglingReferences(spec: Spec, oldName: string): ProseReference[] {
  if (!oldName.trim() || nameInUse(spec, oldName)) return [];
  return findProseReferences(spec, oldName);
}

// Replace `from` with `to` inside the single field `ref` points at, mutating
// `next` (a clone owned by the caller).
function applyFixInPlace(next: Spec, ref: ProseFieldRef, re: RegExp, to: string): void {
  const fix = (t: string) => t.replace(re, to);
  const fixLocalized = (v: LocalizedString): LocalizedString =>
    typeof v === "string" ? fix(v) : Object.fromEntries(Object.entries(v).map(([l, t]) => [l, fix(t)]));

  switch (ref.field) {
    case "faq-answer": {
      const faq =
        ref.flowId === undefined
          ? next.agent.knowledge?.faq
          : next.flows.find((f) => f.id === ref.flowId)?.knowledge?.faq;
      const entry = faq?.find((e) => e.id === ref.faqId);
      if (entry) entry.answer = fixLocalized(entry.answer);
      break;
    }
    case "instructions": {
      const f = next.flows.find((f) => f.id === ref.flowId);
      if (f?.instructions) f.instructions = fix(f.instructions);
      break;
    }
    case "entry-condition": {
      const f = next.flows.find((f) => f.id === ref.flowId);
      if (f?.entry_condition) f.entry_condition.expression = fix(f.entry_condition.expression);
      break;
    }
    case "exit-condition": {
      const f = next.flows.find((f) => f.id === ref.flowId);
      const xp = f?.exit_paths.find((x) => x.id === ref.exitPathId);
      if (xp?.condition) xp.condition.expression = fix(xp.condition.expression);
      break;
    }
    case "script": {
      const f = next.flows.find((f) => f.id === ref.flowId);
      const s = f?.scripts?.find((s) => s.id === ref.scriptId);
      if (s) {
        s.text = fixLocalized(s.text);
        if (s.variations) {
          for (const [lang, arr] of Object.entries(s.variations)) {
            s.variations[lang] = arr.map(fix);
          }
        }
      }
      break;
    }
  }
}

// One-click fix: replace `from` with `to` inside the single field `ref` points
// at. Pure — returns a new Spec; the caller commits it to the store.
export function applyProseReferenceFix(
  spec: Spec,
  ref: ProseFieldRef,
  from: string,
  to: string,
): Spec {
  return applyAllProseReferenceFixes(spec, [{ ref, count: 0 }], from, to);
}

export function applyAllProseReferenceFixes(
  spec: Spec,
  refs: ProseReference[],
  from: string,
  to: string,
): Spec {
  const next: Spec = structuredClone(spec);
  const re = matcher(from);
  for (const r of refs) applyFixInPlace(next, r.ref, re, to);
  return next;
}
