import type { ScenarioTurn } from "@flowstore/studies";

// The scenario textarea's line grammar — one parser, two serializations:
//
// - compact (no `user:` marker anywhere): one turn per line; plain lines
//   are user turns, an `agent:` prefix marks a gold reply. The cheap
//   typing path, and the only form most scenarios ever need.
// - explicit (any `user:` marker present): every `user:`/`agent:` marker
//   starts a turn, and unprefixed lines CONTINUE the current turn — once
//   markers exist they are the only thing that starts a turn, so plain
//   lines before the first marker coalesce into a single user turn. This
//   is how multi-line replies — real model output blessed via
//   save-as-gold — survive the round trip: the markers carry all the
//   structure, so no indentation tricks and no structured editor.
//
// turnsToText stays compact until some turn is multi-line, so scenarios
// keep the terse form until they need the markers.
//
// Known limitation: text that itself starts a line with "user:"/"agent:"
// misparses — a hand-typed turn starting with a marker, or (sharper) a
// blessed multi-line reply whose continuation line echoes transcript
// format, which explicit serialization emits verbatim and re-parse then
// splits. The gold pane renders the parse live, so a wrong-side bubble is
// immediately visible. No escape syntax until someone actually hits it.
//
// serialize∘parse is a NORMALIZER, not the identity (marker spacing and
// case, mode selection). The textarea must therefore hold its own draft
// and never echo the normalized form back mid-edit — see TurnsTextarea.
const AGENT = /^agent:\s?/i;
const USER = /^user:\s?/i;

export const turnsToText = (turns: ScenarioTurn[]): string => {
  const explicit = turns.some((t) => t.text.includes("\n"));
  return turns
    .map((t) => (explicit || t.role === "agent" ? `${t.role}: ${t.text}` : t.text))
    .join("\n");
};

export const textToTurns = (text: string): ScenarioTurn[] => {
  const lines = text.split("\n");
  const explicit = lines.some((l) => USER.test(l));
  const turns: ScenarioTurn[] = [];
  for (const line of lines) {
    if (USER.test(line)) {
      turns.push({ role: "user", text: line.replace(USER, "") });
    } else if (AGENT.test(line)) {
      turns.push({ role: "agent", text: line.replace(AGENT, "") });
    } else if (explicit && turns.length > 0) {
      turns[turns.length - 1].text += `\n${line}`;
    } else {
      turns.push({ role: "user", text: line });
    }
  }
  return turns;
};
