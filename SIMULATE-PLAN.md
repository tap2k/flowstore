# Simulate Plan — text chat against the runner

How to wire the editor to [`uxflows-runner`](../uxflows-runner/) so a designer can talk to the spec they're authoring without setting up the voice/STT/TTS stack. Text-only, BYOK Gemini, localhost.

This is the v0.5 "text chat testing UI" that [RUNNER-PLAN.md](../uxflows-runner/RUNNER-PLAN.md) defers ("Out of scope for v0"). Bringing it forward because we don't have GCP service-account / TTS credentials locally and voice is unshippable without them.

Two repos change:
- **`uxflows-runner/`** — new text I/O adapter wrapping the existing dispatcher. Owned by a sibling Claude Code session. See "[Runner-side guidance](#runner-side-guidance-for-a-uxflows-runner-claude-code-session)" below.
- **`uxflows/`** (this repo) — new `SimulatePanel` that POSTs the live spec to the runner and streams turns. See "[Editor-side changes](#editor-side-changes-this-repo)".

The two contracts that bind them are pinned in "[Wire protocol](#wire-protocol)". Nail those first; both sides can build in parallel after.

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
- `api_key` — Google AI Studio key (NOT a service-account JSON). The runner uses it for this session only and forgets it on disconnect.
- `model` — optional; runner default if omitted.
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

## Runner-side guidance (for a `uxflows-runner` Claude Code session)

Hand this section to the runner-repo Claude. The editor team is working from "[Editor-side changes](#editor-side-changes-this-repo)" in parallel against the contract above.

### What you're building

A text I/O adapter for the existing dispatcher. Same `Session`, same `routing.plan`/`resolve`, same assigns/capabilities/event emission. Just no Pipecat audio pipeline — instead, you make a direct LLM call per turn using the user's BYOK Gemini API key.

You are NOT adding canvas-highlighting SSE or persistence. Just the two endpoints in "[Wire protocol](#wire-protocol)" above (plus `/api/chat/end`).

### Critical context to read first

In order:
1. `RUNNER-PLAN.md` §"One LLM call per turn", §"Pipecat wiring", §"Out of scope for v0" (the v0.5 text-chat bullet) — this is the deferred work landing now.
2. `src/uxflows_runner/dispatcher/processor.py` — the *whole file*. The text adapter has to do what `PreLLMPlanner` + tool handlers + `PostLLMResolver` do today, but driven from a plain `await llm.generate(...)` call instead of frame events.
3. `src/uxflows_runner/dispatcher/session.py`, `routing.py`, `assigns.py`, `prompt_builder.py` — these are framework-agnostic and you reuse them as-is.
4. `src/uxflows_runner/server/app.py` — where the new endpoints land.

### The architectural question to resolve before coding

`Session` requires an `LLMContext` (Pipecat type). Tool handlers are registered on `LLMService` (Pipecat). You have two paths:

**Path A — keep Pipecat's `LLMContext` and `GoogleVertexLLMService`, drive it without a pipeline.** Construct `LLMContext` standalone (it's mostly a list of message dicts). Construct `GoogleVertexLLMService` configured with the BYOK key. Call its inference method directly per turn. Tool callbacks still fire through `register_function` → your existing handlers in `processor.py` work unchanged.

  - **Pro:** maximum code reuse. The handlers in `processor.py` work as-is. Decision precedence, follow-up `LLMRunFrame` for interrupts, the `tool_handler_fired_this_turn` flag, the `PostLLMResolver` backstop logic — all reusable.
  - **Con:** Pipecat's `GoogleVertexLLMService` is built for service-account auth and pipeline frame ingress. Driving it standalone with an API key may require monkey-patching or constructing it in an unsupported way. Probe this first — spend an hour with `scripts/probe_text_mode.py` exercising the constructor + a single inference call before committing.

**Path B — bypass Pipecat for text, call `google-generativeai` directly.** Build a tiny `text_dispatch.py` that:
  - Takes the message history, system prompt, and `ToolsSchema` from `prompt_builder.build_tools(plan)`.
  - Translates the `ToolsSchema` to Gemini's native `tool_config` / `function_declarations` format. (Pipecat's adapter does this in `pipecat/services/google/llm.py`; you can lift the translation logic.)
  - Calls `google.generativeai.GenerativeModel(...).generate_content_async(...)` with `tool_config={"function_calling_config": {"mode": "AUTO"}}`.
  - Walks `candidate.content.parts` (parts ordering not guaranteed — see RUNNER-PLAN §"Gemini tool-call shape") to collect text + function calls.
  - Calls into `routing.resolve()` directly with the collected tool args, skipping Pipecat's `register_function` machinery entirely. Reimplement the `_apply_decision`-equivalent logic in plain Python (it's ~80 LOC in `processor.py`).

  - **Pro:** clean, no Pipecat surface area in the text path. Text mode and voice mode share *only* the dispatcher core (which is the right boundary per RUNNER-PLAN §"Dispatcher must stay framework-agnostic").
  - **Con:** duplicates the decision-application logic from `processor.py` (`_do_take_exit`, `_do_trigger_interrupt`, `_do_return_to_caller`, the follow-up `LLMRunFrame` equivalent which becomes a second `generate_content_async` call). ~150-200 LOC of new code. Risk of drift between the two paths' event emission and state mutation.

