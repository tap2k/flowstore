import { Stop } from "@phosphor-icons/react";
import { TransportButton, type TransportButtonProps } from "./TransportButton";

// The stop half of the app's run/stop pair (see TransportButton). Error-
// outlined, never filled red, per Button's destructive doctrine; the default
// label states the cooperative-stop contract.
export interface StopButtonProps extends Omit<TransportButtonProps, "label"> {
  label?: string;
}

export function StopButton({
  label = "Stop. Any in-flight LLM call still completes; finished conversations are kept.",
  ...rest
}: StopButtonProps) {
  return <TransportButton tone="stop" icon={Stop} label={label} {...rest} />;
}
