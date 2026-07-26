import type { CellState, Scenario } from "./types";
import { cellKey } from "./types";

// Study export in file-model shape from the first save: a serialized FileMap
// ({path: content}) of a mini flowstore project — scenarios as scripted test
// cases, transcripts as run results (existing schemas), the pasted prompt as
// agent.json's system_prompt (full text, no {{generated}} — which is itself
// the imported/prompt-is-master signal). One JSON bundle today
// (trivially zippable later); the export IS the graduation artifact — the
// harness runs it, the editor opens it.
//
// Note: agent.json is a stub — an imported-prompt project has no flows yet,
// and entry_flow_id is required by AgentSchema (the "flowless project" open
// question). The stub records intent; extraction at graduation mints flows.

export function buildStudyBundle(args: {
  prompt: string;
  models: string[];
  incumbent: string;
  scenarios: Scenario[];
  cells: Record<string, CellState>;
}): Record<string, string> {
  const { prompt, models, incumbent, scenarios, cells } = args;
  const stamp = new Date().toISOString();
  const runDir = `tests/runs/${stamp.slice(0, 19).replace(/[:T]/g, "-")}-compare`;
  const files: Record<string, string> = {};
  const j = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

  files["flowstore.json"] = j({ $schema: "flowstore://spec/project/v0" });
  files["agent.json"] = j({
    $schema: "flowstore://spec/agent/v0",
    id: "imported-agent",
    name: "Imported agent (compare study)",
    meta: { name: "Imported agent", modality: "text", languages: uniqueLanguages(scenarios) },
    system_prompt: prompt,
    // The imported prompt is the authoritative record; any spec content
    // (including flows extraction mints later) is a derived view.
    source_of_truth: "prompt",
    // Stub: no flows exist pre-extraction. See "flowless project" note above.
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
    for (const m of models) {
      const c = cells[cellKey(s.id, m)];
      if (!c || c.status !== "done") continue;
      const path = `${runDir}/${s.id}--${m.replace(/[^a-zA-Z0-9._-]/g, "_")}.result.json`;
      resultFiles.push(path);
      files[path] = j({
        $schema: "flowstore://run/result/v0",
        test_case_id: s.id,
        timestamp: stamp,
        model: m,
        prompt_source: "imported-verbatim",
        language: s.language,
        usage: {
          text_in: c.usage?.inputTokens,
          text_out: c.usage?.outputTokens,
          ...(c.usage?.cost !== undefined ? { cost: c.usage.cost } : {}),
        },
        transcript: c.turns.map((t) => ({
          role: t.role,
          content: t.text,
          ...(t.latencyMs !== undefined ? { latency_ms: t.latencyMs } : {}),
        })),
      });
    }
  }

  files[`${runDir}/manifest.json`] = j({
    // Loose for now — formalized as flowstore://run/manifest/v0 when the
    // study fields settle (see studies plan).
    kind: "compare-study",
    timestamp: stamp,
    incumbent,
    models,
    scenario_ids: scenarios.map((s) => s.id),
    results: resultFiles,
  });

  return files;
}

function uniqueLanguages(scenarios: Scenario[]): string[] {
  return [...new Set(scenarios.map((s) => s.language))];
}
