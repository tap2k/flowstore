import { describe, it, expect } from "vitest";
import { decomposeSpec, loadProject } from "@flowstore/core/files";
import { loadExampleSpec, loadFixtureSpec, normalize, sortById } from "./fixtures";

describe("decomposeSpec ↔ loadProject round-trip", () => {
  it("is lossless for the coffee single-file spec", () => {
    const source = loadExampleSpec("coffee/coffee.json");
    const fileMap = decomposeSpec(source);
    const { spec: resolved, errors } = loadProject(fileMap);

    expect(errors).toEqual([]);
    expect(resolved).not.toBeNull();
    expect(normalize(sortById(resolved!))).toEqual(normalize(sortById(source)));
  });

  it("emits a non-trivial file map (decomposition actually splits the spec)", () => {
    const source = loadExampleSpec("coffee/coffee.json");
    const fileMap = decomposeSpec(source);
    expect(Object.keys(fileMap).length).toBeGreaterThan(1);
  });

  it("is lossless for the decomposed multi-flow fnol-min fixture", () => {
    const source = loadFixtureSpec("fnol-min.json");
    const { spec: resolved, errors } = loadProject(decomposeSpec(source));
    expect(errors).toEqual([]);
    expect(normalize(sortById(resolved!))).toEqual(normalize(sortById(source)));
  });
});

describe("decomposed on-disk layout contract (FILE-MODEL)", () => {
  // The round-trip above only proves decompose/load are inverse — it stays green
  // even if the layout silently changes. This snapshot pins the actual file
  // names + paths that a Git repo (and the editor's GitHub-open path) depend on,
  // so a change to the decomposition layout is caught here.
  it("emits the expected file paths for fnol-min", () => {
    const paths = Object.keys(decomposeSpec(loadFixtureSpec("fnol-min.json"))).sort();
    expect(paths).toMatchSnapshot();
  });
});

describe("orphaned scripts-CSV rows", () => {
  it("warns on an explicit-id row missing from the flow file, but still merges it", () => {
    const source = loadFixtureSpec("fnol-min.json");
    const fileMap = decomposeSpec(source);
    const flowPath = Object.keys(fileMap).find((p) => /^flows\/.*\.flow\.json$/.test(p))!;
    const csvPath = flowPath.replace(".flow.json", ".scripts.csv");
    const csv = fileMap[csvPath] ?? "id,EN\n";
    fileMap[csvPath] = csv.trimEnd() + "\ns_ghost,A line whose script was removed from the flow file\n";

    const { spec, errors } = loadProject(fileMap);
    expect(spec).not.toBeNull();
    const flowId = /^flows\/(.+)\.flow\.json$/.exec(flowPath)![1];
    const flow = spec!.flows.find((f) => f.id === flowId)!;
    expect(flow.scripts!.some((s) => s.id === "s_ghost")).toBe(true); // still merged
    expect(errors.some((e) => e.path === csvPath && /warning: script "s_ghost"/.test(e.message))).toBe(true);
  });

  it("does not warn for id-less rows (sheet-authoring append path)", () => {
    const source = loadFixtureSpec("fnol-min.json");
    const fileMap = decomposeSpec(source);
    const flowPath = Object.keys(fileMap).find((p) => /^flows\/.*\.flow\.json$/.test(p))!;
    const csvPath = flowPath.replace(".flow.json", ".scripts.csv");
    const csv = fileMap[csvPath] ?? "id,EN\n";
    fileMap[csvPath] = csv.trimEnd() + "\n,An authored line with no id\n";

    const { errors } = loadProject(fileMap);
    expect(errors.filter((e) => /warning: script/.test(e.message))).toEqual([]);
  });
});
