# Runtime Translation Tables

Mappings from the uxflows behavioral spec to each supported runtime. These document how the schema maps to each runtime so that Phase 2 export work can be scoped accurately. **None of them ship in the MVP.** Today's only export target is the system-prompt codegen at [`packages/core/src/codegen/promptGenerator.ts`](./packages/core/src/codegen/promptGenerator.ts) (a monolithic prompt for non-runner runtimes); the tables below inform future targets in the same `packages/core/src/codegen/` pipeline.

For the schema these reference, see [SCHEMA.md](./SCHEMA.md). The strategic question of whether translation preserves enough behavioral fidelity to justify investment is being validated via a bounded LangGraph spike — see [TRANSLATION-POC.md](./TRANSLATION-POC.md).

## Export Targets

Targets fall into three structural classes. The **generic config bundle** emits a portable artifact (composed system prompt + JSON tool schemas + behavioral sidecar) consumable by any LLM agent platform that accepts prompt + tool definitions; lossy by design but covers a long tail of platforms at near-zero translator cost. **Graph-native runtimes** (Pipecat, LangGraph, Dialogflow CX) translate uxflows flows directly to nodes and exit_paths to edges; the spec's structure is preserved and enforced at runtime. **Instruction-and-tool runtimes** (LiveKit, OpenAI Agents SDK) emit framework-specific code that composes the entire spec into a single agent's instructions; flow boundaries become prose ordering and exit-path conditions become routing guidance. All three work; the choice affects how much of uxflows's authored structure survives as enforced runtime structure versus prose hints. Author for behavioral seams; accept that not all targets enforce them equivalently.

