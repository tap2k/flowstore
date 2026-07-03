/**
 * Flow-watcher harness — exercise runFlowDecode outside the browser so the
 * attribution can be iterated against real output instead of eyeballing the
 * canvas. Reuses @flowstore/core in-source (run with tsx, which honors the
 * package `exports` → src mapping).
 *
 * Usage:
 *   GOOGLE_API_KEY=... npx tsx scripts/watcher-harness.ts
 *   OPENAI_API_KEY=... npx tsx scripts/watcher-harness.ts --model gpt-4o-mini
 *   npx tsx scripts/watcher-harness.ts --print-prompt        # dry: no API call
 *   npx tsx scripts/watcher-harness.ts --spec path/to/spec.json --transcript path/to/turns.json
 *
 * A transcript file is JSON: [{ "role": "agent"|"user", "text": "...", "flow"?: "id" }].
 * `flow` on agent turns (optional) is ground truth → prints turn-by-turn agreement.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Spec } from "@flowstore/core/schema/v0";
import { runFlowDecode, buildDecodeUserPrompt, resolveDecodedPath } from "@flowstore/core/runtime/flowWatcher";
import { buildTransitionTable } from "@flowstore/core/runtime/transitionTable";
import { readDirectoryToFileMap } from "@flowstore/core/files/node";
import { loadProject } from "@flowstore/core/files/load";

type Turn = { role: "agent" | "user"; text: string; flow?: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

// --project <dir> loads a real decomposed project (agent.json + flows/…);
// --spec <file> or the default loads a monolithic Spec JSON.
const projectDir = arg("project");
let spec: Spec;
let specPath: string;
if (projectDir) {
  specPath = projectDir;
  const res = loadProject(readDirectoryToFileMap(projectDir));
  if (!res.spec) {
    console.error("loadProject failed:", res.errors);
    process.exit(1);
  }
  spec = res.spec;
} else {
  specPath =
    arg("spec") ??
    fileURLToPath(new URL("../packages/core/test/fixtures/fnol-min.json", import.meta.url));
  spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
}

// Default fnol transcript: intake → verify → claim (ground truth in `flow`).
const DEFAULT_TRANSCRIPT: Turn[] = [
  { role: "agent", text: "Hi, this is Nova with Northwind. I can help file a claim. What's your policy number?", flow: "flow_intake" },
  { role: "user", text: "It's NW-88213." },
  { role: "agent", text: "Thanks. To verify your identity, can you confirm the ZIP code on the policy?", flow: "flow_verify" },
  { role: "user", text: "90210." },
  { role: "agent", text: "Verified, thank you. Is this an auto or a home claim?", flow: "flow_claim" },
  { role: "user", text: "Auto — someone rear-ended me at a light this morning." },
  { role: "agent", text: "I'm sorry that happened. Let me capture the details — where did it occur?", flow: "flow_claim" },
];

const transcriptPath = arg("transcript");
const transcript: Turn[] = transcriptPath
  ? (JSON.parse(readFileSync(transcriptPath, "utf8")) as Turn[])
  : DEFAULT_TRANSCRIPT;

if (has("print-prompt")) {
  console.log(buildDecodeUserPrompt(spec, { transcript }));
  process.exit(0);
}

const googleKey = process.env.GOOGLE_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const provider = googleKey ? "google" : openaiKey ? "openai" : null;
const apiKey = googleKey ?? openaiKey ?? "";
const model = arg("model") ?? (provider === "google" ? "gemini-2.5-flash" : "gpt-4o-mini");

if (!provider) {
  console.error("Set GOOGLE_API_KEY or OPENAI_API_KEY (or pass --print-prompt for a dry run).");
  process.exit(1);
}

// Mimic the browser: it re-decodes the transcript-so-far after EACH agent turn,
// and the glow = resolveDecodedPath(...).current of that prefix. This is the path
// that actually runs live, and it can behave differently from one full-transcript
// decode.
async function incremental() {
  const table = buildTransitionTable(spec);
  const agentIdxs = transcript.flatMap((t, i) => (t.role === "agent" ? [i] : []));
  console.log(`spec: ${specPath}\nprovider: ${provider}  model: ${model}\nINCREMENTAL (glow after each agent turn):\n`);
  for (let k = 0; k < agentIdxs.length; k++) {
    const prefix = transcript.slice(0, agentIdxs[k] + 1);
    let cur = "(threw)";
    try {
      const steps = await runFlowDecode(spec, provider!, apiKey, model, { transcript: prefix });
      const r = resolveDecodedPath(spec.agent.entry_flow_id, steps, table);
      cur = r ? `${r.current.flowId}  [${r.current.status}]  conf=${r.current.confidence.toFixed(2)}` : "(null)";
    } catch (e) {
      cur = `THREW: ${e instanceof Error ? e.message : e}`;
    }
    const truth = transcript[agentIdxs[k]].flow;
    const ok = truth && cur.startsWith(truth) ? "✓" : truth ? `✗ (truth ${truth})` : "";
    console.log(`  after agent[${k}]: ${cur} ${ok}`);
  }
}

async function main() {
  if (has("incremental")) return incremental();
  console.log(`spec: ${specPath}\nprovider: ${provider}  model: ${model}\n`);
  let steps;
  try {
    steps = await runFlowDecode(spec, provider!, apiKey, model, { transcript });
  } catch (e) {
    console.error("runFlowDecode threw:\n", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const table = buildTransitionTable(spec);
  const resolved = resolveDecodedPath(spec.agent.entry_flow_id, steps, table);

  const agentTurns = transcript.filter((t) => t.role === "agent");
  const truth = agentTurns.map((t) => t.flow);
  const haveTruth = truth.every((f) => typeof f === "string");

  console.log("decoded path (per agent turn):");
  steps.forEach((s, i) => {
    const mark = haveTruth ? (s.flow_id === truth[i] ? "✓" : `✗ (truth: ${truth[i]})`) : "";
    console.log(`  [${i}] ${s.flow_id.padEnd(14)} via=${(s.via_exit_path_id ?? "-").padEnd(10)} conf=${s.confidence.toFixed(2)} ${mark}`);
  });

  if (haveTruth) {
    const correct = steps.filter((s, i) => s.flow_id === truth[i]).length;
    console.log(`\nagreement: ${correct}/${steps.length} (${Math.round((100 * correct) / steps.length)}%)`);
  }

  console.log("\nresolved current:", resolved?.current);
  console.log("traversed edges:", resolved?.traversedEdgeIds);
}

main();
