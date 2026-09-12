// Compile provenance: the hashes that bind a run to the spec it ran under.
//
// `spec_hash` is computed over the canonical JSON normal form of the resolved
// spec (keys sorted recursively, no whitespace, undefined dropped), never over
// the markdown bytes: a reordered frontmatter key or a whitespace-only edit
// must not change the hash, and a content change must. `prompt_hash` is over
// the emitted system prompt text, so two compiles of the same spec for
// different languages or vars are distinguishable. Both are the first 16 hex
// chars of SHA-256, matching the runner's `spec_hash` width.
//
// Web Crypto only (Node >= 19 and every browser), so the same function serves
// the CLI, the editor, and the simulator.

import type { Spec } from "../schema/v0";

export const HASH_WIDTH = 16;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function specHash(spec: Spec): Promise<string> {
  return (await sha256Hex(canonicalJson(spec))).slice(0, HASH_WIDTH);
}

export async function promptHash(systemPrompt: string): Promise<string> {
  return (await sha256Hex(systemPrompt)).slice(0, HASH_WIDTH);
}

export interface CompileProvenance {
  spec_hash: string;
  prompt_hash: string;
  agent_id: string;
  language?: string;
  compiled_at: string;
  // "flowstore-compile 0.1.0-alpha.1" from the CLI; the editor passes its own.
  compiler?: string;
}

export async function compileProvenance(
  spec: Spec,
  systemPrompt: string,
  opts?: { language?: string; compiler?: string; now?: Date },
): Promise<CompileProvenance> {
  const [spec_hash, prompt_hash] = await Promise.all([specHash(spec), promptHash(systemPrompt)]);
  return {
    spec_hash,
    prompt_hash,
    agent_id: spec.agent.id,
    ...(opts?.language ? { language: opts.language } : {}),
    compiled_at: (opts?.now ?? new Date()).toISOString(),
    ...(opts?.compiler ? { compiler: opts.compiler } : {}),
  };
}
