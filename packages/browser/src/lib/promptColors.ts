import type { PromptSource } from "@flowstore/core/codegen/promptGenerator";
import type { FlowType } from "@flowstore/core/schema/v0";

export type PromptKind = PromptSource["kind"];

interface BlockStyle {
  block: string; // body background tint
  header: string; // label text color
  hover: string; // hover background (clickable blocks)
  ring: string; // focus ring
  /**
   * Body ink. Only the flow-typed styles set this: their tints are fixed light
   * values (see below), so their text has to be pinned to a dark ink rather
   * than following the theme's text token, which inverts. Neutral and runtime
   * blocks leave it empty and inherit the token.
   */
  body?: string;
}

// Non-flow sections render neutral — their label names them. Only flows carry
// color, and that color matches the canvas (keyed by flow type), so a colored
// block always reads as "a flow of this type" without needing a legend.
const NEUTRAL: BlockStyle = {
  block: "bg-surface-sunken",
  header: "text-text-secondary",
  hover: "hover:bg-surface-hover",
  ring: "focus-visible:ring-focus-ring",
};

// Runtime context is derived (not editable, not on the canvas) — slightly
// off-neutral and never clickable.
const RUNTIME: BlockStyle = {
  block: "bg-surface-active",
  header: "text-text-tertiary",
  hover: "",
  ring: "",
};

// Hues mirror the canvas node styling in FlowNode.tsx (typeStyles) so the panel
// and the graph agree on what each flow type looks like. These stay on the raw
// palette rather than moving to state tokens: the canvas is deliberately out of
// scope for the design-system retrofit, and the whole point of these five is
// that a block in the prompt panel matches the node it came from. They convert
// when the canvas does.
export const FLOW_TYPE_STYLES: Record<FlowType, BlockStyle> = {
  happy: {
    block: "bg-emerald-50",
    header: "text-emerald-700",
    hover: "hover:bg-emerald-100",
    ring: "focus-visible:ring-emerald-400",
    body: "text-zinc-900",
  },
  sad: {
    block: "bg-amber-50",
    header: "text-amber-700",
    hover: "hover:bg-amber-100",
    ring: "focus-visible:ring-amber-400",
    body: "text-zinc-900",
  },
  off: {
    block: "bg-zinc-50",
    header: "text-zinc-700",
    hover: "hover:bg-zinc-100",
    ring: "focus-visible:ring-zinc-400",
    body: "text-zinc-900",
  },
  utility: {
    block: "bg-sky-50",
    header: "text-sky-700",
    hover: "hover:bg-sky-100",
    ring: "focus-visible:ring-sky-400",
    body: "text-zinc-900",
  },
  interrupt: {
    block: "bg-violet-50",
    header: "text-violet-700",
    hover: "hover:bg-violet-100",
    ring: "focus-visible:ring-violet-400",
    body: "text-zinc-900",
  },
};

// flowType is supplied for flow/interrupt segments (looked up from the spec);
// every other source kind is neutral.
export function styleForSource(source: PromptSource, flowType?: FlowType): BlockStyle {
  if ((source.kind === "flow" || source.kind === "interrupt") && flowType) {
    return FLOW_TYPE_STYLES[flowType];
  }
  if (source.kind === "runtimeContext") return RUNTIME;
  return NEUTRAL;
}

export function isClickable(kind: PromptKind): boolean {
  // runtimeContext and multilingual are generated guidance with no editable
  // source entity — not clickable.
  return kind !== "runtimeContext" && kind !== "multilingual";
}

export function labelFor(source: PromptSource): string {
  switch (source.kind) {
    case "flow":
      return `Flow: ${source.name}`;
    case "interrupt":
      return `Interrupt: ${source.name}`;
    case "role":
      return "Role";
    case "guardrails":
      return "Guardrails";
    case "knowledge":
      return "Knowledge";
    case "runtimeContext":
      return "Runtime context";
    case "multilingual":
      return "Multilingual";
    case "templateWrapper":
      return "System prompt template";
  }
}
