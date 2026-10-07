import { describe, expect, it } from "vitest";
import { isFileBundleText, parseFileBundleText } from "@flowstore/core/files/markdown";

const bundle = "--- file: agent.md ---\n---\nid: a\n---\n--- file: flows/greet.md ---\n# Greet\n\nSay hi.";

describe("file bundle text", () => {
  it("parses a bare bundle", () => {
    expect(Object.keys(parseFileBundleText(bundle))).toEqual(["agent.md", "flows/greet.md"]);
  });

  it("strips a wrapping code fence copied from a chat window", () => {
    for (const fence of ["```", "````", "```text"]) {
      const close = fence.replace(/[a-z]+$/, "");
      const files = parseFileBundleText(`${fence}\n${bundle}\n${close}\n`);
      expect(isFileBundleText(`${fence}\n${bundle}\n${close}`)).toBe(true);
      expect(files["flows/greet.md"]).toBe("# Greet\n\nSay hi.\n");
    }
  });
});
