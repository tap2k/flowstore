import type {
  Spec,
  Flow,
  ExitPath,
  Condition,
  FaqEntry,
} from "@flowstore/core/schema/v0";
import {
  isEndGoto,
  isReturnGoto,
  isFlowGoto,
  resolveLocalized,
  getLanguage,
  defaultLanguage,
} from "@flowstore/core/schema/v0";

// A segment maps a [start, end) range of the compiled text back to the spec
// entity that produced it. `runtimeContext` is derived from variable *values*
// rather than a single editable entity, so consumers treat it as un-linkable.
// `templateWrapper` is the author-owned text on either side of `{generated}`
// in `agent.system_prompt`; clicking it should land in the AgentSheet.
export type PromptSource =
  | { kind: "role" }
  | { kind: "runtimeContext" }
  | { kind: "multilingual" }
  | { kind: "guardrails" }
  | { kind: "flow"; flowId: string; name: string }
  | { kind: "interrupt"; flowId: string; name: string }
  | { kind: "knowledge" }
  | { kind: "templateWrapper" };

// Reserved placeholder in `agent.system_prompt`. Expands to all spec-derived
// sections (role/guardrails/flows/knowledge…). Omitting it is full override.
export const GENERATED_PLACEHOLDER = "{generated}";

// Sentinel `language` value requesting multilingual emission — every declared
// language, labeled, instead of resolving to one. A single param (a real code,
// this sentinel, or undefined) makes "pinned" and "multilingual" mutually
// exclusive by construction. Not a BCP-47 code, so it can't collide.
export const ALL_LANGUAGES = "*";

export interface PromptSegment {
  start: number; // inclusive offset into text
  end: number; // exclusive
  source: PromptSource;
}

export interface CompiledPrompt {
  text: string;
  segments: PromptSegment[];
}

const SECTION_SEP = "\n\n---\n\n";
const BLOCK_SEP = "\n\n";

