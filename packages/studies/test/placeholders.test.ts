import { describe, it, expect } from "vitest";
import { detectPlaceholders } from "../src/placeholders";

describe("detectPlaceholders", () => {
  it("finds {{vars}} in first-appearance order, deduped", () => {
    expect(
      detectPlaceholders("Hi {{name}}, welcome to {{clinic}}. Bye {{name}}."),
    ).toEqual(["name", "clinic"]);
  });

  it("excludes the reserved {{generated}} splice", () => {
    expect(detectPlaceholders("Pre {{generated}} post {{other}}")).toEqual(["other"]);
  });

  it("ignores single braces and malformed tokens", () => {
    expect(detectPlaceholders("a {b} c {{1bad}} d {{ spaced }} e")).toEqual([]);
  });

  it("returns empty for a plain prompt", () => {
    expect(detectPlaceholders("You are a helpful agent.")).toEqual([]);
  });
});
