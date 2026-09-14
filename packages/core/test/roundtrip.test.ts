import { describe, it, expect } from "vitest";
import { decomposeSpec, loadProject, parseFlow } from "@flowstore/core/files";
import { loadExampleSpec, loadFixtureSpec, normalize, sortById } from "./fixtures";

describe("decomposeSpec ↔ loadProject round-trip", () => {
  it("is lossless for the coffee single-file spec", () => {
    const source = loadExampleSpec("coffee/coffee.json");
    const { spec: resolved, errors } = loadProject(decomposeSpec(source));
    expect(errors).toEqual([]);
    expect(normalize(sortById(resolved!))).toEqual(normalize(sortById(source)));
  });

  it("is lossless for the decomposed multi-flow fnol-min fixture", () => {
    const source = loadFixtureSpec("fnol-min.json");
    const { spec: resolved, errors } = loadProject(decomposeSpec(source));
    expect(errors).toEqual([]);
    expect(normalize(sortById(resolved!))).toEqual(normalize(sortById(source)));
  });
});

describe("source layout contract (FILE-MODEL)", () => {
  // The round-trip stays green if the layout silently changes; this pins the
  // file names a repo, the editor's GitHub save, and the harnesses depend on.
  it("emits the expected file paths for fnol-min", () => {
    const paths = Object.keys(decomposeSpec(loadFixtureSpec("fnol-min.json"))).sort();
    expect(paths).toMatchSnapshot();
  });

  it("never emits README.md (hand-written READMEs must survive editor saves)", () => {
    expect(decomposeSpec(loadFixtureSpec("fnol-min.json"))["README.md"]).toBeUndefined();
  });
});

describe("markdown conventions", () => {
  const langs = ["EN", "ES"];

  it("reads a paragraph script as plain text and later language lines as variations", () => {
    const flow = parseFlow("f", [
      "# Flow",
      "Do the thing.",
      "## Scripts",
      "### s_hello",
      "Hello there.",
      "- EN: Hi!",
      "- EN: Hey.",
    ].join("\n"), "flows/f.md", langs);
    expect(flow.scripts).toEqual([{ id: "s_hello", text: "Hello there.", variations: { EN: ["Hi!", "Hey."] } }]);
  });

  it("reads language lines as a per-language map, repeats as variations", () => {
    const flow = parseFlow("f", "# Flow\n## Scripts\n### s_x\n- EN: one\n- ES: uno\n- EN: two", "flows/f.md", langs);
    expect(flow.scripts).toEqual([{ id: "s_x", text: { EN: "one", ES: "uno" }, variations: { EN: ["two"] } }]);
  });

  it("keeps a multi-line script text through indented continuation lines", () => {
    const flow = parseFlow("f", "# Flow\n## Scripts\n### s_x\n- EN: first line\n  second line", "flows/f.md", langs);
    expect(flow.scripts![0].text).toEqual({ EN: "first line\nsecond line" });
  });

  it("expands the condition and actions shorthands in frontmatter", () => {
    const flow = parseFlow("f", [
      "---",
      "type: happy",
      "entry_condition: caller asks for a human",
      "exit_paths:",
      "  - { id: xp_a, goto: END, condition: caller is done, actions: [cap_log] }",
      "  - { id: xp_b, goto: END, condition: { expression: 'x == 1', method: calculation } }",
      "---",
      "# Flow",
    ].join("\n"), "flows/f.md", langs);
    expect(flow.entry_condition).toEqual({ expression: "caller asks for a human", method: "llm" });
    expect(flow.exit_paths[0]).toEqual({ id: "xp_a", goto: "END", condition: { expression: "caller is done", method: "llm" }, actions: [{ capability_id: "cap_log" }] });
    expect(flow.exit_paths[1].condition).toEqual({ expression: "x == 1", method: "calculation" });
  });

  it("rejects a flow without a name heading and an unknown section", () => {
    expect(() => parseFlow("f", "no heading", "flows/f.md", langs)).toThrow(/missing "# <flow name>"/);
    expect(() => parseFlow("f", "# Flow\n## Bogus\nx", "flows/f.md", langs)).toThrow(/unknown section/);
  });

  it("does not mistake a plain list line for a language line", () => {
    const flow = parseFlow("f", "# Flow\n## Scripts\n### s_x\n- Note: this is text, not a language", "flows/f.md", langs);
    expect(flow.scripts![0].text).toBe("- Note: this is text, not a language");
  });

  it("surfaces a duplicate guardrail id and a bad frontmatter as load errors, not throws", () => {
    const files = decomposeSpec(loadFixtureSpec("fnol-min.json"));
    files["guardrails.md"] += "- gr_dup: one\n- gr_dup: two\n";
    files["flows/flow_claim.md"] = "---\nexit_paths: [\n---\n# Claim";
    const { errors } = loadProject(files);
    expect(errors.some((e) => /duplicate guardrail id "gr_dup"/.test(e.message))).toBe(true);
    expect(errors.some((e) => e.path === "flows/flow_claim.md" && /frontmatter/.test(e.message))).toBe(true);
  });

  it("refuses the pre-markdown JSON layout and names the migrate command", () => {
    const { spec, errors } = loadProject({ "agent.json": "{}" });
    expect(spec).toBeNull();
    expect(errors[0].message).toMatch(/flowstore-migrate/);
  });

  it("refuses a markdown project with old files beside it, naming them", () => {
    const files = { ...decomposeSpec(loadFixtureSpec("fnol-min.json")), "flows/stale.flow.json": "{}" };
    const { spec, errors } = loadProject(files);
    expect(spec).toBeNull();
    expect(errors.some((e) => e.path === "flows/stale.flow.json" && /flowstore-migrate/.test(e.message))).toBe(true);
  });
});