// Capabilities are intentionally not rendered here. The naked prompt has no
// tools to call; when tool-use is wired in, capabilities should be passed as a
// structured tool schema to the model API, not described in prose.
//
// Compiles the system prompt together with parallel source segments.
// Substitution happens per-block *before* offsets are recorded, so a {var}
// whose value differs in length from its placeholder cannot shift the offsets
// of later segments. `text` is byte-for-byte identical to the legacy
// concatenation, so generateSystemPrompt is a thin wrapper over it.
export function compileSystemPrompt(
  spec: Spec,
  vars?: Record<string, unknown>,
  opts?: { language?: string },
): CompiledPrompt {
  const defaultLang = defaultLanguage(spec.agent.meta.languages);
  // `language` is one value: a code pins, the ALL_LANGUAGES sentinel emits every
  // declared language (multilingual), undefined falls back to the default. One
  // param makes "pinned" and "multilingual" impossible to request at once.
  const declared = spec.agent.meta.languages ?? [];
  const multilingual = opts?.language === ALL_LANGUAGES;
  // Multilingual emission only kicks in for specs that actually declare more
  // than one language — otherwise the per-language labels are noise. When off,
  // `langs` is undefined and every localized field resolves to a single string
  // (the legacy single-language path), byte-for-byte unchanged.
  const langs = multilingual && declared.length > 1 ? declared : undefined;
  const lang = multilingual ? defaultLang : (opts?.language ?? defaultLang);
  const ctx: RenderCtx = { lang, defaultLang, langs };
  // Identity from the spec's own meta is seeded at the LOWEST precedence so a
  // caller value still wins. This is not a new namespace or a declared variable
  // — it exposes data the spec already holds (meta.name) to the same `{var}`
  // substitution that fills `{user_name}`, so a script's `{agent_name}` resolves.
  const effective = { ...metaVariables(spec), ...(vars ?? {}) };
  const sub = (t: string) => substituteVars(t, effective);

  const inner = compileInnerRaw(spec, ctx, sub, vars);
  const tmpl = spec.agent.system_prompt ?? "";

  let untrimmed: string;
  let segments: PromptSegment[];

  if (!tmpl) {
    untrimmed = inner.text;
    segments = inner.segments;
  } else {
    // Splice on the RAW template before sub runs so `{generated}` is never
    // exposed to `{var}` substitution and a caller-supplied vars.generated
    // can't clobber the placeholder.
    const idx = tmpl.indexOf(GENERATED_PLACEHOLDER);
    if (idx < 0) {
      // Full override — codegen middle is intentionally dropped. Validation
      // surfaces a warning so this is deliberate, not silent.
      untrimmed = sub(tmpl);
      segments = untrimmed.length
        ? [{ start: 0, end: untrimmed.length, source: { kind: "templateWrapper" } }]
        : [];
    } else {
      const pre = sub(tmpl.slice(0, idx));
      const post = sub(tmpl.slice(idx + GENERATED_PLACEHOLDER.length));
      untrimmed = pre + inner.text + post;
      segments = [];
      if (pre.length)
        segments.push({ start: 0, end: pre.length, source: { kind: "templateWrapper" } });
      for (const seg of inner.segments) {
        segments.push({
          start: seg.start + pre.length,
          end: seg.end + pre.length,
          source: seg.source,
        });
      }
      if (post.length)
        segments.push({
          start: pre.length + inner.text.length,
          end: untrimmed.length,
          source: { kind: "templateWrapper" },
        });
    }
  }

  // Normalize trailing whitespace exactly as the legacy generator did. Leading
  // whitespace can only appear if an author led their template with it — shift
  // segments left by however much trim() dropped.
  const text = untrimmed.trim() + "\n";
  const leftStrip = untrimmed.length - untrimmed.trimStart().length;
  const clamped = segments
    .map((s) => ({
      start: Math.max(0, s.start - leftStrip),
      end: Math.min(s.end - leftStrip, text.length),
      source: s.source,
    }))
    .filter((s) => s.end > s.start);

  return { text, segments: clamped };
}

// Builds the spec-derived prompt body and its segments without applying the
// final trim()+"\n" — the outer compileSystemPrompt owns whitespace
// normalization so it can splice `{generated}` cleanly.
function compileInnerRaw(
  spec: Spec,
  ctx: RenderCtx,
  sub: (t: string) => string,
  vars?: Record<string, unknown>,
): { text: string; segments: PromptSegment[] } {
  type Group =
    | { type: "single"; source: PromptSource; text: string }
    | { type: "multi"; leadText: string; items: { source: PromptSource; text: string }[] };

  const groups: Group[] = [];
  const pushSingle = (source: PromptSource, text: string) => {
    if (text) groups.push({ type: "single", source, text });
  };

  pushSingle({ kind: "role" }, renderRole(spec));
  pushSingle({ kind: "runtimeContext" }, renderRuntimeContext(spec, vars));
  pushSingle({ kind: "multilingual" }, renderMultilingual(ctx));
  pushSingle({ kind: "guardrails" }, renderGuardrails(spec));

  const fg = flowsGroup(spec, ctx);
  if (fg) {
    groups.push({
      type: "multi",
      leadText: fg.leadText,
      items: fg.items.map((it) => ({
        source: { kind: "flow", flowId: it.flowId, name: it.name },
        text: it.text,
      })),
    });
  }

  const ig = interruptsGroup(spec, ctx);
  if (ig) {
    groups.push({
      type: "multi",
      leadText: ig.leadText,
      items: ig.items.map((it) => ({
        source: { kind: "interrupt", flowId: it.flowId, name: it.name },
        text: it.text,
      })),
    });
  }

  pushSingle({ kind: "knowledge" }, renderKnowledge(spec, ctx));

  // Assemble, recording a segment per block. Top-level groups are joined by
  // SECTION_SEP; the per-flow/per-interrupt blocks inside a multi group are
  // joined by BLOCK_SEP, and the group's lead text (e.g. "FLOW OF CALL: …")
  // folds into the first block's segment. Separators are not part of any
  // segment.
  let body = "";
  const segments: PromptSegment[] = [];
  groups.forEach((g, gi) => {
    if (gi > 0) body += SECTION_SEP;
    if (g.type === "single") {
      const start = body.length;
      body += sub(g.text);
      segments.push({ start, end: body.length, source: g.source });
    } else {
      const lead = sub(g.leadText);
      g.items.forEach((item, ii) => {
        if (ii > 0) body += BLOCK_SEP;
        const start = body.length;
        if (ii === 0 && lead) body += lead + BLOCK_SEP;
        body += sub(item.text);
        segments.push({ start, end: body.length, source: item.source });
      });
    }
  });

  // Caller (compileSystemPrompt) owns trim+newline normalization so it can
  // splice `{generated}` cleanly. Inner body and segments are returned raw.
  return { text: body, segments };
}

