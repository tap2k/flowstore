import type { TestCase } from "@flowstore/core/schema/files/testCase";
import type { TranscriptTurn } from "@flowstore/core/runtime/transcript";

// In-memory assertion evaluator for a running or completed case in
// Simulate. Returns one verdict per assertion type so the Simulate
// transcript renderer can light up per-turn markers, and the summary
// block can show an overall pass/fail count. State assertions are
// authored but render with a "needs runner" badge; they don't fire
// against the system-prompt path.
//
// Per the testCase schema: per-turn assertions target the *agent-only*
// subsequence of the transcript (turn 1 = the agent's opening when
// chatbot_initiates is true). Transcript-level assertions evaluate
// against the joined agent text.

export type Verdict = "pass" | "fail" | "pending";

export interface PerTurnVerdict {
  index: number;
  verdict: Verdict;
  reason?: string;
}

export interface TranscriptVerdict {
  index: number;
  verdict: Verdict;
  reason?: string;
}

export interface CaseVerdicts {
  perTurn: PerTurnVerdict[];
  transcript: TranscriptVerdict[];
  // Number of assertions that we evaluate in the browser today
  // (per-turn + transcript-level). State assertions are excluded
  // (badged "needs runner"); evaluators are out-of-band.
  evaluable: number;
  passed: number;
  failed: number;
  pending: number;
}

export function evaluateCaseAgainstTranscript(
  testCase: TestCase | null,
  transcript: TranscriptTurn[],
  runComplete: boolean,
): CaseVerdicts {
  const perTurn: PerTurnVerdict[] = [];
  const transcriptVerdicts: TranscriptVerdict[] = [];
  if (!testCase) {
    return { perTurn, transcript: transcriptVerdicts, evaluable: 0, passed: 0, failed: 0, pending: 0 };
  }

  const agentTurns = transcript.filter((t) => t.role === "agent");

  (testCase.assertions ?? []).forEach((a, i) => {
    const turnText = agentTurns[a.turn - 1]?.text;
    if (turnText === undefined) {
      perTurn.push({
        index: i,
        verdict: runComplete ? "fail" : "pending",
        reason: runComplete
          ? `agent turn ${a.turn} never occurred (only ${agentTurns.length} produced)`
          : undefined,
      });
      return;
    }
    const haystack = turnText.toLowerCase();
    if (a.must_contain) {
      for (const needle of a.must_contain) {
        if (!haystack.includes(needle.toLowerCase())) {
          perTurn.push({
            index: i,
            verdict: "fail",
            reason: `turn ${a.turn} missing "${needle}"`,
          });
          return;
        }
      }
    }
    if (a.must_not_contain) {
      for (const needle of a.must_not_contain) {
        if (haystack.includes(needle.toLowerCase())) {
          perTurn.push({
            index: i,
            verdict: "fail",
            reason: `turn ${a.turn} unexpectedly contains "${needle}"`,
          });
          return;
        }
      }
    }
    perTurn.push({ index: i, verdict: "pass" });
  });

  const agentJoined = agentTurns.map((t) => t.text).join("\n");
  const agentLower = agentJoined.toLowerCase();

  (testCase.transcript_assertions ?? []).forEach((ta, i) => {
    // Transcript-level evaluates at completion. Mid-run they could be
    // pending (we can't tell if a count will be exceeded), but for the
    // most common kinds (substring/regex) a positive match is decisive
    // immediately. Keep simple: evaluate when runComplete or when an
    // assertion can decisively pass mid-run.
    if (ta.kind === "substring") {
      const pat = (ta.pattern ?? "").toLowerCase();
      const present = pat !== "" && agentLower.includes(pat);
      const wantPresent = ta.must_appear !== false;
      if (wantPresent) {
        if (present) transcriptVerdicts.push({ index: i, verdict: "pass" });
        else
          transcriptVerdicts.push({
            index: i,
            verdict: runComplete ? "fail" : "pending",
            reason: runComplete ? `"${ta.pattern}" never appeared` : undefined,
          });
      } else {
        if (present)
          transcriptVerdicts.push({
            index: i,
            verdict: "fail",
            reason: `"${ta.pattern}" appeared (must_appear=false)`,
          });
        else
          transcriptVerdicts.push({
            index: i,
            verdict: runComplete ? "pass" : "pending",
          });
      }
      return;
    }
    if (ta.kind === "regex") {
      try {
        const re = new RegExp(ta.pattern ?? "");
        const matches = re.test(agentJoined);
        const wantPresent = ta.must_appear !== false;
        if (wantPresent === matches) {
          transcriptVerdicts.push({
            index: i,
            verdict: matches || runComplete ? "pass" : "pending",
          });
        } else {
          transcriptVerdicts.push({
            index: i,
            verdict: runComplete ? "fail" : "pending",
            reason: runComplete
              ? matches
                ? `regex matched (must_appear=false)`
                : `regex never matched`
              : undefined,
          });
        }
      } catch (e) {
        transcriptVerdicts.push({
          index: i,
          verdict: "fail",
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    if (ta.kind === "count") {
      if (!ta.pattern) {
        transcriptVerdicts.push({ index: i, verdict: "pending" });
        return;
      }
      const pat = ta.pattern.toLowerCase();
      let count = 0;
      let from = 0;
      while (from <= agentLower.length) {
        const found = agentLower.indexOf(pat, from);
        if (found === -1) break;
        count++;
        from = found + pat.length;
      }
      const min = ta.min_occurrences ?? 0;
      const max = ta.max_occurrences ?? Infinity;
      // Mid-run, count can still increase. Decide only at completion
      // unless we've already exceeded max.
      if (count > max) {
        transcriptVerdicts.push({
          index: i,
          verdict: "fail",
          reason: `count ${count} exceeds max ${max}`,
        });
        return;
      }
      if (!runComplete) {
        transcriptVerdicts.push({ index: i, verdict: "pending" });
        return;
      }
      if (count < min) {
        transcriptVerdicts.push({
          index: i,
          verdict: "fail",
          reason: `count ${count} below min ${min}`,
        });
      } else {
        transcriptVerdicts.push({ index: i, verdict: "pass" });
      }
      return;
    }
    if (ta.kind === "must_terminate_within") {
      const limit = ta.max_turns ?? Infinity;
      if (agentTurns.length > limit) {
        transcriptVerdicts.push({
          index: i,
          verdict: "fail",
          reason: `${agentTurns.length} agent turns > limit ${limit}`,
        });
      } else if (runComplete) {
        transcriptVerdicts.push({ index: i, verdict: "pass" });
      } else {
        transcriptVerdicts.push({ index: i, verdict: "pending" });
      }
      return;
    }
  });

  const evaluable = perTurn.length + transcriptVerdicts.length;
  const passed =
    perTurn.filter((v) => v.verdict === "pass").length +
    transcriptVerdicts.filter((v) => v.verdict === "pass").length;
  const failed =
    perTurn.filter((v) => v.verdict === "fail").length +
    transcriptVerdicts.filter((v) => v.verdict === "fail").length;
  const pending = evaluable - passed - failed;

  return {
    perTurn,
    transcript: transcriptVerdicts,
    evaluable,
    passed,
    failed,
    pending,
  };
}
