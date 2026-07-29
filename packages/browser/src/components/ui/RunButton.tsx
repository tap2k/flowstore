import { Play } from "@phosphor-icons/react";
import { TransportButton, type TransportButtonProps } from "./TransportButton";

// The run half of the app's run/stop pair (see TransportButton). `label` is
// required so each surface states what "run" covers there.
export type RunButtonProps = TransportButtonProps;

export function RunButton(props: RunButtonProps) {
  return <TransportButton tone="run" icon={Play} {...props} />;
}
