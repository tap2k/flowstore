import type { Spec } from "@flowstore/core/schema/v0";

export function agentContextPreamble(spec: Spec): string[] {
  const lines = [`Agent purpose: ${spec.agent.meta.purpose || "(not specified)"}`];
  if (spec.agent.meta.client) lines.push(`Client: ${spec.agent.meta.client}`);
  return lines;
}