describe("gold transcript grammar", () => {
  it("reads compare's textarea form (lowercase markers, unindented continuations)", async () => {
    const { parseTranscript } = await import("@flowstore/core/files/testing");
    expect(parseTranscript("user: hi\nagent: hello\nthere\nUser:bye", "g")).toEqual([
      { role: "user", text: "hi" },
      { role: "agent", text: "hello\nthere" },
      { role: "user", text: "bye" },
    ]);
  });
});

describe("flow steps round-trip (## Steps)", () => {
  it("parses ## Steps into flow.steps and emits it back identically", async () => {
    const { parseFlow } = await import("@flowstore/core/files/load");
    const { emitFlow } = await import("@flowstore/core/files/decompose");
    const md = [
      "---",
      "type: happy",
      "exit_paths:",
      "  - id: x",
      "    goto: END",
      "---",
      "# Identity",
      "",
      "Confirm who is on the line.",
      "",
      "## Steps",
      "",
      "### greet: Greeting",
      "Greet only.",
      "- scripts: s_greet",
      "",
      "### disclose: Disclosure",
      "Disclose and ask for the name.",
      "- scripts: s_disclose, s_disclose_alt",
      "",
      "## Scripts",
      "",
      "### s_greet",
      "Hi there!",
      "",
      "### s_disclose",
      "This call is recorded. Are you Sam?",
      "",
      "### s_disclose_alt",
      "Recorded call. Sam?",
      "",
    ].join("\n");
    const flow = parseFlow("identity", md, "flows/identity.md", ["EN"]);
    expect(flow.steps).toEqual([
      { id: "greet", name: "Greeting", instructions: "Greet only.", scripts: ["s_greet"] },
      { id: "disclose", name: "Disclosure", instructions: "Disclose and ask for the name.", scripts: ["s_disclose", "s_disclose_alt"] },
    ]);
    const again = parseFlow("identity", emitFlow(flow), "flows/identity.md", ["EN"]);
    expect(again).toEqual(flow);
  });
});
