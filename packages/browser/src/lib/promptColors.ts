import type { PromptSource } from "@flowstore/core/codegen/promptGenerator";
import type { FlowType } from "@flowstore/core/schema/v0";

export type PromptKind = PromptSource["kind"];

interface BlockStyle {
  block: string; // body background tint
  header: string; // label text color
  hover: string; // hover background (clickable blocks)
  ring: string; // focus ring
  /**
   * Body ink. Every style now leaves this empty and inherits --text-primary:
   * the flow tints are theme-aware tokens, so their text no longer has to be
   * pinned to a fixed dark ink. Kept on the type because a future style may
   * legitimately need to override the inherited token.
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

// These are the same --flow-* tokens the canvas nodes use (FlowNode.tsx
// typeStyles), which is the whole point: a colored block in the prompt panel
// must read as "the node this came from," not merely as a similar green. The
// header ink is the type's -fg (it clears 4.5:1 on the tint in both modes);
// the body inherits --text-primary, since the tint is now theme-aware.
export const FLOW_TYPE_STYLES: Record<FlowType, BlockStyle> = {
  happy: {
    block: "bg-flow-happy-bg",
    header: "text-flow-happy-fg",
    hover: "hover:bg-surface-hover",
    ring: "focus-visible:ring-flow-happy-line",
  },
  sad: {
    block: "bg-flow-sad-bg",
    header: "text-flow-sad-fg",
    hover: "hover:bg-surface-hover",
    ring: "focus-visible:ring-flow-sad-line",
  },
  off: {
    block: "bg-flow-off-bg",
    header: "text-flow-off-fg",
    hover: "hover:bg-surface-hover",
    ring: "focus-visible:ring-flow-off-line",
  },
  utility: {
    block: "bg-flow-utility-bg",
    header: "text-flow-utility-fg",
    hover: "hover:bg-surface-hover",
    ring: "focus-visible:ring-flow-utility-line",
  },
  interrupt: {
    block: "bg-flow-interrupt-bg",
    header: "text-flow-interrupt-fg",
    hover: "hover:bg-surface-hover",
    ring: "focus-visible:ring-flow-interrupt-line",
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
