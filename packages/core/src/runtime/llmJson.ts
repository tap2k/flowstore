import { type Spec, channelLabel } from "@flowstore/core/schema/v0";

export function agentContextPreamble(spec: Spec): string[] {
  const lines = [`Agent purpose: ${spec.agent.meta.purpose || "(not specified)"}`];
  if (spec.agent.meta.client) lines.push(`Client: ${spec.agent.meta.client}`);
  lines.push(`Channel: ${channelLabel(spec.agent.meta.modality)}`);
  return lines;
}
