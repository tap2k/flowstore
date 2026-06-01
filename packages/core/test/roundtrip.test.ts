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
