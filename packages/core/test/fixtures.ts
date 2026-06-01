import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Spec } from "@flowstore/core/schema/v0";

// Repo-root examples, read straight off disk (same specs the editor and CLI use).
export function loadExampleSpec(relPath: string): Spec {
  const url = new URL(`../../../examples/${relPath}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Spec;
}

// Vendored test fixtures under test/fixtures/ — hermetic, not tied to the
// external example repos. Used for shapes the shipped examples don't exercise.
export function loadFixtureSpec(relPath: string): Spec {
  const url = new URL(`./fixtures/${relPath}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Spec;
}

// Drop undefined fields + normalize to plain JSON so deep-equality is
// key-order- and undefined-insensitive.
export function normalize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// Flow / capability order is presentational (lookup is by id), so sort by id
// before comparing a round-tripped spec against its source.
export function sortById(spec: Spec): Spec {
  const agent = spec.agent.capabilities
    ? { ...spec.agent, capabilities: [...spec.agent.capabilities].sort((a, b) => a.id.localeCompare(b.id)) }
    : spec.agent;
  return { ...spec, agent, flows: [...spec.flows].sort((a, b) => a.id.localeCompare(b.id)) };
}