**Shared concern across graph-native targets: chatty boundaries.** At a flow boundary, the architectural question is "who speaks this turn — source, destination, or both?" The monolithic system-prompt path sidesteps it (one LLM call sees every flow). Graph-native targets need an explicit answer, and the *right* answer matters for both correctness and naturalness when the destination is **terminator-shaped** (a closer / confirmation flow whose script is the meaningful content of the transition turn — Tala's `commit_to_pay_close`, `partial_commitment_close`, etc.).

Three possibilities:

| | Source's turn says | Destination's turn says | LLM calls | Behavior |
|---|---|---|---|---|
| **A** | "Got it, transferring you" | *(nothing)* | 1 | Drops destination's load-bearing script — **current runner bug** |
| **B** | "Got it, transferring you" | "Verification block + within-grace..." | 2 | Stitched openers — patron hears redundant acknowledgment |
| **C** | *(nothing)* | "Got it. Verification block + within-grace..." | 2 (one silent) | Destination authors the spoken turn — feels like a human hand-off |

**C is the target across all three runtimes.** It matches how Pipecat's `FlowManager` already works, and the runner's route-tag protocol is already shaped to support it (route tag is a separate channel from spoken reply, so source-side text can be suppressed on detected transitions without changing dispatch).

How each target gets there:

- **Pipecat: native.** On a transition function-call, Pipecat sets `FunctionCallResultProperties(run_llm=False)` so the source LLM emits *only* the function call (no assistant text), then queues `LLMRunFrame()` against the destination node when `respond_immediately=True` (default). Two LLM calls, source silent, destination speaks — exactly C. Source code: [`pipecat_flows.manager._set_node` + `_create_transition_func`](https://reference-flows.pipecat.ai/en/stable/_modules/pipecat_flows/manager.html). Translator just emits idiomatic flows with defaults intact. Voice TTFT on chatty boundaries is masked with `pre_actions` (holding TTS line before destination LLM runs) — first-class in the framework.
- **uxflows-runner: implemented 2026-05-15.** The route-tag protocol permits a silent route tag (tag with no preceding reply text); when the runner sees empty reply + non-end tag, it fires a follow-up inference against the now-loaded destination prompt. Loop in [`server/text_session.py`](../uxflows-runner/src/uxflows_runner/server/text_session.py) handles silent-tag chains across multiple flows; voice mode uses an equivalent `pending_followup` flag in [`dispatcher/processor.py`](../uxflows-runner/src/uxflows_runner/dispatcher/processor.py). Implementation detail and status in [`uxflows-runner/RUNNER-PLAN.md` § Chatty-boundary follow-up](../uxflows-runner/RUNNER-PLAN.md#chatty-boundary-follow-up-implemented-2026-05-15--2026-05-19-end-to-end-tala-validation-not-yet-run). End-to-end Tala validation still pending.
- **LangGraph translator: same shape needed.** `Command(goto=...)` switches state without invoking the destination's LLM call. The translator should mirror the runner's approach: render the source flow's prompt with the same silent-tag-permitted contract, then fire the destination's `@task`-wrapped `_llm_call` ([TRANSLATION-POC.md § F3](./TRANSLATION-POC.md)) as a follow-up when the source's reply text is empty.

**The signal: runtime, not structural.** The runner's first design assumed a structural detection heuristic ("destination has scripts AND no LLM-method exit conditions"). The implementation chose a simpler signal — the source LLM itself decides when to defer by emitting a silent tag. This is closer to Pipecat's `run_llm=False` in spirit (the system signals at the moment of decision, not via static pre-analysis), and lets the model judge per-turn rather than per-exit: a chatty exit *can* speak when the source has something genuine to add. LangGraph translator should adopt the same per-turn signal, not the heuristic.

**Specs don't need to change.** The heuristic reads existing fields (`flow.scripts`, `exit_path.condition.method`). No new spec field, no author burden. If the heuristic ever proves systematically wrong on real specs, a per-exit `transition_style` hint is the obvious escape hatch — but adding a spec field on speculation is worse than letting the heuristic ship and iterating from data.

Voice latency at chatty transitions: the second LLM call adds TTFT (~500-1500ms on Gemini Flash). Mitigations are per-target (Pipecat's `pre_actions`, speculative pipelining in LangGraph/runner) and not on the MVP path — text mode is the validation surface.

Outside the translation taxonomy entirely, **native consumption** interprets the spec directly without translating to a third-party framework. The flow executor is small (flow state machine, three-method dispatcher for conditions/captures, capability dispatcher, interrupt scheduler, guardrail evaluator) and preserves authored intent verbatim: stable IDs, multilingual scripts, eval metadata, and flow-graph structure all flow through to runtime and observability without round-tripping through generated code. The uxflows-runner is the canonical native consumer for production execution; the uxflows browser ships a TypeScript port of the same executor for single-test iteration. The same native-consumption shape works for production runtimes, especially text-first agents. For voice, the cost calculus shifts — voice infrastructure (barge-in, VAD, telephony) is most of the work, and Pipecat-as-pipeline or LiveKit transport remain reasonable dependencies even when flow logic stays native.

### Generic Config Bundle

A minimal, target-agnostic export format that any LLM agent platform can consume: composed system prompt + JSON tool schemas for capabilities + behavioral sidecar (persona, voice/model recommendations, modes, knowledge, eval metadata). No runtime graph; flow boundaries collapse to prose ordering and exit-path conditions to routing guidance in the prompt. Lossy by design — the value is breadth of platform coverage at near-zero translator cost on top of the existing prompt generator.

| uxflows Artifact | Config Bundle Output |
|---|---|
| agent meta | Bundle metadata (name, default language, modes, persona summary) |
| flow descriptions, ordering | System prompt sections ordered by entry flow → follow-on flows |
| turn (agent), turn (user) | Prompt scaffolding |
| turn condition / exit_path (any method) | Routing guidance in prose |
| turn capture (`llm`) | Slot-fill instructions in prompt |
| turn capture (`calculation`) | JSON tool schema returning typed value |
| turn capture (`direct`) | Hardcoded value in prompt |
| capability (`kind: function`) | JSON tool schema with typed parameters |
| capability (`kind: retrieval`) | JSON tool schema; retrieval semantics described in `description` |
| variables | Tool parameter / return type schemas |
| guardrails | Prompt constraints section |
| persona | Prompt persona section |
| knowledge.faq | Prompt FAQ section |
| knowledge.tables | Prompt reference-data section |

Consumers: Vapi Assistant API, Retell Agent, LiveKit Agents (simple shape), OpenAI Assistants, basic OpenAI Agents SDK builds, custom orchestrations — anyone that accepts "prompt + JSON tool defs." The bundle is the floor every spec can produce; higher-fidelity targets below layer their own structural translation on top.

The bundle is a designer-to-deployment handoff artifact, not a turnkey deploy package: composed prompt and behavioral sidecar capture the designer's authorship verbatim, but tool schemas are derived from typed capabilities in the spec — name-only capabilities produce stub schemas that the integration team enriches against the real backend API surface at deploy time.

### Pipecat

Pipecat uses a node-graph architecture. Each uxflows flow maps to a Pipecat node. Exit paths become function routing. The translation is structural and mechanical.

| uxflows Artifact | Pipecat Equivalent |
|---|---|
| turn (agent) | LLM processor with `task_messages` |
| turn (user) | User input frame / STT processor |
| turn condition (`llm`) | LLM judgment in dialogue manager |
| turn condition (`calculation`) | Deterministic expression in flow logic |
| turn capture (`llm`) | LLM slot filling |
| turn capture (`calculation`) | Expression-based slot derivation (includes pattern-matching subtype) |
| turn capture (`direct`) | `SetSlot` with literal value |
| capability (`kind: function`) | Custom action / function processor (MCP integration when bound, HTTP call otherwise) |
| capability (`kind: retrieval`) | Context aggregation step |
| tool step (references capability) | Function invocation in flow logic |
| exit-path action (references capability) | Function invocation on the originating node's terminal transition |
| call | Flow transition via `FlowManager` |
| exit path (`calculation`) | Function routing with decision block |
| exit path (`llm`) | LLM-evaluated routing condition |

Behavioral spec fields (guardrails, personas) do not appear in Pipecat output — they are evaluation metadata that lives in uxflows. Pipecat-specific runtime knobs (`context_strategy`, `respond_immediately`, pre/post actions) have no behavioral-spec equivalent and are kept out of the spec layer per the "execution separate from spec" principle. When Pipecat export is built, those hints will live in an export-time sidecar keyed by flow id rather than inside the spec. Post-node side effects are expressed as `exit_path.actions` referencing capabilities, which *is* in the spec.

The export process validates the flow graph before generating Pipecat JSON. Calculation conditions must use the defined expression syntax. Variable references must resolve. Variable names must be lowercase with underscores.

Chatty-boundary behavior (see [intro](#export-targets)) is handled natively: emit nodes with `respond_immediately=True` (the default) and Pipecat's `FlowManager` fires the destination's LLM call on transition. No translator-side follow-up needed. Voice latency on chatty transitions is mitigated with `pre_actions` (e.g. a holding TTS line) — first-class in the framework rather than something the translator has to invent.

### LiveKit

LiveKit uses an instruction-and-tool architecture. The entire agent spec generates a single LiveKit agent with comprehensive instructions and `FunctionTool` definitions. The translation is compositional. No LiveKit-specific hints field is needed in the schema.

| uxflows Artifact | LiveKit Equivalent |
|---|---|
| agent meta + guardrails | Agent instructions |
| flow descriptions | Instructions fragments in order |
| flow guardrails | Instructions constraints section |
| turn (agent) | Instructions guidance |
| turn (user) | Instructions expected behavior |
| turn capture (`llm`) | LLM extraction in instructions |
| turn capture (`calculation`) | `FunctionTool` with typed return |
| turn capture (`direct`) | Hardcoded value in instructions |
| capability (`kind: function`) | `FunctionTool` definition (MCP connection or HTTP call resolved at execution time) |
| capability (`kind: retrieval`) | `FunctionTool` with retrieval logic |
| tool step (references capability) | `FunctionTool` invocation in instructions |
| exit-path action (references capability) | `FunctionTool` invoked at flow terminal state |
| call | Sub-instructions section |
| exit path (`llm`) | Routing guidance in instructions |
| exit path (`calculation`) | `FunctionTool` returning routing decision |
| variables | Tool parameters and return types |
| knowledge.faq | Instructions FAQ section |
| knowledge.tables | Reference data in instructions |

### LangGraph

LangGraph uses a graph-based execution model architecturally closest to uxflows's flow model. uxflows flows become LangGraph nodes. Exit paths become edges. Variables become the typed state schema. LangGraph's human-in-the-loop interrupt patterns are relevant for compliance approval workflows in Phase 3.

| uxflows Artifact | LangGraph Equivalent |
|---|---|
| agent | `StateGraph` with typed state schema |
| flow | Graph node |
| variables | State schema fields (typed) |
| turn (agent) | Node function with LLM call |
| turn (user) | Human input node |
| turn capture (`llm`) | State update via LLM extraction |
| turn capture (`calculation`) | State update via expression |
| turn capture (`direct`) | Direct state assignment |
| capability (`kind: function`) | `ToolNode` with typed parameters |
| capability (`kind: retrieval`) | `Retriever` node |
| tool step (references capability) | `ToolNode` invocation |
| exit-path action (references capability) | Terminal-node side effect (post-state-update) |
| call step | Subgraph invocation |
| exit path (`calculation`) | Conditional edge with expression |
| exit path (`llm`) | Conditional edge with LLM judgment |
| guardrails | Node-level validation logic |

Variable type declarations are especially important for LangGraph. Untyped variables default to string in the generated state schema.

Chatty-boundary behavior (see [intro](#export-targets)) requires translator-side follow-up driven by a runtime signal: render the source flow's prompt with the silent-tag-permitted contract (route tag without preceding text is allowed), and when the source emits an empty reply + non-end tag, fire the destination's `@task`-wrapped `_llm_call` (see [TRANSLATION-POC.md § F3](./TRANSLATION-POC.md)) as a follow-up. Mirrors the runner's approach. Validated on FNOL because FNOL's flow boundaries are non-chatty; Tala-shaped specs would expose the need.

### Dialogflow CX / Vertex AI Conversational Agents

Dialogflow CX is graph-based: flows contain pages, pages contain parameters and transition routes, transitions are explicit edges. Vertex AI Conversational Agents is the LLM-first surface over the same runtime, adding Playbooks (generative agents), Generators (LLM responses), and Data Stores (retrieval grounding). The translation defaults to the Playbook + Generator path since uxflows is LLM-first. CX ships voice and telephony bridges, so this target covers production voice without a separate transport layer. Note: Google has folded CX under the Vertex AI Agent Builder / Conversational Agents brand; the runtime remains production-supported and underlies substantial enterprise CCAI deployments, but new Google-stack builds are steered toward Playbooks or the Agent Development Kit (ADK) — this target is most relevant for migration and expansion within existing CX customers.

| uxflows Artifact | Dialogflow CX Equivalent |
|---|---|
| agent meta | Agent (display name, default language, speech config) |
| variables | Session parameters with type schema |
| flow | Flow with start page |
| turn (agent) | Page entry fulfillment via Generator |
| turn (user) | Page form parameter prompt |
| turn condition (`llm`) | Playbook routing instruction |
| turn condition (`calculation`) | Webhook returning condition outcome |
| turn capture (`llm`) | Parameter with Generator extraction |
| turn capture (`calculation`) | Parameter with webhook fulfillment returning typed value |
| turn capture (`direct`) | Parameter default value |
| capability (`kind: function`) | Webhook (HTTP) fulfillment |
| capability (`kind: retrieval`) | Data Store handler / Generator with grounding |
| tool step (references capability) | Page-level webhook invocation |
| exit-path action (references capability) | Transition fulfillment webhook |
| call | Flow transition route |
| exit path (`calculation`) | Transition route with condition expression |
| exit path (`llm`) | Intent or Playbook route |
| exit_path with `goto: "END"` | End-session event handler |
| interrupt flow | Priority transition route scoped at agent or page level |
| guardrails | Generator system instructions; agent safety settings |
| knowledge.faq | Data Store FAQ document |
| knowledge.tables | Reference data via Data Store or webhook |

Behavioral spec fields (personas, eval metadata) map to Generator/Playbook system instructions. CX-specific runtime knobs (transition priority, retry behavior, page form-filling order) have no behavioral-spec equivalent and ride in an export-time sidecar keyed by flow/page id. The translator validates that `calculation` exits and captures resolve to webhook-backed routes rather than prose-only Playbook instructions — preserving deterministic evaluation across the translation seam.

### OpenAI Agents SDK

| uxflows Artifact | OpenAI Agents SDK Equivalent |
|---|---|
| agent meta | Agent name and instructions |
| agent guardrails | SDK guardrails (direct mapping — the cleanest schema feature mapping across all targets) |
| flow descriptions | Instructions sections (default) |
| flow with substantially different guardrails or capability subset | Separate `Agent` reached via handoff |
| turn (agent) | Instructions guidance |
| turn (user) | Instructions expected behavior |
| turn capture (`llm`) | LLM extraction in instructions |
| turn capture (`calculation`) | `FunctionTool` returning typed value |
| turn capture (`direct`) | Hardcoded value in instructions |
| capability (`kind: function`) | `FunctionTool` definition (MCP or HTTP resolved at execution time) |
| capability (`kind: retrieval`) | `FunctionTool` with retrieval logic |
| tool step (references capability) | `FunctionTool` invocation |
| exit-path action (references capability) | `FunctionTool` invoked before terminating or handing off |
| exit_path (`llm`) | Routing guidance in instructions |
| exit_path (`calculation`) | `FunctionTool` returning routing decision |
| exit_path with `goto: "END"` | `Runner` returns final result |
| exit_path with `goto: "RETURN"` | Sub-agent's terminal exit returning control to caller |
| interrupt flow (`type: "interrupt"`) | Separate `Agent` reached via handoff (returns via `goto: "RETURN"`) |
| call step | Agent handoff to sub-agent; sub-agent terminal exit returns control |
| variables | Tool parameters and shared context (typed `variables` → typed context fields) |
| knowledge.faq | Instructions FAQ section |

## Import Sources

### Voiceflow

Run `voiceflow jsonschema` to get the authoritative schema before building the importer. Guardrails, personas, and knowledge are absent from Voiceflow exports and must be authored in uxflows after import.

| Voiceflow Concept | uxflows Equivalent |
|---|---|
| Assistant | Agent |
| Diagram / Topic | Flow |
| Speak step | Agent turn |
| Choice step | Exit paths with conditions |
| Capture step | User turn with captures |
| API step | Capability (`kind: function`) + tool step reference |
| Condition step | Exit path condition |
| Variable | Variable in `variables` dictionary |
| Intent / Utterances | User turn utterances |

### Botpress

Botpress exports carry JSON Schema typed variable definitions that map directly to uxflows variable type declarations, preserving type information through import.

| Botpress Concept | uxflows Equivalent |
|---|---|
| Bot / Agent | Agent |
| Workflow | Flow |
| Node | Step in flow |
| Card (speak) | Agent turn |
| Card (capture) | User turn with captures |
| Card (execute code) | Capability (`kind: function`) + tool step reference |
| Condition | Exit path condition |
| Variable (JSON Schema typed) | Variable with type declaration |
| Knowledge Base | Capability (`kind: retrieval`) |
| Intent / Utterances | User turn utterances |
