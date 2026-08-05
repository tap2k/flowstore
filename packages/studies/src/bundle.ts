import { ALL_LANGUAGES, generateSystemPrompt } from "@flowstore/core/codegen/promptGenerator";
import { loadProject } from "@flowstore/core/files/load";
import type { CellState, Scenario, ScenarioTurn } from "./types";
import { cellKey, goldOf, mergeGoldTurns, scriptOf } from "./types";

// Study export in file-model shape from the first save: a serialized FileMap
// ({path: content}) of a mini flowstore project — scenarios as scripted test
// cases, transcripts as run results (existing schemas), the pasted prompt as
// agent.system_prompt (full override — compiles to itself verbatim, so every
// consumer runs the imported text with no extra mechanism). One JSON bundle today
// (trivially zippable later); the export IS the graduation artifact — the
// harness runs it, the editor opens it.
//
// Note: agent.json is a stub — an imported-prompt project has no flows yet,
// and entry_flow_id is required by AgentSchema (the "flowless project" open
// question). The stub records intent; extraction at graduation mints flows.

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

// The prompt a project effectively runs on — the same answer every other
// surface gives. A pure override is used byte-verbatim WITHOUT a compile
// round-trip (compileSystemPrompt normalizes whitespace, which would break
// override byte-identity); only when the field is absent (a spec'd project)
// or a {{generated}} template does the compiler produce the text shown and
// run. Shared by the parse side (what compare shows on open) and the build
// side (was the prompt edited since?).
function effectivePromptOf(files: Record<string, string>): string {
  let sys: string | undefined;
  try {
    const agent = files["agent.json"]
      ? (JSON.parse(files["agent.json"]) as { system_prompt?: unknown })
      : {};
    sys = typeof agent.system_prompt === "string" ? agent.system_prompt : undefined;
  } catch {
    // Malformed agent.json — treat as spec'd and let the compiler answer.
  }
  let prompt = sys ?? "";
  if (!sys || sys.includes("{{generated}}")) {
    try {
      const { spec } = loadProject(files);
      if (spec) prompt = generateSystemPrompt(spec, undefined, { language: ALL_LANGUAGES });
    } catch {
      // Not a loadable project (e.g. a bare prompt+cases FileMap) — the raw
      // agent.system_prompt stands.
    }
  }
  return prompt;
}

