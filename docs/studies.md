# Studies: the evaluation entry point

Positioning and architecture decisions for the hosted study product. Converged 2026-07-25.

## Thesis

Evaluation is the front door; the spec is what they keep. We host cheap studies:
you pick the prompt, models, and languages; we run the matrix and give you a
report. The durable thing is the ledger — spec, golds, and study history,
versioned. Studies are a verb over it. (Who holds the *runtime* system of
record has its own arc — see "Two systems of record.")

The wedge is real because model choice is black magic and LLMs can't introspect:
nobody can predict which model handles their agent well, and asking the model
doesn't work. The only path is empirical. Running the same system verbatim
against N models is the fair comparison — and once golds and a spec exist, a
new model release is a re-run: same suite, one more column. What's out there
is kludgy and switch costs are low.

## Entry point: model churn

The IDE pitch ("author your agent as a spec") is a want. A need comes with a
deadline or a budget line. Model churn is the one pain that's *scheduled*:

- Deprecations have dates — migrate or break.
- Price changes land in the CFO's inbox.
- Every new release generates "should we be on this?" from the boss, forever.

In each case the team must answer "will our agent survive on model X?" and
today's state of the art is vibes and a few manual chats. Deprecation and
price-change announcements are a marketing calendar: every one is a batch of
prospects with the same deadline.

Why this over other candidate needs: production incidents are acute but
unschedulable, and reacting to them lands us in the crowded
observability/eval-platform market. Launch gates are real but low-frequency with
long sales cycles. Model churn recurs industry-wide on a known cadence, hits
everyone running an agent, and nobody owns it as a category.

**The product: the model-switch study.** "Find out if your agent works on
[new/cheaper/replacement model] — before you're forced to find out in
production."

## The intake constraint

The entry point cannot require a flowstore spec or a test suite. If the study's
prerequisite is "first adopt our IDE and write golds," the want is back in front
of the need. Customers bring what they have — their existing system prompt and
real transcripts, **or a live agent endpoint**. The extraction prompts
(AGENT-SPEC-PROMPT.txt; the gold-extraction prompt in the fnol example repo)
convert prompt + transcripts into a spec and golds.

