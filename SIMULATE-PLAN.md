# Simulate Plan — text chat against the runner

How to wire the editor to [`uxflows-runner`](../uxflows-runner/) so a designer can talk to the spec they're authoring without setting up the voice/STT/TTS stack. Text-only, BYOK Gemini (or env-fallback), localhost.

Originally the v0.5 "text chat testing UI" that [RUNNER-PLAN.md](../uxflows-runner/RUNNER-PLAN.md) deferred ("Out of scope for v0"). Brought forward because we don't have GCP service-account / TTS credentials universally available and voice is unshippable without them.

**Status (2026-05-04):**
- ✅ **Runner side shipped** as [Phase 1.5](../uxflows-runner/RUNNER-PLAN.md#phase-15--text-io-adapter--shipped-2026-05-04). Endpoints live at `localhost:8000/api/chat/{session,turn,end}`. A standalone debug page exists at `localhost:8000/text.html` for headless testing without the editor.
- 🟡 **Editor side pending** — see "[Editor-side changes](#editor-side-changes-this-repo)" below.

The two contracts that bind them are pinned in "[Wire protocol](#wire-protocol)" — that section is the live API contract; the runner already implements it.

---

## What "simulate" means here

A designer working in the canvas clicks **Simulate**. A side panel opens. They type as the user; the runner runs the spec's dispatcher (same code path as voice — `PreLLMPlanner`, tool handlers, `PostLLMResolver`, `Session`) and returns the agent's reply. Per turn, the panel also receives the events the dispatcher emitted — `flow_entered`, `exit_path_taken`, `variable_set`, etc. — for transcript annotation today and canvas highlighting later (Phase 2 of RUNNER-PLAN, deferred again here).

Out of scope for *this* plan:
- Canvas highlighting from runtime events. The events arrive; the panel can show them; the canvas reads nothing yet. That's a follow-up.
- Voice. Same `/api/offer` path stays untouched.
- Any persistence of sessions across page reloads.
- Multi-tab / multi-user. Single localhost runner, one active session at a time per tab.

In scope:
- BYOK key flows from the editor → runner per session. Runner never persists it.
- The full v0 schema surface the dispatcher already supports (interrupts, max_turns, capabilities — all of it). Capabilities still POST to whatever HTTP endpoints `execution.json` configures; that's a runner concern.
- A "Reset" button that ends the session and starts a new one (same spec, fresh state). Mid-session spec edits do **not** hot-reload — RUNNER-PLAN's "spec is read at run start, immutable per session" rule holds.

---

## Wire protocol

Two endpoints, JSON over HTTP. Keep it dumb.

### `POST /api/chat/session`

Start a session. Returns a session id + the agent's opening turn (if `chatbot_initiates: true`) along with the events fired during start (always at minimum a `session_started` and a `flow_entered`).

**Request:**
```json
{
  "spec": { /* full v0 spec JSON */ },
  "api_key": "AIza...",
  "model": "gemini-2.5-flash",
  "language": "es-MX"
}
```
- `spec` — optional. If omitted, the runner falls back to its env-default spec (`UXFLOWS_SPEC_PATH`). The editor always sends one.
- `api_key` — **optional**. Google AI Studio key (NOT a service-account JSON). The runner uses it for this session only and forgets it on disconnect. **If omitted**, the runner falls back to its env service-account credentials (Vertex) — same auth voice mode uses. So designers without an AI Studio key can still simulate locally if the runner has GCP creds; designers without GCP creds can BYOK to use AI Studio's free tier.
- `model` — optional; runner default if omitted (`gemini-2.5-flash` for AI Studio, `UXFLOWS_LLM_MODEL` for Vertex fallback).
- `language` — optional; falls back to `agent.meta.languages[0]`.

**Response:**
```json
{
  "session_id": "abc123",
  "agent_text": "Hola, ¿en qué puedo ayudarte?",
  "events": [ /* Event[] */ ],
  "ended": false
}
```
- `agent_text` — empty string if `chatbot_initiates: false`.
- `events` — every event fired during session start, in order.
- `ended` — `true` if the session ended during start (rare but possible: `chatbot_initiates: true` + entry flow has an unconditional terminal `direct` exit).

**Errors:** `400` on invalid spec (return the first 3 pydantic errors). `401` on bad API key (surfaces from Gemini call only — for `chatbot_initiates: false` the call is deferred to first turn, so this is an empty success).

### `POST /api/chat/turn`

Send a user turn, get the agent's reply.

**Request:**
```json
{
  "session_id": "abc123",
  "user_text": "Quiero un café"
}
```

**Response:**
```json
{
  "agent_text": "¡Claro! ¿Qué tamaño?",
  "events": [ /* Event[] fired during this turn */ ],
  "ended": false
}
```
- `ended: true` when a terminal exit fired this turn (`session_ended` will be present in `events`).

**Errors:** `404` on unknown `session_id`. `409` if the session has already ended (panel should disable input).

### `POST /api/chat/end` *(optional, nice to have)*

Tear down a session early. Returns `{ "ok": true }`. The runner GC's idle sessions after some timeout regardless; this is for the explicit-stop case.

### Event shape

Mirror [`uxflows-runner/src/uxflows_runner/events/schema.py`](../uxflows-runner/src/uxflows_runner/events/schema.py) verbatim. The TS mirror lives at `lib/runtime/eventTypes.ts` (created by this work — the file RUNNER-PLAN Phase 2 was going to add).

### Why request/response, not WebSocket or SSE

- **One LLM call per turn** is the dispatcher's invariant. Each turn is request/response by design — no streaming intermediate state.
- A WebSocket adds reconnect logic, ping/pong, frame parsing, all for no win.
- SSE would matter if we wanted to push background events (capability returns) — we don't, in v0.5.
- If/when canvas highlighting needs out-of-band events, swap `/api/chat/turn` to also return long-running cap results, or add SSE later. Not now.

---

## Runner-side — shipped (Phase 1.5, 2026-05-04)

The runner-side work landed. Editor side reads the contract in [§"Wire protocol"](#wire-protocol) and ignores the rest of this section unless debugging.

### What's live in [`uxflows-runner/`](../uxflows-runner/)

- **Endpoints** at `localhost:8000`: `POST /api/chat/session`, `POST /api/chat/turn`, `POST /api/chat/end`. Implemented in [`src/uxflows_runner/server/app.py`](../uxflows-runner/src/uxflows_runner/server/app.py).
- **`TextSession`** ([`server/text_session.py`](../uxflows-runner/src/uxflows_runner/server/text_session.py)) — per-session adapter wrapping the existing dispatcher `Session`. Constructs `LLMContext` and Pipecat's LLM service standalone (no pipeline). Per turn: one `generate_content` call, parses text + function_calls from response parts, dispatches via `apply_tool_call`, runs a follow-up inference inline for `trigger_interrupt`/`return_to_caller` (the same Gemini quirk voice mode handles via `LLMRunFrame`).
- **`TextSessionRegistry`** ([`server/text_registry.py`](../uxflows-runner/src/uxflows_runner/server/text_registry.py)) — in-memory dict keyed by `session_id`, idle GC sweeper drops sessions inactive >30 min.
- **Refactor**: extracted [`apply_tool_call(session, tool_name, args) → Decision`](../uxflows-runner/src/uxflows_runner/dispatcher/processor.py) from the Pipecat tool handlers in `processor.py`. Voice handlers are now 3-line wrappers around it. Text mode calls it directly. Voice behavior is byte-identical (existing tests still pass).
- **`BufferingEventEmitter`** ([`events/emitter.py`](../uxflows-runner/src/uxflows_runner/events/emitter.py)) — sibling to `LoggingEventEmitter`/`QueueEventEmitter`. `TextSession.drain_events()` returns and clears the buffer, so the JSON response carries events inline.
- **Standalone debug page** at `localhost:8000/text.html` ([`web/text.html`](../uxflows-runner/web/text.html) + `text.js` + `text.css`). Mirrors the voice page (`/`) and the bare-audio debug page (`/audio-test.html`). Useful for headless testing of the runner without the editor.
- **Tests** at [`tests/test_text_session.py`](../uxflows-runner/tests/test_text_session.py) — 6 e2e tests with mocked `_run_inference` against `examples/coffee.json` (opening turn, take_exit_path with assigns, plain reply, terminal exit, idempotent end, context-history shape). 86/86 total passing.

### Key decisions resolved during shipping

- **Path A confirmed.** `GoogleLLMService` (the AI Studio variant, not Vertex) accepts a plain `api_key` in its constructor; `LLMContext` constructs standalone with no pipeline plumbing. Both probed in [`scripts/probe_text_mode.py`](../uxflows-runner/scripts/probe_text_mode.py) before any code. The Gemini adapter's `get_llm_invocation_params(context)` does the full `ToolsSchema → function_declarations` translation for free, so text mode shares Pipecat's tool-format conversion with voice mode unchanged. **No Path B fallback needed.**
- **`api_key` is optional in the request.** If provided → `GoogleLLMService` (BYOK AI Studio). If omitted → `GoogleVertexLLMService` against env service-account credentials (same auth voice mode uses). So local dev needs zero new credentials when the runner has GCP creds; the editor's BYOK flow works for designers without them. This is a strict superset of the original SIMULATE-PLAN contract — adding `api_key` always works, and omitting it just means "use the runner's defaults."
- **`apply_tool_call` is the framework-agnostic seam.** Voice handlers wrap it with Pipecat's `result_callback` + `LLMRunFrame` follow-up; text mode calls it directly with a second `generate_content_async` for the follow-up. **Both modes share the dispatch logic; only the I/O wiring differs.** Made the dispatcher's framework-agnostic boundary concrete.

### Known runner-side limitations

- **Walkaway gap** carried over from voice — Gemini sometimes responds to a graceful goodbye with text only and no `take_exit_path`, leaving the session "live" until idle GC. Same trade-off as voice; not text-specific. The Reset button in the editor handles this in practice.
- **Sometimes-silent take_exit turns** — observed live: a clean tool call (e.g. routing into `flow_coffee_order`) can come back with `agent_text == ""`. The state mutation is correct; the model just decided the routing is itself the response. Not a bug introduced by Phase 1.5; same Gemini behavior the voice path lives with. Mostly the *next* turn fills in any silence.
- **No SSE / streaming** — turn endpoint is request/response by design (one LLM call per turn). When the editor wants out-of-band capability returns later, this becomes the natural place to add SSE.

### Whatsupp2 integration deliberately not built

The runner's sessioned shape doesn't match `callAgent`'s stateless contract; making it work needs a session-aware `callAgent` in whatsupp2, not a stateless shim in the runner (which would silently drift on any spec with assigns/transitions). See [§"Future: whatsupp2 integration"](#future-whatsupp2-integration) below for the full reasoning. The runner endpoints above are what whatsupp2 will eventually call when that work lands; no runner-side change needed.

---

## Editor-side changes (this repo)

### File map (additive — nothing existing changes structurally)

```
components/runtime/
  SimulatePanel.tsx         # NEW. Text chat UI.
lib/runtime/
  eventTypes.ts             # NEW. TS mirror of runner's Event union.
  textClient.ts             # NEW. fetch() wrappers for /api/chat/*.
lib/store/
  simulate.ts               # NEW. zustand slice: session_id, transcript, events, status.
pages/index.tsx             # MODIFIED. Mount SimulatePanel + a "Simulate" button next to "Chat".
```

The existing `components/chat/ChatPanel.tsx` is a *spec authoring* chat. Don't repurpose it; sit `SimulatePanel` as a sibling. Same visual treatment (right-side panel, ~380px wide, toggle button bottom of the canvas area).

### Module discipline

Per RUNNER-PLAN §"Editor-side module boundaries":
- All runtime/simulate code lives under `components/runtime/` and `lib/runtime/` + `lib/store/simulate.ts`. Nothing leaks into `lib/schema/`, `lib/store/spec.ts` (other than reading the spec), `components/inspector/`, `components/sheets/`.
- One-way dependency: simulate code reads spec state; spec/authoring code never imports from `lib/runtime/*`.
- The canvas does not change in this work. Canvas highlighting is a follow-up that will read the events from `lib/store/simulate.ts`.

### `lib/runtime/textClient.ts`

Plain `fetch()`. No retry, no reconnect — request/response with localhost can fail loudly. Surface errors to the panel.

```ts
const RUNNER_BASE = "http://localhost:8000";

export interface RuntimeEvent { /* mirror of events/schema.py */ }

export interface StartSessionResponse {
  session_id: string;
  agent_text: string;
  events: RuntimeEvent[];
  ended: boolean;
}

export interface TurnResponse {
  agent_text: string;
  events: RuntimeEvent[];
  ended: boolean;
}

export async function startSession(args: {
  spec: Spec;
  apiKey: string;
  model: string;
  language?: string;
}): Promise<StartSessionResponse> { /* POST /api/chat/session */ }

export async function sendTurn(args: {
  sessionId: string;
  userText: string;
}): Promise<TurnResponse> { /* POST /api/chat/turn */ }

export async function endSession(sessionId: string): Promise<void> {
  /* POST /api/chat/end, swallow errors */
}
```

### `lib/store/simulate.ts`

```ts
type Status = "idle" | "starting" | "ready" | "thinking" | "ended" | "error";

interface SimulateState {
  sessionId: string | null;
  status: Status;
  transcript: Array<{ role: "agent" | "user"; text: string; ts: number }>;
  events: RuntimeEvent[];                 // append-only, in arrival order
  currentFlowId: string | null;           // last flow_entered's flow_id
  variables: Record<string, unknown>;     // last value per variable_name
  error: string | null;

  start: (spec: Spec, apiKey: string, model: string, language?: string) => Promise<void>;
  send: (userText: string) => Promise<void>;
  reset: () => Promise<void>;
}
```

`start` snapshots `useSpecStore.getState().spec` and POSTs it. The simulate store does NOT subscribe to spec changes — once started, the runner has its frozen copy and the editor's spec stays editable (RUNNER-PLAN §"Snapshot-on-run"). A "spec edited since session started" indicator can come later.

Reducers: each event in the response mutates the store (`flow_entered` → `currentFlowId`, `variable_set` → `variables[name] = value`, `session_ended` → `status = "ended"`).

### `components/runtime/SimulatePanel.tsx`

Mostly mirrors `ChatPanel.tsx`'s layout (transcript scroll area + textarea + send button). Differences:

- Header: "Simulate · {agent.meta.name} · {currentFlowId ?? '–'}". Subtitle shows status ("ready", "thinking…", "ended", error message).
- Empty state: "Start a session to talk to your spec." + a Start button. Disabled if no API key (link to Settings) or no spec loaded.
- After Start: transcript shows agent opener if any, then user/agent bubbles alternating. Events appear inline as faint annotation rows under the turn that produced them — same monofont treatment as `ChatPanel.tsx`'s tool-call rows.
  - Format: `→ flow_entered(flow_order_coffee)` / `→ variable_set(drink_type = "latte", llm)` / `→ exit_path_taken(xp_greet → flow_order_coffee, llm)`.
  - Truncate long values; full event JSON on click (`<details>` element is fine).
- Footer: textarea + Send (⌘↵). Once `status === "ended"`, replace footer with "Session ended · [Reset]".
- Reset button always visible in header next to Close. Calls `simulate.reset()` → `endSession()` then a fresh `start()` with the *current* spec snapshot.

### `pages/index.tsx` changes

Two button slots in the canvas overlay area (top-right corner today holds the Chat button):
- Existing "Chat" button → unchanged.
- New "Simulate" button → opens `SimulatePanel`.

The two panels can be open simultaneously (Chat on the right of the canvas, Simulate further right) or stacked — pick stacked-then-replace if width gets cramped. Don't over-design this; ship side-by-side, see how it feels.

Hide the Simulate button when no spec is loaded. Unlike the Chat button, **don't** gate Simulate on the API key being present — the runner accepts an empty key and falls back to its env credentials. Just gate on "spec exists."

### Settings

The runner accepts the same Google API key the chat panel already uses (`useSettingsStore.googleApiKey`). No new settings field. **Send the key when present, omit when not** — the runner falls back to its own env service-account credentials. The empty-state copy should note both:
- "Paste your AI Studio key in Settings to use your own quota, or leave it blank — the runner will use its local Google Cloud credentials if it has them configured."
- "Either way, the key is sent only to your local runner, never to Google directly. The runner forgets it on disconnect."

### What about model selection?

Reuse `useSettingsStore.googleModel`. Same model both for spec authoring and simulation. Fine for v0.5; if "I want to author with Pro and simulate with Flash" emerges as a real need, split it.

### Validation before send

Before `start()`: run `validateSpec(spec)` (existing). If invalid, show errors in the panel and refuse to start. The runner will reject invalid specs with 400 anyway, but failing fast in-editor is a better UX.

---

## Open questions

Mostly resolved during runner-side shipping; remaining ones are editor-side calls.

1. ~~**Does `GoogleVertexLLMService` (or `GoogleLLMService`) accept a plain AI Studio API key?**~~ ✅ Resolved during the probe — `GoogleLLMService` accepts `api_key=` cleanly, and the runner ships Path A. Editor doesn't need to think about this.
2. **Where do capability HTTP calls go in text mode?** Same `execution.json` as voice mode — the runner's `CapabilityDispatcher` is shared. In text mode the editor is the spec source but `execution.json` lives on the runner's filesystem; designers iterating on a spec in the editor can't easily edit it. Punt for v0.5: capabilities return whatever the configured endpoints return, or no-op if unconfigured. Don't try to plumb editor → runner capability config yet.
3. **What's the runner URL discovery story?** Hardcode `localhost:8000` in `textClient.ts`. RUNNER-PLAN §"Open questions" already acknowledges this is the v0 stance. If the runner port changes, change the constant. Setting comes later.
4. **CORS for editor → runner.** The runner already has wide-open CORS in `app.py` (`allow_origins=["*"]`). No change needed.
5. **What if the runner isn't running?** `fetch()` throws `TypeError: Failed to fetch` (Chrome) / similar (Firefox). Show "Runner unreachable at localhost:8000 — start it with `cd ../uxflows-runner && uv run uxflows-runner serve`" in the error state. Don't try to detect-and-launch.
6. **Do designers need to enter an API key, or use the runner's env credentials?** The runner accepts both: `api_key` is now optional in `/api/chat/session`. Editor can keep the BYOK flow (preferred — designer's own quota, no shared infra) but fall back gracefully if the field is empty: pass nothing, let the runner's env auth handle it. The empty-state copy should mention both modes ("paste your AI Studio key, or leave blank to use the runner's local credentials").

---

## Acceptance bar

A designer with `uv run uxflows-runner serve` going in another terminal:
1. Loads `public/example.json` in the editor.
2. Pastes their Google AI Studio key into Settings — or leaves it blank if the runner has GCP env credentials.
3. Clicks Simulate.
4. Sees the agent's opening turn appear within ~3s.
5. Types a few turns, gets coherent replies that follow the spec's flows.
6. Sees `flow_entered` / `exit_path_taken` annotations under turns where transitions happened.
7. Clicks Reset, gets a fresh session against the same spec without reload.

A designer without the runner running:
1. Clicks Simulate, gets the "Runner unreachable" message with the run command.

The walkaway-gap rough edge from RUNNER-PLAN §"Live-test follow-up" still applies — if the spec ends with a graceful goodbye that Gemini treats as text-only, the session won't auto-end. Acceptable; document in the panel's Reset hover ("ends the current session, even if the agent didn't").

---

## Future: whatsupp2 integration

The endpoints SIMULATE-PLAN ships (`/api/chat/session` + `/api/chat/turn`) are *also* the API whatsupp2's agent-testing loop will eventually call when the runner becomes the canonical "agent under test." This section documents that intent and — more importantly — why it's **not** blocking work for SIMULATE-PLAN, and why no compatibility shim should be added on the runner side to make it look closer.

### The shape mismatch

[`whatsupp2/hooks/simulate.js`](../whatsupp2/hooks/simulate.js)'s [`callAgent({agentConfig, messages, persona, apiKeys})`](../whatsupp2/hooks/simulate.js#L63) is **stateless** — every call ships the full transcript and gets `{content}` back. The function is pure of session state; the transcript IS the conversation. That's what every external agent endpoint looks like (OpenAI's API, anyone's chatbot endpoint), and it's the contract `execution.endpoint` was designed for ([`AGENT-CLAUDE.md` L42-43](../whatsupp2/AGENT-CLAUDE.md)).

The runner's dispatcher is **stateful by design**. The flow stack, variable bag, and interrupt context are not derivable from the transcript:

- "yes" on turn N can be a routing answer or an interrupt response — the state machine knows which, the transcript doesn't.
- A `variable_set` may fire on turn 5's exit even though the user said the captured value on turn 1.
- An interrupt push/pop looks like a digression in text but is structurally distinct in state.

So a "stateless turn endpoint that re-runs the dispatcher each call from the transcript" is **semantically broken** for any non-trivial spec — same input, different routing, different assigns, sometimes different replies than the sessioned path. This would silently produce sim/prod drift, which is exactly what [RUNNER-PLAN §"Why a runner at all"](../uxflows-runner/RUNNER-PLAN.md#why-a-runner-at-all) exists to prevent. **Do not add such an endpoint to the runner**, even when asked, even with a docstring warning. The compatibility cost shows up later as evaluation findings nobody can reproduce.

### Where the move has to happen

To wire whatsupp2 cleanly, **`callAgent` evolves to be session-aware** — not the runner reshaping itself to look stateless:

- At conversation start, call `/api/chat/session` once with the snapshot spec from `config_snapshot.spec` and the BYOK key from `apiKeys.google`. Stash `session_id` on `interview.metadata.runner_session_id` (or a dedicated column).
- Per turn, call `/api/chat/turn { session_id, user_text }` and read `agent_text` + `events`.
- On `ended: true`, drop the session id; the run loop terminates.
- The `events` stream is upside — extend the evaluator to consume `exit_path_taken` / `variable_set` / `capability_invoked` once whatsupp2 cares (the [AGENT-CLAUDE.md "Pending"](../whatsupp2/AGENT-CLAUDE.md#pending) "Capability invocation evaluation" item is exactly this).

This is a real contract change in whatsupp2, not a wrapper:
- `callAgent`'s signature gains DB access (`interviewId`, `supabase`) to read/write the session id.
- Four call sites change ([`hooks/simulate.js:117, 487, 837`](../whatsupp2/hooks/simulate.js); [`pages/api/callagent.js:25`](../whatsupp2/pages/api/callagent.js)).
- The stateless [`pages/api/callagent.js`](../whatsupp2/pages/api/callagent.js) Chat tab — which has nowhere to persist a session id — either grows ad-hoc per-request session creation (cheap, throwaway) or stays on the existing system-prompt path (`execution.endpoint` empty). Both work.
- New failure modes: session expiry mid-run, runner restarts, `interview_id` reuse.

Estimated half-day in whatsupp2, not catastrophic — but **a whatsupp2-side decision driven by a whatsupp2-side need.**

### Disposition for SIMULATE-PLAN

- ✅ The runner ships the right endpoints.
- ❌ The runner does **not** ship a stateless compatibility endpoint.
- 🔜 The integration lands when whatsupp2 prioritizes session-aware `callAgent`. Tracked there, not blocking here.

When that work starts, the runner side should need zero changes — the endpoints in [§"Wire protocol"](#wire-protocol) above are already the API whatsupp2 will call.
