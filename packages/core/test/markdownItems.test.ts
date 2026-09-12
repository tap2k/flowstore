import { describe, it, expect } from "vitest";
import { parseItems } from "@flowstore/core/files/markdown";

describe("parseItems", () => {
  it("treats spacing after the colon as layout, not content", () => {
    const a = parseItems("- g_one: Keep it short.\n- g_two: Decline politely.");
    const b = parseItems("- g_one:   Keep it short.  \n- g_two:\tDecline politely.");
    expect(b.items).toEqual(a.items);
    expect(a.items).toEqual([{ key: "g_one", text: "Keep it short." }, { key: "g_two", text: "Decline politely." }]);
  });
  it("keeps continuation lines", () => {
    const { items } = parseItems("- g: first\n  second");
    expect(items).toEqual([{ key: "g", text: "first\nsecond" }]);
  });
});