The endpoint path (the execution layer's external agent mode, already built)
serves what a prompt upload can't: platform-locked customers who can't export
their prompt, golds *generated* by driving personas against the live agent —
fresh baseline, no PII-laden dashboard export — and spec-from-behavior when
there's no prompt text to extract from. An endpoint alone can't run a
migration study (you can't swap the model behind a black box), but paired
with a prompt it is the **production-parity control**: replay the same
scenarios against the live endpoint and our reproduction, and publish the
agreement rate — validating the harness before the report makes any claim.
Probe staging endpoints or test numbers, not production — probes cost the
customer money and pollute their analytics.

**The spec is the residue of the study, not its entry fee.** They come for "can
we switch to the cheaper model," they leave owning a spec with a regression
suite, and the next model release is a one-click re-run. Accumulated study
history — baselines per model release — is the moat. The runner is not: anyone
can shell out to N APIs.

## The whole surface is two verbs

The customer-facing product is two upload actions: **upload new system** (the
system prompt as deployed, or a pointer to a live endpoint) and **upload new
golds** (transcripts they bless).
Because system + golds are the agent's identity, these two verbs cover every
change a customer can make. Each upload is a versioned commit in our ledger —
a mirror of their runtime truth, not its master (see "Two systems of record").
Every study runs against a pinned (system, golds, bindings) triple (see Schema
implications), so every report is reproducible.

Studies are then event-driven — three deltas, three triggers:

- **New system uploaded** (customer): regression study — did the change hold,
  against pinned golds?
- **New golds uploaded** (customer): a reset — re-bless the baseline, recompute
  drift references.
- **New model released** (world): the model-churn study — we add the column and
  re-run. This is the trigger we own and market on.

This is CI for agents: the upload is the push, the study is the build, the
report is the build result. The entry product's whole surface is these two
verbs and a report — in the browser, a paste and a key; in kit form, two
files and a commit; hosted, two upload buttons and an inbox. No canvas, no
editor, nothing to learn.

## Two systems of record

In act one the **system prompt remains the runtime system of record.** It is
what runs in production; the customer changes their agent by editing it, in
their own stack, and uploading the new version. Our copy is a mirror. The
extracted spec is a *derived view* — the coordinate system for golds, results,
and cost — and when prompt and spec disagree, the prompt wins.

What we own from day one is the second system of record: the **ledger** — the
versioned history of (prompt, spec, golds, results) and every study column
ever run. The runtime truth is theirs; the memory is ours. The moat lives in
the ledger. (For endpoint intake the runtime truth isn't even copyable — we
can only *sample* it — so the agent's identity in the ledger rests entirely
on the golds and the behavior-derived spec, making golds-as-ground-truth
carry more weight, not less.)

Two consequences:

- **Extraction must reconcile, not re-parse.** Every system-prompt upload
  re-derives the spec — and if a fresh extraction can shuffle the graph's node
  identities, everything pinned to them shears off: gold attachments, drift
  baselines, per-node cost history, longitudinal columns. So re-extraction is a
  diff against the previous spec: preserve node identity wherever the
  underlying content persists; add or retire nodes only where the prompt
  actually changed. Golds anchor to *scenarios* (stable), with node attachment
  as a derived, recomputable link.
- **Adoption is a system-of-record handover, and should be named as one.** The
  conversion the upsells drive toward — compiler A/B, per-node routing — is
  precisely the moment the arrow flips: the spec becomes the master and the
  system prompt becomes a build artifact. That names the real switching cost
  (teams don't resist editors; they resist changing their source of truth), the
  precondition (the A/B parity proof), and the forcing reason (routing is
  inexpressible in a single prompt). Until a customer chooses the handover,
  nothing in the product requires it.

## The verbatim-prompt rule

The study runs the customer's prompt **verbatim** against each model. That is
the scientific control: the report's credibility rests on "this is what *your*
system does on model X," not on our codegen's rendition of their agent. The
extracted spec is used for structure only — the graph, scenario coverage, where
golds attach.

The compiler therefore sits out of act one. It returns as act two and as the
upsell: the report can close with "your prompt, re-specified and recompiled,
passes N more scenarios and holds across models — here's the A/B." Codegen as a
finding, not a prerequisite.

One epistemic caveat the report must carry: verbatim cuts both ways. A prompt
written in one vendor's dialect can fail on another model for formatting
reasons a real migration would trivially fix, so verbatim runs can *overstate*
candidate failures — the mirror image of the compiler critique. The report
says so, and the respec A/B is the structural answer.

## The report is the product

The buyer sees a standalone, forwardable artifact (HTML/PDF) — "a report of some
kind" that someone can send to their boss. It has to be good enough to forward.

**The graph (if any) supports the report.** In the study, the graph is not an
authoring surface; it is the report's coordinate system — it exists so a failure
has an address. "Model X fails 7 of 9 runs" is a number; "Model X loses the
thread at the payment-confirmation step, in Spanish," pointed at a node on a map
of their own agent, is a finding. Aggregate pass rates go in tables; the graph
earns its place only where failures cluster on structure. When the agent is a
shapeless blob or failures are diffuse (tone, formatting, language-wide
degradation), the report degrades to scenario tables — no decorative diagram. A
graph that localizes nothing signals padding in a document whose whole job is
credibility.

The customer never drew this graph. The report opens with a map of the agent
they've been running blind: it proves the extraction understood them, it's the
credibility beat before any results, and it introduces the spec without asking
them to adopt anything.

Visual skeleton: one large labeled reference graph up top, then small multiples
(one mini-graph per model, nodes colored by pass rate) below. Report node shapes
and naming should rhyme with the editor's, so a study customer who later opens
the canvas recognizes the map — continuity of visual vocabulary is what makes
"the spec is the residue" feel seamless.

**The eye test: side-by-side transcripts.** Aggregates earn trust; the
side-by-side creates conviction. Each highlighted scenario renders the same
conversation across model columns, color-coded — and the coding is free,
because the judge-in-handcuffs machinery already emits string-verified spans:
green on gold-matched and assertion-satisfying spans, red on violation spans,
turn bands keyed to flow node (tying transcripts to the graph's coordinate
system). "The identity check was skipped, right here, in this column" is a
highlighted sentence, not a cell value — the reader is the judge; we arrange
the evidence. This is the drift report's "here are paired transcripts"
generalized to the whole catalog, and the research side's deepest rule — read
the transcripts — productized. Curation is mechanical so it can't be accused
of cherry-picking: rank scenarios by cross-model divergence and show the most
divergent few. Alignment favors replay: scripted/replayed cases align
turn-by-turn; persona-driven runs align by node, approximately. (Browser
tool, post-v0: side-by-side *streaming during the run* — several models
answering the same caller live — is likely the product's best demo moment.)

**What a language column means.** The language axis is the language of the
*user side*, never the prompt: the customer's prompt runs verbatim while
scenarios and personas are translated, and the study grades comprehension,
response-language correctness, and — the finding that matters — guardrail
retention cross-lingually ("holds in English, drops the identity check in
Hindi"). It needs nothing from the customer. Two caveats: language columns
are conformance-graded only until golds are blessed in that language (drift
starts in the baseline language), and a language failure is itself the act-two
upsell — the fix is localized scripts, the spec's multilingual machinery.

Language is a **matrix axis within a study, not a study boundary**. Scenario
identity is language-invariant — "the refund scenario, rendered in Spanish"
is the same test as its English rendering, or the columns aren't comparable —
and the spec's `LocalizedString`/translation machinery already models exactly
this (renderings versioned; translator round-trip applies to scenarios). And
a study is an event fired by a delta: a model release must add one column to
one report, not spawn N sibling studies that fragment the migration decision.
The pinned tuple is therefore (system, golds, **matrix**), matrix = bindings
× languages; the longitudinal time series lives per cell; language scoping is
a run-time toggle.

**Cost is a first-class finding, not a footnote.** Model churn is half driven
by the bill. The runner meters tokens per scenario per model and the report
projects them at the customer's volume. The entry report's headline is often
one line — *the cheapest model that passes your suite* — where the pass rates
give it teeth and the dollar figure makes it forwardable to the CFO.

## Graph rendering: fit the medium

Don't reuse the xyflow canvas. It's built for the editor's medium — interactive,
pan/zoom, DOM-heavy, live React runtime. The report's medium is a document:
emailed, printed, PDF-exported, skimmed on a phone.

The report wants layout computed server-side at generation time (dagre or ELK —
these flows are layered DAGs) emitted as plain static SVG. **Compute the layout
once per spec and reuse identical coordinates in every small multiple** — that's
what makes twelve mini-graphs scannable. There are no hand-arranged editor
positions to inherit (the customer never drew the graph), so auto-layout is the
native path, not a fallback.

The reuse boundary sits one level down: share the graph *model* (nodes and edges
derived from the spec, in core, medium-agnostic); each medium owns its
presentation.

## The report flows back into the editor

The report is not a dead end — findings round-trip. The report data model gets
two consumers: the static renderer (the forwardable document) and the editor,
which loads the same artifact as an interactive view — pass-rate overlays on
the canvas (the simulate panel's highlighting, repurposed), click a failing
cell → the node, its failing transcripts, the gold it missed.

Fixing respects the system of record. Before handover, the fix lands in the
*prompt*: the extraction provenance anchors (node ↔ prompt span) let the
editor navigate from a failure on the graph to the offending paragraph of the
customer's own system prompt. After handover, the same gesture edits the spec
directly. Either way, LLM-assisted authoring can propose the fix (failing
transcript + missed gold + spec context → suggested edit), and the two verbs
close the loop: red report → fix → upload new system → regression study →
green column. This is the CI analogy completed — the report is the build
result *and* the door back into the workshop.

Strategically, the report viewer is the editor's trial run. Every fix cycle
spent navigating prompt paragraphs via the graph demonstrates what editing the
node directly would feel like; handover happens when editing the node beats
editing the paragraph. Entry-product scope is unchanged — the kit ships the
static report; the interactive viewer is the first hosted/editor surface a
customer touches, not a prerequisite.

## Reuse inventory

Rule: reuse where the study needs the same computation the IDE needed; build
fresh where the study's need is operational; never let "we already built it" put
something in the critical path.

Fits:

- Extraction prompts (messy source in, spec out) — the core of intake.
- Test-file shapes, golds, assertions — grading.
- The simulate panel's browser-side BYO-key engine — LLM calls from the
  browser, model adapters, the roster: this is the entry product's runner.
- External agent mode (`AgentEndpoint` + the transcript-level testing surface)
  — endpoint intake, already built (kit tier; CORS keeps it out of the
  browser).
- The graph model in core — the report renders it its own way (above).

Doesn't fit; don't force it:

- The compiler in act one (verbatim-prompt rule).
- The IDE surface (canvas, inspectors) as the vehicle — the entry product is
  a standalone dead-simple page, and the report is a standalone artifact, not
  a screen in the editor.
- A server-side runner in act one — the browser BYO-key engine covers the
  entry product; batch/hosted running arrives with the company tier.
- File-model / git decomposition — meaningless to someone who uploaded a blob;
  stays an IDE concern.

Honest inventory: roughly one-third reuse (extraction, grading shapes, graph
model), two-thirds new build (intake path, hosted runner, report generator). If
it had come out "90% reuse, just add a landing page," that would have been
sunk-cost bias talking.

## Same repo

The study product lives in this monorepo as new packages (`@flowstore/studies`,
`@flowstore/report`, a runner package) beside core.

Repo boundaries belong on stable contracts. The most unstable interface in the
plan is spec↔study: extraction emits the spec, golds attach to spec nodes,
results overlay the graph, the report's coordinate system is the spec's
structure. A repo boundary there means versioning the fastest-moving schema
across repos while it churns most. The stable contract is the model APIs —
that's where a boundary can safely sit.

One repo also settles identity: evaluation is something flowstore *does*, not a
second company. A separate repo would quietly make the study product the durable
thing and the spec an input format. The ledger — spec, golds, history — is the
durable thing, and the machinery that reads and writes it lives with it.

Consequences, accepted with eyes open:

- **The runner and report generator are Apache-2.0 and public.** Accepted: the
  moat is the ledger, the calendar, graders, and hosting convenience — none of
  which fork with the code — and openness serves the spec becoming a standard.
  Customer data (study inputs, transcripts, results) never enters the repo; it
  lives in the hosted service's storage.
- **Repo gravity** is the "overuse existing infra" risk wearing a different
  coat. Discipline moves to package boundaries, enforced mechanically: study
  packages may depend on core, never on browser.
- The only thing that ever warrants a separate private repo is the thin ops
  wrapper (auth, billing, queue, deploy config), and only when it exists.
- Satellite repos (per the fnol precedent) are for *content* — examples,
  eventually customer studies — never machinery.

The one-way door in all of this is the licensing consequence; everything else is
reversible with a `git mv`.

## The report catalog

The drift report, the routing report, and the compiler A/B are not separate
products — they are different kinds of reports at different frequencies,
produced by the same machine from the same ledger. Each has its own trigger,
cadence, and price:

- **Migration report** (the entry product): will your agent survive on model
  X, and what will it cost? Trigger: a release, deprecation, or forced
  migration. Free in kit form.
- **Repricing report**: your projected bill, recomputed. Trigger: a vendor
  price change. Zero new runs — the tokens are already in the ledger.
- **Regression report**: did your change hold? Trigger: upload new system.
- **Monitoring report** (subscription): did production move? Scheduled probes
  of a live endpoint against pinned golds — catches the *silent* change: the
  platform swapping the underlying model, a vendor "improvement" nobody
  announced. The one report that needs no upload and no release; hosted-native.
- **Drift report** (premium): is it still your agent? Below.
- **Routing report** (premium): which model where — the cost-optimization
  report. Below.
- **Respec A/B** (premium): your prompt recompiled from spec, at parity or
  better — the handover report.

Human grading is a premium layer on any of these (see Grading). Premiums
attach to the specialized reports; the subscription attaches to the calendar —
hosted testing, where we watch model events and run the reports for you. The
free tier is the kit running the migration report locally.

## The drift report

Not in the entry product — a premium report added after the migration report
earns trust.

The migration question has two parts: "does it still work?" — conformance to
spec, which is everything above — and "is it still *your agent*?" The second is
a behavior question, and pass rates get it wrong. The known failure mode:
migrations to a strictly more capable model that users revolt against on
character grounds, and vendors shipping tone regressions their own cards wave
off. A pass-rate-only report can be right on every number and wrong on the
migration decision.

It measures **drift, not quality** — no universal standard for good
character, no score, no "model X has better tone." Only "model X moves your
agent this far from its reference point; here are paired transcripts."

**The golds are the ground truth for drift.** At the initial point the golds
are curated from the customer's real transcripts — the incumbent's enacted
behavior, blessed by the customer — so drift-from-golds and
drift-from-incumbent coincide at study one. But the reference is the blessed
artifact, not the live model. Each gold then carries two readings: the
conformance reading (did the candidate reach the right outcome) and the drift
reading (does the residual — tone, register, what it reaches for — still match
the exemplar). One artifact, both axes; no separate behavior baseline to
maintain.

**Resets are explicit and versioned.** When a character change is intended —
the customer likes the new model's register — they re-bless: capture new golds,
commit. Changing the agent means changing the system and/or the golds; those
two artifacts *are* the agent's identity, with the spec as its structured
shadow until the system-of-record handover. So intended change is a commit;
unintended change is a finding — a conformance failure against the spec, or
drift against the golds. This is why the reference is pinned rather than
floating: a baseline of "whatever the incumbent does today" resets itself
silently at every migration and lets character erode by ratchet. Pinned golds
make character spend a recorded decision.

This also upgrades the report's "diffuse failures" case: tone, register, and
language-wide character shifts — the failures that don't localize to a graph
node — stop being the degraded fallback and become the drift report's subject.

Vocabulary discipline: studies *evaluate* against the spec; the drift report
*measures drift* from the customer's own baseline. A spec is a machine for
pinning conduct down until it has a right answer and can be evaluated; the
drift report covers the residual the spec can't pin. Don't market it as
"behavior evaluation" — grading character against a rubric is exactly the
posture it exists to avoid.

## Grading and the "cheap" promise

Human grading is an ops business — recruiting, calibration, throughput — and
it's what makes studies *not* cheap. Golds + assertions (auto-graded) are the
core cheap product; the test-file shapes already support it. Human grading is a
layer: the customer supplies their own graders through a grading UI, or pays a
premium tier. You can specify the questions and the gold standards either way.

**The judge stays in handcuffs.** One judge grading all columns shares a
vendor with some column — a circularity variant disclosure alone doesn't fix.
So assertions and gold-matching are the primary grading; the LLM judge is
minimal, pinned, disclosed, and may only select evidence from the transcript,
never overrule ground truth.

## Per-node model routing and token/cost estimation

Model choice doesn't have to be whole-agent — and cost, more than failure, is
what drives the split. Most turns in a conversation are cheap work —
greetings, slot-filling, confirmations — and a whole-agent model choice pays
strong-model rates for every one of them. Tokens are metered per turn, and
turns belong to nodes, so the ledger knows exactly where the money goes;
failures localize to nodes the same way — that's the graph's job. Act one's
data therefore already contains the routing finding: "the
payment-confirmation step is the only place the cheap model fails — and 70%
of your spend is on turns it handles fine. Run strong there, cheap everywhere
else; same pass rate, N% cheaper." Not "which model" but "which model
*where*," with a dollar delta attached.

Two caveats keep it honest. A mixed assignment needs its own verification run —
conversations cross node boundaries, so per-node results don't simply compose.
And the drift report applies doubly: a model switch mid-conversation is a
character seam, and voice consistency across the split is exactly what it
should check.

The recommendation is computable from the entry study; *executing* it is not.
It requires a runtime that switches models at node boundaries — which means
adopting the spec and runtime. That makes routing the deepest upsell in the
product: a dollar figure attached to adoption. The routing plan serializes as
`model_role` annotations on flows plus a role→model binding in the execution
layer, so it is recorded, versioned, and re-evaluated on the next model
release like everything else. That field — and everything else the report
catalog needs from the artifacts — is collected next.

## Schema implications

What the report catalog needs from the spec and artifacts — all additive (a
`$schema` version bump per SCHEMA.md's change policy). The existing testing
surface — personas, cases, golds, rubrics, per-case `language` — needs
essentially nothing; it was built for this.

- **Models per node: a role, not a model id.** Optional `model_role` on Flow
  (`"strong"`, `"cheap"`, any named role); the execution layer's existing
  `models/endpoints.json` `roles` map resolves role → concrete model per
  deployment. The spec records the shape of the routing plan — what the study
  discovers and what must version with the spec — while "execution separate
  from spec" holds: no model ids in the spec. This is SCHEMA.md's "per-flow
  model dispatch" open question resolved by the study product: the study makes
  the runtime costs visible that the question deferred on, the unit of
  dispatch is per-flow (the graph coordinate; per-widget prior art), and the
  schema field can precede the runtime's multi-provider plumbing because
  studies only record and evaluate assignments. Three artifacts stay
  separate: the spec's *intent* (roles — abstract, portable, the only layer
  humans hand-write, usually one default), the **binding** (role → exact
  pinned wire `model_id` + pricing-snapshot ref, in the study manifest and
  execution config — a study column is one), and the *recommendation* (the
  routing report's output, itself a binding). Roles scale with distinct
  capability requirements, not node count (~2–3 for a 40-node tree), and the
  indirection degrades gracefully to per-node pinning: a role with one member
  *is* a per-node pin — no second mechanism. That per-node assignment is hard
  to hand-specify is the thesis, not a flaw: the routing report computes
  bindings empirically; humans commit them. **Storage in the file model,
  three places for three lifecycles:** the *live* binding is the existing
  `models/endpoints.json` `roles` map (built for extension; non-secret, so
  it commits) — mutable, one per deployment. *Study columns* live in
  `studies/<id>/manifest.json` as **resolved snapshots** — role → concrete
  wire `model_id` + provider + pricing-snapshot ref, captured at run time
  even when authored as endpoint references, because entries drift and
  columns are immutable history (the tokens-vs-rates discipline applied to
  bindings). The *recommendation* is emitted as a proposed patch: `model_role`
  on flow files + a roles-map diff to `endpoints.json` — the routing report's
  deliverable is a reviewable git commit.
- **Token costs: a results-artifact change, not a spec change.** Cost is an
  observation about a run, not a behavior of the agent. It lives in the run
  record (below); per-turn `active flow id` is what makes per-node cost
  attribution — and the routing finding — computable. A cost/turn budget
  assertion on test cases is deferred until a customer asserts on cost rather
  than reports it.
- **Tokens are measurements; prices are rates. Store them separately.** Run
  records store native token usage (input/output/cached breakdown) — immutable
  facts. Pricing lives in a separate versioned, dated rate table: queried live
  where plumbing allows (OpenRouter's models API returns pricing),
  hand-maintained otherwise, customer-supplied for self-hosted entries (else
  tokens-only reporting). Dollar figures are computed at report time as tokens
  × rate. Consequence: **a vendor price change is a study needing zero new
  runs** — recompute over the existing ledger, and "usage grew" separates
  cleanly from "vendor repriced." Comparability rule: raw token counts don't
  compare across vendors (tokenizers differ); cross-model comparison leads
  with dollars per conversation and projected cost at volume, while raw counts
  compare only within a model across runs (did the prompt edit grow the bill;
  is the new release chattier on the same suite).
- **System prompt as first class: two changes.** (a) Promote verbatim to a
  declared mode — a provenance flag, not behavior: `system_prompt.source:
  "authored" | "imported"`. Today a `system_prompt` without `{{generated}}`
  is a warned "full override"; under prompt-primacy that's the entry
  product's normal state. *Authored* = spec is master, prompt is build
  artifact; *imported* = prompt is verbatim master, spec is derived shadow.
  Governs tooling (codegen never regenerates an imported prompt; the runner
  knows the control; the viewer navigates fixes to prompt spans); the
  system-of-record handover becomes a recorded one-field flip. Agent-level,
  necessarily: it changes how codegen treats an agent-level field, and
  compile-as-pure-function-of-the-spec breaks if it lives in a sidecar; in
  multi-agent projects provenance is per-agent (one agent imported, another
  authored). Not inferrable from a missing `{{generated}}` — that conflates
  an authored full override (spec still master) with an imported prompt
  (spec is shadow): identical to codegen, opposite for reconciliation and
  the handover record.
  (b) **Extraction provenance anchors** — each flow anchored to the span /
  content-hash of the prompt region it came from, so re-extraction reconciles
  against anchors instead of re-guessing node identity. Ledger metadata, not
  behavior: a sidecar mapping file in the file model, not fields on Flow.
- **Where language renderings live: inputs vs. evidence.** Scenario *inputs*
  (persona prompts, scripted turns, descriptions) follow the scripts
  precedent — `LocalizedString` renderings inside the same artifact, so
  scenario identity stays language-invariant, with the translator CSV
  round-trip extended to `tests/`. *Golds* are per-language artifacts — a
  blessed transcript is inherently in one language; you don't translate a
  gold, you bless one per language (`language` field, linked by scenario id,
  blessed independently — which is why drift columns light up
  language-by-language). The existing case-level `language` field is the
  run-time rendering selector.
- **`model_role` ships day one; the routing feature doesn't.** The field is
  optional, additive, free, and gives extraction and the report an annotation
  target. v0 studies run whole-agent columns only — but run records collect
  per-turn tokens and node attribution from study one, so the routing report
  later computes *retroactively over the accumulated ledger*: collect early,
  sell later, re-run nothing.
- **The study artifact family (the biggest addition).** New `$schema` URIs
  beside the testing artifacts: study manifest, run record (per-turn tokens,
  latency, model, active flow id, events, verdicts), report data model. A
  manifest column is a **role→model binding**, not a bare model — whole-agent
  studies are the degenerate case where every role maps to one model — so
  entry studies and routing studies share one artifact shape and their columns
  stay comparable. The pinned triple is (system, golds, bindings). The ledger
  and report consume stable artifacts, not ad-hoc JSON. Golds gain blessing
  metadata (blessed-at; source: real transcript vs. authored) so resets are
  first-class. **The study export is the file model itself** — a flowstore
  project directory (zipped), study artifacts beside the testing artifacts,
  results under `studies/`. No second format: "export as repo" is literal,
  and the browser→kit bridge is a download, not a migration.
- **Net significance, and the no-bleed rule.** The runtime contract is
  touched by exactly two optional fields (`model_role`; the system-prompt
  mode flag) — additive, ignorable by every existing consumer. Everything
  else is sidecar artifact families, like personas and cases: large in
  surface area, zero in runtime risk. Runtime concerns land in execution
  config where they already live (judge pinning = `roles.judge`; bindings =
  the study manifest; tokens = run records). One subtlety the run-record
  design absorbs: in verbatim-prompt mode there is no runtime flow state, so
  per-node attribution is *inferred post-hoc* (turn→node mapping as a
  computed annotation with a mode/confidence flag); runner mode observes it
  natively. Same limitation class SCHEMA.md already documents for prompt-mode
  state assertions. "Execution separate from spec" survives the studies
  program intact.

## Vehicle: browser tool first, kit second, company third — open source throughout

The funnel is a ladder, in order of decreasing reach; each rung's CTA is the
next rung.

**Rung 1 — public reports** (the traction section): attention. Generated by
the tool itself on the reference fleet, published as-is; every report ends
with the hook: "Do you want to run studies like this on your own prompts and
agents? Try out this tool!"

**Rung 2 — the browser tool, the entry product.** A dead-simple standalone
surface with its own name and URL — *not* a door into the IDE: paste your
system prompt, paste an OpenRouter key, pick models (and languages), run.
Two wow beats: the graph materializes first ("we mapped your agent" — the
credibility beat), then the matrix fills in live, cell by cell, model by
model — the screen-recordable moment. The report downloads as self-contained
HTML; sharing is opt-in, and shared reports are themselves distribution.
Time-to-wow is minutes, not clone-and-configure.

Why browser + OpenRouter is load-bearing, not a detail: one key covers the
whole matrix *and* live pricing (the cost headline computes with zero setup;
direct keys optional for models OpenRouter lacks); browser-side BYO-key means
**zero infrastructure for us** — no hosted runner, no billing, no metering;
and it inherits flowstore's native security posture verbatim (the simulate
panel already issues LLM calls from the browser), so "nothing leaves your
browser" comes free — and open source makes the claim *verifiable*, which is
the hook's credibility. No accounts, no required email: the calendar ships as
a **free public feed** (JSON/RSS of releases, deprecations, price changes) —
the browser tool checks it on revisit ("3 new models since your last study"),
the Action subscribes to it, email/Slack are optional conveniences. Owning
the public deprecation calendar is itself a traction asset, and the paid
moment attaches where it belongs: auto-re-running against your held ledger
(a consent moment, not a fine-print one), not the ping. The spec stays
entirely backstage: it gives the report its coordinates; the user never sees
or authors it. "Powered by flowstore" in the footer is the only trace.

**Rung 3 — the kit and the GitHub Action: retention.** The two verbs in git,
the ledger as their repo, CI on push, and the intake the browser can't do —
live-endpoint studies and monitoring probes (CORS keeps endpoints out of the
browser). The browser tool offers "export this study as a repo" as the
bridge. Point Claude Code at it, or wire the Action. Canonicality rule: the
exported repo is the canonical ledger; browser localStorage is a cache of it.
Sharing at rungs 2–3 is the self-contained HTML file itself; a hosted public
gallery is a rung-4 good.

**Rung 4 — the company forms around what local tools cannot do.** The
irreducible hosted kernel: **the calendar** — we watch releases,
deprecations, and price changes, and re-run your suite the day they land.
That's the subscription. Around it, the other host-only goods: human graders
as a managed panel, cross-fleet baselines (your drift vs. the field — only
aggregate position enables it), SLAs and procurement. The company is the
managed calendar plus what requires aggregation — not a gatekeeper in front
of the machinery.

**Open source is the substrate, not a vehicle.** Machinery public, ops shell
private — the split the repo decision already made. Under the virality lens
it's even more clearly right: proprietary would protect exactly what isn't
the moat and forfeit launchability, contributed adapters, and the verifiable
privacy claim.

Accepted risk: the free tiers give the entry product away, and self-run
reports vary in quality. Taken knowingly — the free user is the design
partner, the model-release ping is the conversion, and the tool is
distribution.

## ICP and adoption surface

**ICP: agencies and integrators running portfolios of client agents in
production** — support, intake, collections, booking; especially multilingual
and voice. Model churn hits them once per client per release, so the need
recurs at portfolio frequency. The report is a billable client deliverable
they can resell, making every agency a channel into many agents and many
ledgers. Secondary: the in-house owner of one production agent where the LLM
bill is material. Explicitly not the ICP: conversational-AI platform vendors —
the build-it-themselves crowd, and eventual competitors.

**Adoption surface: a dead-simple browser page plus a gorgeous report.** A
URL beats a repo — paste-and-watch beats clone-and-configure — so the entry
surface is the browser tool (see Vehicle), with the kit and Action as the
retention tier for CI, endpoints, and the git ledger. Design investment goes
into the report artifact and the live-matrix moment, not an IDE surface. A
bare harness invites "I could have built this myself"; the report and the
five-minute wow are what can't be built in an afternoon. The DIY objection
gets a strategic answer, not a defensive one: a team that forks the tool has
adopted the spec format, accumulates a ledger in our file model, and still
can't watch the calendar — which is the subscription.

**Naming:** flowstore stays as the substrate/format/repo name (the ledger
makes "store" more apt, not less). The entry product gets its own
market-facing name — chosen when the kit is near-shippable, against the
concrete report masthead. Criteria: evokes the study/report/calendar, survives
being said to a CFO, never needs the word "flow" to explain.

## Build order

intake → extraction → runner → report (tables + graph overlays) → editor.
Everything before "report" is the product the buyer sees. The inspectors,
editing, and the rest of the IDE surface sit behind the report in priority.
In kit form the near-term deliverable is the study driver + report generator —
almost entirely the reuse third.

## Traction: we run regressions on random stuff — now run your own

The funnel rides the existing publication cadence — **no new content program.**
The reference fleet is the **open-source example agents**: fnol (already
public, full test suite, multilingual) plus two or three siblings (support,
collections, booking) that need building as documentation examples anyway.
Triple duty — docs examples, product test fixtures, reference fleet — with
one fleet-specific discipline: they version like instruments (deliberate
bumps, never drift) so release-day columns stay comparable.

**The model is the subject; the agent is the apparatus; the transcript is
the exhibit — never the headline.** Nobody browses transcripts from a fake
insurance agent, but everyone reads "Gemini 3.7 drops identity verification
in Spanish" about a model they run. On every release/deprecation/price
change, the tool runs on the fleet and the public unit is a handful of
**model-level findings** — each backed by exactly one curated side-by-side
pair (the eye test's most damning exhibit, ten seconds to read), rolled up by
template from the reports' headline findings, folded into the release-day
post that exists anyway. The full generated reports sit one click beneath as
evidence-and-demo — reading one is experiencing the product's output — and
every generated report ends with the canonical hook as a template feature:
*"Do you want to run studies like this on your own prompts and agents? Try
out this tool!"* Everything on both sides is open (tool, fleet, reports,
archive), so the post links them plainly — reproducibility, not promotion.
Each release adds columns to a public longitudinal ledger that compounds into
authority — and nobody owns this beat: reviewers benchmark capability, not
"will your production agent survive." (Deferred, flagged not committed:
probing *real deployed agents* via endpoint mode is the high-stakes version
of this content; ToS/ethics questions come with it.)

Launch the browser tool *on* a release day with that day's report as proof —
ride an event, don't manufacture one. The fnol dogfood milestone is the pilot
episode. The two tracks share one calendar and one run-day habit, and the
reference-agent suites are treated as frozen instruments: re-run identically
each release, transcripts archived, columns longitudinal — including how
agents behaved on models that no longer exist, a history nobody else keeps.

Posture guard, correctly scoped: the wall is **methodological and financial,
not communicational** — never model-vendor money, frozen instruments, no
leaderboard framing, reports never rank beyond their own evidence. Within
that, the research and the tool are one open toolchain and may point at each
other plainly; what would taint the science is vendor money or engineered
findings, not cross-linking free instruments.

Amplifiers:

- **Deprecation-deadline content** — "<model> retires <date>: the agent
  migration checklist" + kit. The deadline supplies the urgency; search intent
  is pre-qualified.
- **A GitHub Action** beside the Claude Code skill — "regression report on
  push" is the two-verbs loop in the tool developers already live in; CI for
  agents begs for it.
- **Agency white-label** — design partners' client-facing reports carry
  attribution; every study they sell is distribution.

Leading metric, ahead of the kill-criterion window: are reports being
*forwarded* (shares, opens by non-runners)? A report that's run but never
forwarded is a tool; a forwarded one is a product.

## Open items (de-risk in this order)

The plan above is strategy; these are the execution gaps, riskiest first.

1. **Extraction quality on arbitrary prompt blobs.** The entire intake bet
   rests on the extraction prompts producing a credible spec + graph from
   prompts we didn't author. Unproven beyond our own examples. De-risk first:
   run extraction on a handful of real third-party agent prompts and judge the
   maps before building anything else.
2. **Define v0 and the first report.** Scope: the browser tool (paste prompt
   + OpenRouter key → map → matrix → report), the report generator, pricing
   table; the kit/Action follows. Dogfood milestone: run the full study on
   the fnol example across the current model roster and publish that report —
   it is simultaneously the v0 acceptance test, the design target for the
   report, and the first marketing artifact. The bar: the real competitor is
   an afternoon of manual chats, so v0 must be near-zero-config — prompt in,
   report out, no test authoring on day one. Prompt-only intake must work
   (synthesized personas, authored golds); transcripts are the upgrade, not
   the requirement — real transcripts live inside platform dashboards, full
   of PII, and extracting them is real friction. Rule: **replay real
   conversations first, synthesize personas only for coverage** — replayed
   results are immune to "your simulated caller isn't my caller."
3. **Design partners.** Two or three agencies matching the ICP, recruited
   before the kit is polished; their agents are the second and third reports.
4. **Reconciliation design.** Named in "Two systems of record," not yet
   designed. Needed before any customer uploads a *second* system prompt — not
   before the first report.
5. **Drift metric.** The golds-as-ground-truth design says what drift is
   measured against; how distance is computed is undesigned. Premium report;
   can wait, but flag it before selling it.
6. **Judge disclosure.** Transcript-level grading uses an LLM judge, and a
   study about model choice silently graded *by* a model has a circularity
   problem a sharp customer will find. Report-design requirement: pin and
   disclose the judge model per study, publish rubrics, link every verdict to
   its spot-checkable transcript. The open-source kit is the strongest answer
   — the methodology is auditable.
7. **Success/kill criterion for the kit.** Pick the next major deprecation
   window; if nobody runs the free kit during it, the hosted business isn't
   there either — revisit the entry point before building the company.
8. **Browser run mechanics.** A matrix through one OpenRouter key in one tab
   hits rate limits, and the tab must stay open. Needed: partial results
   persisted locally (resumable runs), progressive fill (the wow is the
   *first* cells), tab-close warning, and an early spike on OpenRouter
   concurrency limits — this is what protects "five minutes" from becoming
   thirty. Extraction is on the same critical path: stream the graph as it
   parses, start the matrix while the map refines; the "does this look
   right?" correction is also the first blessing act.
9. **The incumbent declaration.** The flow must ask "which model do you run
   today?" — one required dropdown. The incumbent anchors the verbatim
   control, the golds blessed from its transcripts, and the "your current
   bill" cost baseline; the design leaned on it everywhere and captured it
   nowhere.
10. **Repo front door.** The README still leads with the Behavioral IDE. With
   ~0 installed users there is nothing to migrate and no positioning debt —
   repoint the front door when the kit ships, not before.