export function generateSystemPrompt(
  spec: Spec,
  vars?: Record<string, unknown>,
  opts?: { language?: string },
): string {
  return compileSystemPrompt(spec, vars, opts).text;
}

interface RenderCtx {
  lang: string;
  defaultLang: string;
  // When set (multilingual mode), localized fields emit every listed language
  // labeled by code instead of resolving to `lang`. Always has >1 entry; the
  // compiler leaves it undefined for single-language emission.
  langs?: string[];
}

function loc(value: string | Record<string, string> | undefined, ctx: RenderCtx): string {
  return resolveLocalized(value, ctx.lang, ctx.defaultLang);
}

// Multilingual emission: the (lang, text) pairs to render for a localized
// value, in declared-language order. Languages with no reviewed content are
// skipped (no fallback) so the model sees only real translations — except a
// plain string, which counts as default-language content. Only called when
// ctx.langs is set.
function locPerLang(
  value: string | Record<string, string> | undefined,
  ctx: RenderCtx,
): Array<[lang: string, text: string]> {
  const out: Array<[string, string]> = [];
  for (const lang of ctx.langs ?? []) {
    const t = getLanguage(value, lang, ctx.defaultLang);
    if (t && t.trim()) out.push([lang, t]);
  }
  return out;
}

// One-time guidance, emitted only in multilingual mode, telling the model the
// caller may code-switch and to pick the matching translation per turn.
function renderMultilingual(ctx: RenderCtx): string {
  if (!ctx.langs) return "";
  return [
    `MULTILINGUAL (languages: ${ctx.langs.join(", ")}):`,
    "The caller may use any listed language and may switch mid-conversation. Each turn, detect the caller's current language and reply in it, using the matching translation shown for each script line and FAQ answer below. If a translation is missing for that language, translate the default faithfully.",
  ].join("\n");
}

// Identity variables derived from the spec's own meta, seeded into the variable
// bag at the lowest precedence (a caller value overrides them). These are NOT
// declared variables and NOT a reserved namespace — they make data the spec
// already holds reachable by the one `{var}` substitution path, so a generator's
// `{agent_name}` resolves the same way `{user_name}` does. Only `agent_name`
// today; add more keys only when a real script references them.
export function metaVariables(spec: Spec): Record<string, string> {
  return { agent_name: spec.agent.meta.name };
}

