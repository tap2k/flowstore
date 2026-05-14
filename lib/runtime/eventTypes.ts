// Mirror of uxflows-runner/src/uxflows_runner/events/schema.py.
// Keep in sync when the runner adds/changes event types.

export type EventMethod = "llm" | "calculation" | "direct";

interface EventBase {
  session_id: string;
  ts: string;
}

export interface SessionStarted extends EventBase {
  type: "session_started";
  agent_id: string;
  lang: string;
  spec_hash: string;
}

export interface SessionEnded extends EventBase {
  type: "session_ended";
  reason: "user_stop" | "agent_terminal" | "error" | "idle";
}

export interface FlowEntered extends EventBase {
  type: "flow_entered";
  flow_id: string;
  via: "transition" | "interrupt" | "return" | "entry";
  caller_flow_id: string | null;
}

export interface FlowExited extends EventBase {
  type: "flow_exited";
  flow_id: string;
  exit_path_id: string | null;
  reason: "transition" | "terminal" | "interrupted" | "returned";
}

export interface ExitPathTaken extends EventBase {
  type: "exit_path_taken";
  from_flow_id: string;
  exit_path_id: string;
  to_flow_id: string | null;
  method: EventMethod;
}

export interface InterruptTriggered extends EventBase {
  type: "interrupt_triggered";
  from_flow_id: string;
  interrupt_flow_id: string;
  method: EventMethod;
}

export interface TurnStarted extends EventBase {
  type: "turn_started";
  role: "agent" | "user";
}

export interface TurnCompleted extends EventBase {
  type: "turn_completed";
  role: "agent" | "user";
  text: string;
}

export interface VariableSet extends EventBase {
  type: "variable_set";
  variable_name: string;
  value: unknown;
  method: EventMethod;
  source_flow_id: string;
  source_exit_path_id: string;
}

export interface CapabilityInvoked extends EventBase {
  type: "capability_invoked";
  capability_name: string;
  args: Record<string, unknown>;
}

export interface CapabilityReturned extends EventBase {
  type: "capability_returned";
  capability_name: string;
  result: unknown | null;
  error: string | null;
}

export interface RuntimeError extends EventBase {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
}

export type RuntimeEvent =
  | SessionStarted
  | SessionEnded
  | FlowEntered
  | FlowExited
  | ExitPathTaken
  | InterruptTriggered
  | TurnStarted
  | TurnCompleted
  | VariableSet
  | CapabilityInvoked
  | CapabilityReturned
  | RuntimeError;