**Default to Path A.** Reasoning: the two paths' decision logic *must* stay identical or you'll get spec behavior that differs between sim and prod, which is exactly what RUNNER-PLAN §"Why a runner at all" set out to avoid. A is more invasive to Pipecat's surface but keeps one source of truth. Spend the probe budget *first* — if `GoogleVertexLLMService` genuinely cannot be driven standalone with an API key, fall back to B and pay the duplication tax with eyes open.

A third path nobody should pick: refactor the existing handlers to take an injected `apply_decision` function, then call them from both contexts. Sounds clean, ends up being a maze. The handlers are tightly coupled to `FunctionCallParams` and `result_callback`. Don't.

### Suggested module layout

```
src/uxflows_runner/server/
  text_session.py    # NEW. The TextSession class — see below.
  app.py             # MODIFIED. Three new endpoints.
```

**Why not put text_session under `dispatcher/`?** It's an I/O adapter — same layer as `processor.py` (Pipecat) and `pipeline.py`. The dispatcher core stays framework-agnostic; adapters live next to the server.

### `TextSession` — the per-session object

```python
class TextSession:
    """Text adapter wrapping a dispatcher Session.

    One per /api/chat/session call. Lives in an in-memory registry keyed by
    session_id. GC'd by an idle timer (no activity for 30 min → drop).
    """

    session: Session                      # the existing dispatcher Session
    llm: LLMService                       # Path A: GoogleVertexLLMService configured with BYOK key
                                          # Path B: a thin wrapper over google.generativeai
    event_buffer: list[Event]             # events emitted since last drain
    last_active_at: datetime
    ended: bool

    @classmethod
    async def start(cls, spec, api_key, model, language) -> tuple["TextSession", str]:
        """Construct, run session_started + flow_entered, run the opening
        agent turn if chatbot_initiates. Returns (self, opening_agent_text)."""

    async def turn(self, user_text: str) -> str:
        """Append user_text to context, run one inference, resolve tool calls,
        apply decisions, fire follow-up if needed (interrupts), return
        agent_text. Drains event_buffer to caller via drain_events()."""

    def drain_events(self) -> list[Event]:
        """Return + clear the buffered events."""

    async def end(self) -> None:
        """Idempotent. Emit session_ended if not already ended."""
```

Use a `BufferingEventEmitter` (new — sibling to `LoggingEventEmitter` in `events/emitter.py`) that appends to a list. `TextSession.drain_events()` swaps in a fresh list and returns the old one.

### The session registry

```python
# In server/app.py or a new server/text_registry.py
_sessions: dict[str, TextSession] = {}

async def cleanup_idle_sessions():
    """Run every 5 min via FastAPI startup task. Drop sessions inactive >30 min."""
```