// Replaces `{name}` placeholders with values from `vars`. Unknown placeholders
// are left as-is; null/undefined values leave the placeholder so the author
// can spot a missing var instead of getting silent ""s in the prompt.
export function substituteVars(text: string, vars: Record<string, unknown>): string {
  let out = text;
  for (const [name, value] of Object.entries(vars)) {
    if (value === null || value === undefined) continue;
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

// Emits the current value of every declared agent.variables[name] that has
// a non-empty bound value in `vars`. Without this, instructions like
// "If broken_ptp is true, open by ..." render with the literal var name and
// the LLM has no way to evaluate the gate. Same for date anchors like
// {now}/{day} that flow.instructions never explicitly reference but expect
// to be available at routing time.
function renderRuntimeContext(spec: Spec, vars?: Record<string, unknown>): string {
  if (!vars) return "";
  const declared = spec.agent.variables ?? {};
  const lines: string[] = [];
  for (const name of Object.keys(declared)) {
    const value = vars[name];
    if (value === null || value === undefined || value === "") continue;
    lines.push(`- ${name} = ${JSON.stringify(value)}`);
  }
  if (!lines.length) return "";
  return ["RUNTIME CONTEXT (current values of agent variables — use these to evaluate any conditional instructions and any date arithmetic):", ...lines].join("\n");
}

function renderRole(spec: Spec): string {
  const { meta } = spec.agent;
  const lines: string[] = [];
  lines.push(`You are ${meta.name}.`);
  if (meta.purpose) lines.push(meta.purpose);
  if (meta.client) lines.push(`This is on behalf of ${meta.client}.`);
  if (meta.tone) lines.push(`Tone: ${meta.tone}`);
  return lines.join(" ");
}

function renderGuardrails(spec: Spec): string {
  const items = spec.agent.guardrails ?? [];
  if (!items.length) return "";
  const lines = ["GUARDRAILS (apply at all times):"];
  items.forEach((g, i) => lines.push(`${i + 1}. ${g.statement}`));
  return lines.join("\n");
}

interface RenderedBlock {
  flowId: string;
  name: string;
  text: string;
}

// Returns the "FLOW OF CALL:" lead text plus one block per conversational
// flow, in routing order. compileSystemPrompt joins them with BLOCK_SEP, which
// reproduces the legacy single-string output byte-for-byte.
function flowsGroup(
  spec: Spec,
  ctx: RenderCtx,
): { leadText: string; items: RenderedBlock[] } | null {
  const entry = spec.agent.entry_flow_id;
  const conversational = spec.flows.filter((f) => f.type !== "interrupt" && f.type !== "utility");
  if (!conversational.length) return null;

  const ordered = orderFlows(conversational, entry);
  const flowNames = new Map(ordered.map((f) => [f.id, f.name || f.id]));
  const leadLines = ["FLOW OF CALL:"];
  if (entry && flowNames.has(entry)) {
    leadLines.push(`Begin with: ${flowNames.get(entry)}.`);
  }

  const items = ordered.map((flow, i) => {
    const lines = [`${i + 1}. ${flow.name || flow.id}${flow.id === entry ? " (entry)" : ""}`];
    const instructions = flow.instructions ?? "";
    if (instructions.trim()) {
      lines.push(`   ${instructions.trim().split("\n").join("\n   ")}`);
    }
    const scripts = renderFlowScripts(flow, ctx);
    if (scripts) lines.push(scripts);
    const guardrails = renderFlowGuardrails(flow);
    if (guardrails) lines.push(guardrails);
    const knowledge = renderFlowKnowledge(flow, ctx);
    if (knowledge) lines.push(knowledge);
    const routing = renderFlowRoutingInline(flow, flowNames);
    if (routing) lines.push(routing);
    return { flowId: flow.id, name: flow.name || flow.id, text: lines.join("\n") };
  });

  return { leadText: leadLines.join("\n"), items };
}

function renderFlowRoutingInline(flow: Flow, flowNames: Map<string, string>): string {
  const exits = flow.exit_paths ?? [];
  if (!exits.length) return "";
  const lines: string[] = [];
  // Count the transitions the model actually chooses among (everything except
  // runtime-enforced turn-budget escapes).
  let decidable = 0;
  for (const ep of exits) {
    const target = renderInlineTarget(ep, flowNames);
    if (ep.max_turns !== undefined) {
      // Turn-budget escape. The runtime dispatcher counts agent turns per flow
      // frame and fires this deterministically — the agent cannot reliably
      // self-count, so we attribute it to the runtime rather than phrasing it
      // as an instruction the model should execute (matches the Python
      // prompt_builder, which hides max_turns from the LLM entirely). It is
      // rendered at all only so this human-facing artifact (preview / export)
      // documents that the budget exists. Crucially, do NOT fall through to
      // the "Otherwise" branch — a budget exit has no condition because it is
      // turn-gated, not because it is a catch-all, and rendering it as an
      // unconditional fallback inverts its meaning.
      const t = ep.max_turns === 1 ? "turn" : "turns";
      lines.push(
        `   - Turn-budget escape (runtime-enforced): if no other exit fires within ${ep.max_turns} ${t} in this flow, ${target}.`,
      );
    } else if (ep.condition) {
      decidable++;
      lines.push(`   - ${renderConditionClause(ep.condition)}, ${target}.`);
    } else {
      decidable++;
      lines.push(`   - Otherwise, ${target}.`);
    }
  }
  // Comparative routing frame. When a flow has more than one model-decidable
  // transition, present them as a single mutually-exclusive choice rather than a
  // list of independent "if X" clauses. The monolith reasons over the whole graph
  // in one pass and otherwise tends to fire the first plausible clause; an
  // explicit "weigh all, take the single best, else stay" preamble makes it
  // compare siblings the way the per-flow runner does natively. This is what lets
  // exit conditions stay clean per-edge predicates: cross-exit disambiguation is
  // synthesized here (global view) instead of being hand-authored into one edge's
  // condition (which helps the monolith but breaks the runner). Single-exit flows
  // need no comparison, so the frame is omitted there.
  if (decidable >= 2) {
    lines.unshift(
      "   At the end of this turn, choose exactly ONE transition below: weigh the " +
        "customer's latest message against all options and take the single best " +
        "match — do not default to the first that seems plausible. If none clearly " +
        "applies, stay in this flow rather than forcing a weak match.",
    );
  }
  return lines.join("\n");
}

function renderInlineTarget(ep: ExitPath, flowNames: Map<string, string>): string {
  if (isEndGoto(ep.goto)) return "end the conversation";
  if (isReturnGoto(ep.goto)) return "return to the calling flow";
  const name = flowNames.get(ep.goto) ?? ep.goto;
  return `go to ${name}`;
}

// Routing clause: prefixes the expression with a frame so deterministic
// methods read as conditions rather than free-floating prose. The verbatim
// expression is preserved (no translation drift) — modern LLMs read the
// Python-like grammar fine.
function renderConditionClause(c: Condition): string {
  if (c.method === "llm") return `If ${c.expression}`;
  return `When \`${c.expression}\` holds`;
}

// Interrupt triggers are author-natural-language regardless of method label.
function renderConditionPlain(c: Condition): string {
  return c.expression;
}

function orderFlows(flows: Flow[], entryId: string | undefined): Flow[] {
  if (!entryId) return flows;
  const byId = new Map(flows.map((f) => [f.id, f]));
  const visited = new Set<string>();
  const ordered: Flow[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    const flow = byId.get(id);
    if (!flow) return;
    visited.add(id);
    ordered.push(flow);
    for (const ep of flow.exit_paths ?? []) {
      if (isFlowGoto(ep.goto)) visit(ep.goto);
    }
  }

  visit(entryId);
  for (const f of flows) if (!visited.has(f.id)) ordered.push(f);
  return ordered;
}

function renderFlowScripts(flow: Flow, ctx: RenderCtx): string {
  const scripts = flow.scripts ?? [];
  if (!scripts.length) return "";
  const lines: string[] = ["   Scripts:"];
  for (const s of scripts) {
    if (ctx.langs) {
      // Multilingual: one labeled line per language with reviewed text, its
      // own variations nested beneath it.
      const pairs = locPerLang(s.text, ctx);
      pairs.forEach(([lang, text], i) => {
        lines.push(`     ${i === 0 ? "- " : "  "}${lang}: "${escapeQuotes(text)}"`);
        for (const v of (s.variations?.[lang] ?? []).filter(Boolean)) {
          lines.push(`         | "${escapeQuotes(v)}"`);
        }
      });
      continue;
    }
    const text = loc(s.text, ctx);
    if (!text) continue;
    lines.push(`     - "${escapeQuotes(text)}"`);
    const variations = s.variations?.[ctx.lang] ?? s.variations?.[ctx.defaultLang] ?? [];
    for (const v of variations.filter(Boolean)) {
      lines.push(`       | "${escapeQuotes(v)}"`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function renderFlowGuardrails(flow: Flow): string {
  const items = flow.guardrails ?? [];
  if (!items.length) return "";
  const lines = ["   Flow guardrails:"];
  for (const g of items) lines.push(`     - ${g.statement}`);
  return lines.join("\n");
}

function renderFlowKnowledge(flow: Flow, ctx: RenderCtx): string {
  const faq = flow.knowledge?.faq ?? [];
  if (!faq.length) return "";
  const lines = ["   FAQ:"];
  for (const entry of faq) lines.push(formatFaqEntry(entry, "     ", ctx));
  return lines.join("\n");
}

function interruptsGroup(
  spec: Spec,
  ctx: RenderCtx,
): { leadText: string; items: RenderedBlock[] } | null {
  const interrupts = spec.flows.filter((f) => f.type === "interrupt");
  if (!interrupts.length) return null;
  const flowNames = new Map(spec.flows.map((f) => [f.id, f.name || f.id]));

  const items = interrupts.map((flow, i) => {
    const lines = [`${i + 1}. ${flow.name || flow.id}`];
    const trigger = flow.entry_condition;
    if (trigger) {
      lines.push(`   Trigger: ${renderConditionPlain(trigger)}`);
    }
    const instructions = flow.instructions ?? "";
    if (instructions.trim()) {
      lines.push(`   ${instructions.trim().split("\n").join("\n   ")}`);
    }
    const scripts = renderFlowScripts(flow, ctx);
    if (scripts) lines.push(scripts);
    const knowledge = renderFlowKnowledge(flow, ctx);
    if (knowledge) lines.push(knowledge);
    const routing = renderFlowRoutingInline(flow, flowNames);
    if (routing) lines.push(routing);
    return { flowId: flow.id, name: flow.name || flow.id, text: lines.join("\n") };
  });

  return { leadText: "INTERRUPTS (fire at any point):", items };
}

function renderKnowledge(spec: Spec, ctx: RenderCtx): string {
  const k = spec.agent.knowledge;
  if (!k) return "";
  const blocks: string[] = [];

  if (k.faq?.length) {
    const lines = ["FAQ:"];
    for (const entry of k.faq) {
      lines.push(formatFaqEntry(entry, "", ctx));
    }
    blocks.push(lines.join("\n"));
  }

  if (k.glossary?.length) {
    const lines = ["GLOSSARY:"];
    for (const g of k.glossary) lines.push(`- ${g.term}: ${g.definition}`);
    blocks.push(lines.join("\n"));
  }

  // Tables are intentionally not inlined — they belong behind a retrieval
  // capability. Inlining bloats the prompt and the row format would likely
  // need re-authoring if revived.

  return blocks.join("\n\n");
}

function formatFaqEntry(entry: FaqEntry, indent: string, ctx: RenderCtx): string {
  if (ctx.langs) {
    // Multilingual: question stays single (it isn't localized); answer emits
    // one labeled line per language with a reviewed translation.
    const answers = locPerLang(entry.answer, ctx)
      .map(([lang, text]) => `${indent}    ${lang}: ${text}`)
      .join("\n");
    return `${indent}- Q: ${entry.question}\n${indent}  A:\n${answers}`;
  }
  return `${indent}- Q: ${entry.question}\n${indent}  A: ${loc(entry.answer, ctx)}`;
}

function escapeQuotes(text: string): string {
  return text.replace(/"/g, '\\"');
}
