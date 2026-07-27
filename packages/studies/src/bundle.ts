import type { CellState, Scenario } from "./types";
import { cellKey } from "./types";

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

export type CapturedGold = {
  scenarioId: string;
  language: string;
  name: string;
  turns: { role: "agent" | "user"; text: string }[];
  // Round-trip fields, present when the gold was imported rather than
  // captured this session. Re-export must preserve the original identity and
  // blessing — a bundle pass-through is not a re-bless.
  goldId?: string;
  blessedAt?: string;
  sourcePointer?: string;
};

export function buildStudyBundle(args: {
  prompt: string;
  models: string[];
  scenarios: Scenario[];
  cells: Record<string, CellState>;
  golds?: Record<string, CapturedGold>;
  // Placeholder-fill values for the prompt's {{vars}}. The prompt stays
  // byte-verbatim; these ship as the session-start bag — declared
  // `provided` on the agent, valued on every case (the fixture overlay) —
  // so the harness reproduces the same compile-time fill.
  vars?: Record<string, string>;
}): Record<string, string> {
  const { prompt, models, scenarios, cells, golds } = args;
  const vars = Object.fromEntries(
    Object.entries(args.vars ?? {}).filter(([, v]) => v.trim().length > 0),
  );
  const hasVars = Object.keys(vars).length > 0;
  const stamp = new Date().toISOString();
  const runDir = `tests/runs/${stamp.slice(0, 19).replace(/[:T]/g, "-")}-compare`;
  const files: Record<string, string> = {};
  const j = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

  files["flowstore.json"] = j({ $schema: "flowstore://spec/project/v0" });
  files["agent.json"] = j({
    $schema: "flowstore://spec/agent/v0",
    id: "imported-agent",
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

  for (const s of scenarios) {
    files[`tests/cases/${s.id}.test.json`] = j({
      $schema: "flowstore://test/case/v0",
      id: s.id,
      name: s.name,
      user_turns: s.turns,
      language: s.language,
      scenario_id: s.scenarioId,
      ...(hasVars ? { vars } : {}),
      tags: ["src:compare"],
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

  for (const [sid, g] of Object.entries(golds ?? {})) {
    files[`tests/gold/${sid}.gold.json`] = j({
      $schema: "flowstore://test/gold/v0",
      id: g.goldId ?? sid,
      name: g.name,
      turns: g.turns.map((t) => ({ role: t.role, text: t.text })),
      language: g.language,
      scenario_id: g.scenarioId,
      source_pointer: g.sourcePointer ?? `compare-run:${stamp}`,
      blessed_at: g.blessedAt ?? stamp,
      tags: ["src:compare"],
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// The read side — buildStudyBundle's inverse, kept beside it so the
// round-trip contract lives (and is tested) in one module. Tolerant of
// arbitrary flowstore projects, not just our own bundles: scenarios come
// from cases, or are derived from golds' user turns when a project ships
// golds but no cases (replaying a blessed transcript IS a scripted case).
// ---------------------------------------------------------------------------

export type ParsedStudyBundle = {
  prompt: string;
  scenarios: Scenario[];
  // Keyed by scenario (case) id — the same keying buildStudyBundle writes.
  golds: Record<string, CapturedGold>;
  // Placeholder-fill values, read back from the cases' fixture vars.
  vars: Record<string, string>;
};

export function parseStudyBundle(files: Record<string, string>): ParsedStudyBundle {
  const agent = files["agent.json"]
    ? (JSON.parse(files["agent.json"]) as { system_prompt?: string })
    : {};
  const cases = Object.keys(files)
    .filter((k) => k.startsWith("tests/cases/") && k.endsWith(".test.json"))
    .map((k) => JSON.parse(files[k]) as Record<string, unknown>);
  const goldFiles = Object.keys(files)
    .filter((k) => k.startsWith("tests/gold/") && k.endsWith(".gold.json"))
    .map((k) => JSON.parse(files[k]) as Record<string, unknown>);

  const goldTurns = (g: Record<string, unknown>) =>
    (Array.isArray(g.turns) ? g.turns : []) as { role: "agent" | "user"; text: string }[];

  const scenarios: Scenario[] =
    cases.length > 0
      ? cases.map((c) => ({
          id: String(c.id),
          scenarioId: String(c.scenario_id ?? c.id),
          name: String(c.name ?? c.id),
          language: String(c.language ?? "EN"),
          turns: Array.isArray(c.user_turns) ? c.user_turns.map(String) : [],
        }))
      : goldFiles.map((g) => ({
          id: String(g.id),
          scenarioId: String(g.scenario_id ?? g.id),
          name: String(g.name ?? g.id),
          language: String(g.language ?? "EN"),
          turns: goldTurns(g)
            .filter((t) => t.role === "user")
            .map((t) => String(t.text)),
        }));

  // Rebind golds to scenarios: explicit case.gold_id first, then shared id
  // (our own bundles key gold files by case id), then scenario_id+language.
  const caseById = new Map(cases.map((c) => [String(c.id), c]));
  const golds: Record<string, CapturedGold> = {};
  for (const s of scenarios) {
    const declared = caseById.get(s.id)?.gold_id;
    const g =
      goldFiles.find((g) => declared !== undefined && String(g.id) === String(declared)) ??
      goldFiles.find((g) => String(g.id) === s.id) ??
      goldFiles.find(
        (g) =>
          g.scenario_id !== undefined &&
          String(g.scenario_id) === s.scenarioId &&
          String(g.language ?? "EN") === s.language,
      );
    if (!g) continue;
    golds[s.id] = {
      scenarioId: s.scenarioId,
      language: s.language,
      name: s.name,
      turns: goldTurns(g).map((t) => ({ role: t.role, text: String(t.text) })),
      goldId: String(g.id),
      blessedAt: typeof g.blessed_at === "string" ? g.blessed_at : undefined,
      sourcePointer: typeof g.source_pointer === "string" ? g.source_pointer : undefined,
    };
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

  return { prompt: agent.system_prompt ?? "", scenarios, golds, vars };
}
