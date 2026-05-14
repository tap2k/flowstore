# Runtime Translation Tables

Mappings from the UX4 behavioral spec to each supported runtime. These document how the schema maps to each runtime so that Phase 2 export work can be scoped accurately. **None of them ship in the MVP.** Today's only export target is the system-prompt codegen at [`lib/codegen/promptGenerator.ts`](./lib/codegen/promptGenerator.ts) (a monolithic prompt for non-runner runtimes); the tables below inform future targets in the same `lib/codegen/` pipeline.

For the schema these reference, see [SCHEMA.md](./SCHEMA.md).

## Export Targets

Targets fall into two structural classes. Graph-native runtimes (Pipecat, LangGraph) translate UX4 flows directly to nodes and exit_paths to edges; the spec's structure is preserved at runtime. Instruction-and-tool runtimes (LiveKit, OpenAI Agents SDK) compose the entire spec into a single agent's instructions; flow boundaries become prose ordering and exit-path conditions become routing guidance. Both work; the choice affects how much of UX4's authored structure survives as enforced runtime structure versus prose hints. Author for behavioral seams; accept that not all targets enforce them equivalently.

A third path is **native consumption** — interpreting the spec directly without translating to a third-party framework. The flow executor is small (flow state machine, three-method dispatcher for conditions/captures, capability dispatcher, interrupt scheduler, guardrail evaluator) and preserves authored intent verbatim: stable IDs, multilingual scripts, eval metadata, and flow-graph structure all flow through to runtime and observability without round-tripping through generated code. The uxflows-runner is the canonical native consumer; whatsupp2 consumes the spec at the evaluation layer (guardrails, scenarios) but does not natively execute it — it wraps whatever endpoint the agent under test runs on. The same native-consumption shape works for production runtimes, especially text-first agents. For voice, the cost calculus shifts — voice infrastructure (barge-in, VAD, telephony) is most of the work, and Pipecat-as-pipeline or LiveKit transport remain reasonable dependencies even when flow logic stays native.

### Pipecat

Pipecat uses a node-graph architecture. Each UX4 flow maps to a Pipecat node. Exit paths become function routing. The translation is structural and mechanical.

| UX4 Artifact | Pipecat Equivalent |
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

Behavioral spec fields (guardrails, personas) do not appear in Pipecat output — they are evaluation metadata that lives in UX4. Pipecat-specific runtime knobs (`context_strategy`, `respond_immediately`, pre/post actions) have no behavioral-spec equivalent and are kept out of the spec layer per the "execution separate from spec" principle. When Pipecat export is built, those hints will live in an export-time sidecar keyed by flow id rather than inside the spec. Post-node side effects are expressed as `exit_path.actions` referencing capabilities, which *is* in the spec.

The export process validates the flow graph before generating Pipecat JSON. Calculation conditions must use the defined expression syntax. Variable references must resolve. Variable names must be lowercase with underscores.

### LiveKit

LiveKit uses an instruction-and-tool architecture. The entire agent spec generates a single LiveKit agent with comprehensive instructions and `FunctionTool` definitions. The translation is compositional. No LiveKit-specific hints field is needed in the schema.

| UX4 Artifact | LiveKit Equivalent |
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

LangGraph uses a graph-based execution model architecturally closest to UX4's flow model. UX4 flows become LangGraph nodes. Exit paths become edges. Variables become the typed state schema. LangGraph's human-in-the-loop interrupt patterns are relevant for compliance approval workflows in Phase 3.

| UX4 Artifact | LangGraph Equivalent |
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

### OpenAI Agents SDK

| UX4 Artifact | OpenAI Agents SDK Equivalent |
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

Run `voiceflow jsonschema` to get the authoritative schema before building the importer. Guardrails, personas, and knowledge are absent from Voiceflow exports and must be authored in UX4 after import.

| Voiceflow Concept | UX4 Equivalent |
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

Botpress exports carry JSON Schema typed variable definitions that map directly to UX4 variable type declarations, preserving type information through import.

| Botpress Concept | UX4 Equivalent |
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