export function buildStudyBundle(args: {
  prompt: string;
  models: string[];
  scenarios: Scenario[];
  cells: Record<string, CellState>;
  // Stable per-study agent id (compare mints one per study and persists it).
  // Agent-id-scoped editor state — canvas positions, persona/vars buckets —
  // keys off this, so two studies must not share an id.
  agentId: string;
  // Placeholder-fill values for the prompt's {{vars}}. The prompt stays
  // byte-verbatim; these ship as the session-start bag — declared
  // `provided` on the agent, valued on every case (the fixture overlay) —
  // so the harness reproduces the same compile-time fill.
  vars?: Record<string, string>;
  // The FileMap the study was opened from, when it came from an existing
  // project (GitHub open, upload, example). When present the bundle is that
  // project — flows, real agent.json and all — with the study's cases,
  // golds, and run results overlaid, instead of a synthesized flowless stub.
  // This is what makes graduation lossless for spec'd projects.
  sourceFiles?: Record<string, string> | null;
}): Record<string, string> {
  const { prompt, models, scenarios, cells } = args;
  const vars = Object.fromEntries(
    Object.entries(args.vars ?? {}).filter(([, v]) => v.trim().length > 0),
  );
  const hasVars = Object.keys(vars).length > 0;
  const stamp = new Date().toISOString();
  const runDir = `tests/runs/${stamp.slice(0, 19).replace(/[:T]/g, "-")}-compare`;
  const src = args.sourceFiles ?? undefined;
  const files: Record<string, string> = src ? { ...src } : {};
  const j = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const parseJson = (text: string | undefined): Record<string, unknown> | undefined => {
    if (!text) return undefined;
    try {
      const v = JSON.parse(text) as unknown;
      return isRecord(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };

  if (!files["flowstore.json"]) {
    files["flowstore.json"] = j({ $schema: "flowstore://spec/project/v0" });
  }
  const srcAgent = parseJson(src?.["agent.json"]);
  if (!srcAgent) {
    files["agent.json"] = j({
      $schema: "flowstore://spec/agent/v0",
      id: args.agentId,
      name: "Imported agent (compare study)",
      // identity/purpose are file metadata here — with a full-override prompt
      // they never enter the compiled output. Required by the strict schema so
      // the bundle loads in the editor (the graduation contract).
      meta: {
        identity: "Imported agent",
        purpose:
          "Agent imported from a pasted system prompt for a compare study; the override prompt below is the system under test.",
        modality: "text",
        languages: [...new Set(scenarios.map((s) => s.language))],
      },
      // Full override (no {{generated}}): compiles to itself verbatim — see
      // SCHEMA.md § system_prompt.
      system_prompt: prompt,
      // Placeholder-fill vars: declared provided so the case fixtures below
      // ship them at session start (the only gate fixture vars pass through).
      ...(hasVars
        ? {
            variables: Object.fromEntries(
              Object.keys(vars).map((n) => [n, { type: "string", provided: true }]),
            ),
          }
        : {}),
      // Stub: no flows exist pre-extraction (flowless-project acceptance is a
      // pending loader/validator decision).
      entry_flow_id: "",
    });
  } else {
    // Source project's agent stands — flows, entry_flow_id, meta untouched.
    // Only a prompt the user actually edited in compare (differs from what
    // the source project runs on) becomes a full override; an unedited study
    // leaves agent.json byte-identical so the editor keeps compiling from
    // the spec. New fill vars get declared on top of existing declarations.
    const promptEdited = prompt !== effectivePromptOf(src ?? {});
    if (promptEdited || hasVars) {
      const declared = isRecord(srcAgent.variables) ? srcAgent.variables : {};
      files["agent.json"] = j({
        ...srcAgent,
        ...(promptEdited ? { system_prompt: prompt } : {}),
        ...(hasVars
          ? {
              variables: {
                ...declared,
                ...Object.fromEntries(
                  Object.keys(vars)
                    .filter((n) => declared[n] === undefined)
                    .map((n) => [n, { type: "string", provided: true }]),
                ),
              },
            }
          : {}),
      });
    }
  }

  for (const s of scenarios) {
    const path = `tests/cases/${s.id}.test.json`;
    // A case that came from the source project keeps its extra fields
    // (gold_id, tags, …); the study's edits win on the fields compare owns.
    const orig = parseJson(src?.[path]);
    files[path] = j({
      $schema: "flowstore://test/case/v0",
      id: s.id,
      tags: ["src:compare"],
      ...orig,
      scenario_id: s.scenarioId,
      name: s.name,
      user_turns: scriptOf(s),
      language: s.language,
      ...(hasVars ? { vars } : {}),
    });
  }

  const resultFiles: string[] = [];
  for (const s of scenarios) {
    for (const [mi, m] of models.entries()) {
      const c = cells[cellKey(s.id, mi)];
      if (!c || c.status !== "done") continue;
      const path = `${runDir}/${s.id}--c${mi}-${m.replace(/[^a-zA-Z0-9._-]/g, "_")}.result.json`;
      resultFiles.push(path);
      files[path] = j({
        $schema: "flowstore://run/result/v0",
        test_case_id: s.id,
        timestamp: stamp,
        model: m,
        prompt_source: "agent.system_prompt (imported override)",
        language: s.language,
        // JSON.stringify drops undefined members — plain assignment suffices.
        usage: {
          text_in: c.usage?.inputTokens,
          text_out: c.usage?.outputTokens,
          audio_in: c.usage?.audioInputTokens,
          audio_out: c.usage?.audioOutputTokens,
          cost: c.usage?.cost,
        },
        transcript: c.turns.map((t) => ({
          role: t.role,
          content: t.text,
          latency_ms: t.latencyMs,
        })),
      });
    }
  }

  files[`${runDir}/manifest.json`] = j({
    // Loose for now — formalized as flowstore://run/manifest/v0 when the
    // study fields settle (see studies plan).
    kind: "compare-study",
    timestamp: stamp,
    incumbent: models[0],
    models,
    scenario_ids: scenarios.map((s) => s.id),
    results: resultFiles,
  });

  // A scenario with agent turns IS a gold — the full conversation writes as
  // flowstore://test/gold/v0. goldPath (recorded at import) targets the
  // original file so an edited import overwrites instead of duplicating,
  // and the ...orig merge preserves identity and metadata (id, notes, tags,
  // mocks, source_pointer). Blessing is never minted here: blessed_at
  // survives only when the turns are byte-identical to the original's —
  // edited = unblessed; re-blessing is an explicit act elsewhere.
  for (const s of scenarios) {
    const ref = goldOf(s);
    if (ref.length === 0) continue;
    const path = s.goldPath ?? `tests/gold/${s.id}.gold.json`;
    const orig = parseJson(src?.[path]);
    const untouched =
      orig !== undefined && JSON.stringify(orig.turns) === JSON.stringify(s.turns);
    const { blessed_at: origBlessed, ...origRest } = orig ?? {};
    files[path] = j({
      $schema: "flowstore://test/gold/v0",
      tags: ["src:compare"],
      source_pointer: `compare-study:${args.agentId}`,
      ...origRest,
      ...(untouched && typeof origBlessed === "string" ? { blessed_at: origBlessed } : {}),
      id: orig?.id ?? s.id,
      name: s.name,
      turns: s.turns,
      language: s.language,
      scenario_id: s.scenarioId,
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// The read side — buildStudyBundle's inverse, kept beside it so the
// round-trip contract lives (and is tested) in one module. Tolerant of
// arbitrary flowstore projects, not just our own bundles: scenarios come
// from cases (with a matching gold's agent turns merged in as the
// gold), or directly from golds when a project ships golds but no
// cases (replaying a blessed transcript IS a scripted case).
// ---------------------------------------------------------------------------

export type ParsedStudyBundle = {
  prompt: string;
  // agent.json's id, when the bundle has one — round-trips study identity so
  // a re-opened study keeps its editor-side buckets. Null: caller mints.
  agentId: string | null;
  scenarios: Scenario[];
  // Placeholder-fill values, read back from the cases' fixture vars.
  vars: Record<string, string>;
};

export function parseStudyBundle(files: Record<string, string>): ParsedStudyBundle {
  const agent = files["agent.json"]
    ? (JSON.parse(files["agent.json"]) as { id?: string; system_prompt?: string })
    : {};
  const cases = Object.keys(files)
    .filter((k) => k.startsWith("tests/cases/") && k.endsWith(".test.json"))
    .map((k) => JSON.parse(files[k]) as Record<string, unknown>);
  const goldFiles = Object.keys(files)
    .filter((k) => k.startsWith("tests/gold/") && k.endsWith(".gold.json"))
    .map((path) => ({ path, gold: JSON.parse(files[path]) as Record<string, unknown> }));

  const goldTurns = (g: Record<string, unknown>): ScenarioTurn[] =>
    (Array.isArray(g.turns) ? g.turns : [])
      .filter(
        (t): t is { role: "agent" | "user"; text: unknown } =>
          isRecord(t) && (t.role === "agent" || t.role === "user"),
      )
      .map((t) => ({ role: t.role, text: String(t.text) }));

  const scenarios: Scenario[] =
    cases.length > 0
      ? cases.map((c) => ({
          id: String(c.id),
          scenarioId: String(c.scenario_id ?? c.id),
          name: String(c.name ?? c.id),
          language: String(c.language ?? "EN"),
          turns: Array.isArray(c.user_turns)
            ? c.user_turns.map((t) => ({ role: "user" as const, text: String(t) }))
            : [],
        }))
      : // A project with golds but no cases: the gold IS the scenario —
        // replaying a blessed transcript is a scripted case, and its agent
        // side comes along as the gold.
        goldFiles.map(({ path, gold: g }) => ({
          id: String(g.id),
          scenarioId: String(g.scenario_id ?? g.id),
          name: String(g.name ?? g.id),
          language: String(g.language ?? "EN"),
          turns: goldTurns(g),
          goldPath: path,
        }));

  // Merge golds into their scenarios: explicit case.gold_id first, then
  // shared id (our own bundles key gold files by case id), then
  // scenario_id+language. A gold whose user turns match the case script
  // becomes the scenario's full conversation (goldPath records where to
  // write it back); a mismatched gold is left untouched in the file set —
  // the scenario keeps its user-only script and the file passes through
  // export verbatim.
  const caseById = new Map(cases.map((c) => [String(c.id), c]));
  for (const s of scenarios) {
    if (s.goldPath) continue; // gold-derived scenario — already merged
    const declared = caseById.get(s.id)?.gold_id;
    const found =
      goldFiles.find(
        ({ gold: g }) => declared !== undefined && String(g.id) === String(declared),
      ) ??
      goldFiles.find(({ gold: g }) => String(g.id) === s.id) ??
      goldFiles.find(
        ({ gold: g }) =>
          g.scenario_id !== undefined &&
          String(g.scenario_id) === s.scenarioId &&
          String(g.language ?? "EN") === s.language,
      );
    if (!found) continue;
    const merged = mergeGoldTurns(s.turns, goldTurns(found.gold));
    if (merged) {
      s.turns = merged;
      s.goldPath = found.path;
    }
  }

  // Fill values ride the cases' fixture vars (every case carries the same
  // study-global bag on export) — first non-empty value per key wins.
  const vars: Record<string, string> = {};
  for (const c of cases) {
    if (!c.vars || typeof c.vars !== "object" || Array.isArray(c.vars)) continue;
    for (const [k, v] of Object.entries(c.vars as Record<string, unknown>)) {
      if (vars[k] === undefined && (typeof v === "string" || typeof v === "number")) {
        vars[k] = String(v);
      }
    }
  }

  return {
    prompt: effectivePromptOf(files),
    agentId: typeof agent.id === "string" && agent.id ? agent.id : null,
    scenarios,
    vars,
  };
}
