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
}): Record<string, string> {
  const { prompt, models, scenarios, cells, golds } = args;
  const stamp = new Date().toISOString();
  const runDir = `tests/runs/${stamp.slice(0, 19).replace(/[:T]/g, "-")}-compare`;
  const files: Record<string, string> = {};
  const j = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

  files["flowstore.json"] = j({ $schema: "flowstore://spec/project/v0" });
  files["agent.json"] = j({
    $schema: "flowstore://spec/agent/v0",
    id: "imported-agent",
    name: "Imported agent (compare study)",
    meta: {
      name: "Imported agent",
      modality: "text",
      languages: [...new Set(scenarios.map((s) => s.language))],
    },
    // Full override (no {{generated}}): compiles to itself verbatim — see
    // SCHEMA.md § system_prompt.
    system_prompt: prompt,
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