Single-process, in-memory. Single-user localhost is the deployment model — no Redis, no DB. If concurrency between turns matters (it shouldn't with one tab), wrap each session's `turn()` in an `asyncio.Lock`.

### Gemini call mechanics (Path A specifics)

Even with Path A, `GoogleVertexLLMService` was built for service-account / Vertex auth. For BYOK AI Studio keys, you likely want `GoogleLLMService` instead (or the service-account-free path of whichever class supports `api_key=...`). Probe the constructor signatures in `pipecat/services/google/llm.py` to confirm.

If neither Pipecat class accepts a plain API key cleanly, that's the signal to fall back to Path B — but document the discovery in RUNNER-PLAN's "Phase 1.5 — text adapter" section so the next person doesn't repeat the probe.

### The follow-up inference for interrupts (Path A)

Today `processor.py` pushes `LLMRunFrame()` after `trigger_interrupt` / `return_to_caller` to coax Gemini into producing text. In text mode there's no frame pipeline — you just call the LLM a second time within the same `turn()`, with the new flow's prompt + tools already loaded into the context. Same logic, no frame.

For Path B, this is just a second `generate_content_async` call. Same cost characteristics noted in RUNNER-PLAN §"Live-test follow-up".

### Walkaway gap

Documented in RUNNER-PLAN §"Live-test follow-up". Not yours to fix. If a session "ends" in spec-terms but the LLM didn't fire `take_exit_path`, `ended` stays `false`; the user can keep typing; eventually they'll drop the tab. That's acceptable for v0.5.

### Tests

- Wire up an end-to-end test: load `examples/coffee.json`, start a session, send 3-4 turns through the happy path, assert `agent_text` is non-empty and the right events fire (`flow_entered`, `exit_path_taken`, `variable_set`).
- Mock the LLM call (Path A: stub `LLMService.run_function_calls` invocation; Path B: stub `generate_content_async`) so the test doesn't need network. Existing tests in `tests/test_routing.py` etc. show the mocking style.
- Don't add a separate "text-mode dispatcher" test suite. The dispatcher tests (already 80 passing) cover the cognitive layer; new tests just exercise the text wiring.

### What to update in `RUNNER-PLAN.md`

After shipping, add a "Phase 1.5 — text adapter" section between Phase 1 and Phase 2 in §"Work chunks". Note the path you took (A vs B), why, and any Gemini-API-key surprises. Move the v0.5 text-chat bullet from §"Out of scope" into the new phase.

### What NOT to do

- **Do not** add SSE / WebSocket. Request/response only.
- **Do not** persist sessions to disk. In-memory dict.
- **Do not** add a `/api/chat/list_sessions` or any introspection endpoint — single user, single tab, you don't need it.
- **Do not** try to share the `LLMContext` between voice and text in the same session. They're separate sessions even if they happen to load the same spec.
- **Do not** generalize the BYOK plumbing yet. One provider (Google), one auth model (API key). Multi-provider is a separate ask.

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

Hide the Simulate button when no spec is loaded (existing pattern: the Chat button hides when there's no API key — apply the same gate plus "spec exists").

### Settings

The runner uses the same Google API key the chat panel already uses (`useSettingsStore.googleApiKey`). No new settings field. Note in the empty-state copy that the key is sent to your local runner, not Google directly, and that the runner forgets it on disconnect.

### What about model selection?

Reuse `useSettingsStore.googleModel`. Same model both for spec authoring and simulation. Fine for v0.5; if "I want to author with Pro and simulate with Flash" emerges as a real need, split it.

### Validation before send

Before `start()`: run `validateSpec(spec)` (existing). If invalid, show errors in the panel and refuse to start. The runner will reject invalid specs with 400 anyway, but failing fast in-editor is a better UX.

---

## Open questions

These should be resolved before or during implementation, not after:

1. **Does `GoogleVertexLLMService` (or `GoogleLLMService`) accept a plain AI Studio API key?** This decides Path A vs B for the runner. Probe before code.
2. **Where do capability HTTP calls go in text mode?** Same `execution.json` as voice mode? The dispatcher's `CapabilityDispatcher` is shared — yes, same. But: in text mode the editor is the spec source, and `execution.json` lives on the runner's filesystem. Designers iterating on a spec in the editor can't easily edit `execution.json` on the runner. Punt: capabilities can return whatever the configured endpoints return, or no-op if unconfigured. Don't try to plumb editor → runner capability config in v0.5.
3. **What's the runner URL discovery story?** Hardcode `localhost:8000` in `textClient.ts`. RUNNER-PLAN §"Open questions" already acknowledges this is the v0 stance. If the runner port changes, change the constant. Setting comes later.
4. **CORS for editor → runner.** The runner already has wide-open CORS in `app.py` (`allow_origins=["*"]`). No change needed.
5. **What if the runner isn't running?** `fetch()` throws `TypeError: Failed to fetch` (Chrome) / similar (Firefox). Show "Runner unreachable at localhost:8000 — start it with `cd ../uxflows-runner && uv run uxflows-runner serve`" in the error state. Don't try to detect-and-launch.

---

## Acceptance bar

A designer with `uv run uxflows-runner serve` going in another terminal:
1. Loads `public/example.json` in the editor.
2. Pastes their Google AI Studio key into Settings.
3. Clicks Simulate.
4. Sees the agent's opening turn appear within ~3s.
5. Types a few turns, gets coherent replies that follow the spec's flows.
6. Sees `flow_entered` / `exit_path_taken` annotations under turns where transitions happened.
7. Clicks Reset, gets a fresh session against the same spec without reload.

A designer without the runner running:
1. Clicks Simulate, gets the "Runner unreachable" message with the run command.

The walkaway-gap rough edge from RUNNER-PLAN §"Live-test follow-up" still applies — if the spec ends with a graceful goodbye that Gemini treats as text-only, the session won't auto-end. Acceptable; document in the panel's Reset hover ("ends the current session, even if the agent didn't").
