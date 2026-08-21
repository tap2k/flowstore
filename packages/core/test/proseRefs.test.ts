import { describe, it, expect } from "vitest";
import {
  applyAllProseReferenceFixes,
  applyProseReferenceFix,
  findDanglingReferences,
  findProseReferences,
  nameInUse,
} from "@flowstore/core/validation/proseRefs";
import type { Spec } from "@flowstore/core/schema/v0";

// A spec whose prose still mentions "Payment Plan" (a flow renamed away) and
// "loan_amount" (a variable renamed away).
function spec(): Spec {
  return {
    agent: {
      id: "agent_1",
      name: "Test",
      meta: { identity: "x", purpose: "", modality: "voice", languages: ["EN", "ES"] },
      entry_flow_id: "flow_a",
      variables: { total_amount: {} },
      knowledge: {
        faq: [
          {
            id: "faq_1",
            question: "What about Payment Plan?",
            answer: { EN: "We route you to Payment Plan.", ES: "Le llevamos a Payment Plan." },
          },
        ],
      },
    },
    flows: [
      {
        id: "flow_a",
        name: "Repayment Plan",
        type: "happy",
        instructions: "Offer the Payment Plan. Mention `loan_amount` and {{loan_amount}}.",
        scripts: [
          {
            id: "s_1",
            text: "Your Payment Plan starts at {{loan_amount}}.",
            variations: { EN: ["About the Payment Plan…"] },
          },
        ],
        knowledge: {
          faq: [{ id: "faq_2", question: "q", answer: "Ask about Payment Plan." }],
        },
        exit_paths: [
          {
            id: "xp_1",
            goto: "END",
            condition: { method: "llm", expression: "the caller wants the Payment Plan" },
          },
        ],
      },
      {
        id: "flow_b",
        name: "Interrupt",
        type: "interrupt",
        entry_condition: { method: "llm", expression: "caller asks about loan_amount" },
        exit_paths: [],
      },
    ],
  };
}

describe("proseRefs — detection", () => {
  it("finds mentions across instructions, conditions, FAQ answers, and scripts", () => {
    const refs = findDanglingReferences(spec(), "Payment Plan");
    const fields = refs.map((r) => r.ref.field).sort();
    expect(fields).toEqual([
      "exit-condition",
      "faq-answer",
      "faq-answer",
      "instructions",
      "script",
    ]);
    // agent FAQ counts both languages of the one answer field.
    const agentFaq = refs.find((r) => r.ref.field === "faq-answer" && !("flowId" in r.ref && r.ref.flowId));
    expect(agentFaq?.count).toBe(2);
    // script counts text + variation.
    expect(refs.find((r) => r.ref.field === "script")?.count).toBe(2);
  });

  it("matches backticked and {{placeholder}} mentions of a variable", () => {
    const refs = findDanglingReferences(spec(), "loan_amount");
    const fields = refs.map((r) => r.ref.field).sort();
    // instructions (`loan_amount` + {{loan_amount}}), entry condition, script text.
    expect(fields).toEqual(["entry-condition", "instructions", "script"]);
    expect(refs.find((r) => r.ref.field === "instructions")?.count).toBe(2);
  });

  it("is word-boundary exact: no partial or case-insensitive matches", () => {
    const s = spec();
    s.flows[0].instructions = "Payment Planner and payment plan are different.";
    expect(findProseReferences(s, "Payment Plan").some((r) => r.ref.field === "instructions")).toBe(
      false,
    );
  });

  it("returns nothing when the name still names a current entity", () => {
    expect(nameInUse(spec(), "Repayment Plan")).toBe(true);
    expect(nameInUse(spec(), "total_amount")).toBe(true);
    expect(findDanglingReferences(spec(), "Repayment Plan")).toEqual([]);
    expect(findDanglingReferences(spec(), "")).toEqual([]);
  });
});

describe("proseRefs — fixes", () => {
  it("fixes a single field, all languages, leaving the rest untouched", () => {
    const s = spec();
    const ref = findDanglingReferences(s, "Payment Plan").find(
      (r) => r.ref.field === "faq-answer" && !(r.ref as { flowId?: string }).flowId,
    )!;
    const fixed = applyProseReferenceFix(s, ref.ref, "Payment Plan", "Repayment Plan");
    expect(fixed.agent.knowledge!.faq![0].answer).toEqual({
      EN: "We route you to Repayment Plan.",
      ES: "Le llevamos a Repayment Plan.",
    });
    // untouched elsewhere; original spec not mutated.
    expect(fixed.flows[0].instructions).toContain("Payment Plan");
    expect(s.agent.knowledge!.faq![0].answer).toMatchObject({ EN: "We route you to Payment Plan." });
  });

  it("fix-all leaves no dangling mentions behind", () => {
    const s = spec();
    const refs = findDanglingReferences(s, "Payment Plan");
    const fixed = applyAllProseReferenceFixes(s, refs, "Payment Plan", "Repayment Plan");
    expect(findProseReferences(fixed, "Payment Plan")).toEqual([]);
    // Question text is deliberately out of scope (answers only).
    expect(fixed.agent.knowledge!.faq![0].question).toContain("Payment Plan");
  });

  it("fixes {{placeholder}} and backticked variable mentions", () => {
    const s = spec();
    const refs = findDanglingReferences(s, "loan_amount");
    const fixed = applyAllProseReferenceFixes(s, refs, "loan_amount", "total_amount");
    expect(fixed.flows[0].instructions).toBe(
      "Offer the Payment Plan. Mention `total_amount` and {{total_amount}}.",
    );
    expect(fixed.flows[0].scripts![0].text).toBe("Your Payment Plan starts at {{total_amount}}.");
  });
});
