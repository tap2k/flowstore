import { describe, it, expect } from "vitest";
import { csvSerialize, parseCsv } from "@flowstore/core/codegen/csv";
import { glossaryToCsv, parseGlossaryCsv, faqToCsv, parseFaqCsv } from "@flowstore/core/codegen/knowledgeCsv";
import { resolveLocalized } from "@flowstore/core/schema/v0";

describe("csv core round-trip", () => {
  it("preserves commas, quotes, and newlines through serialize → parse", () => {
    const rows = [
      ["id", "term", "definition"],
      ["g1", "comma, here", 'has "quotes"'],
      ["g2", "multi\nline", "plain"],
    ];
    expect(parseCsv(csvSerialize(rows))).toEqual(rows);
  });
});

describe("glossary CSV round-trip", () => {
  it("is lossless when ids are present", () => {
    const entries = [
      { id: "g1", term: "API", definition: "Application Programming Interface" },
      { id: "g2", term: "PTP", definition: "Promise to pay" },
    ];
    expect(parseGlossaryCsv(glossaryToCsv(entries))).toEqual(entries);
  });
});

describe("FAQ CSV round-trip", () => {
  it("round-trips a monolingual answer", () => {
    const entries = [{ id: "f1", question: "Hours?", answer: "9 to 5" }];
    const rt = parseFaqCsv(faqToCsv(entries, ["EN"]), ["EN"]);
    expect(rt[0].question).toBe("Hours?");
    expect(resolveLocalized(rt[0].answer, "EN", "EN")).toBe("9 to 5");
  });

  it("round-trips a multilingual answer per language", () => {
    const entries = [{ id: "f2", question: "Hours?", answer: { EN: "9 to 5", "es-MX": "9 a 5" } }];
    const rt = parseFaqCsv(faqToCsv(entries, ["EN", "es-MX"]), ["EN", "es-MX"]);
    expect(resolveLocalized(rt[0].answer, "EN", "EN")).toBe("9 to 5");
    expect(resolveLocalized(rt[0].answer, "es-MX", "EN")).toBe("9 a 5");
  });
});
