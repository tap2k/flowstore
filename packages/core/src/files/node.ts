import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { FileMap } from "./types";

const SKIP_NAMES = new Set([".DS_Store", ".git", "node_modules"]);

export function readDirectoryToFileMap(root: string): FileMap {
  const files: FileMap = {};
  walk(root, root, files);
  return files;
}

function walk(root: string, current: string, files: FileMap): void {
  for (const entry of readdirSync(current)) {
    if (SKIP_NAMES.has(entry)) continue;
    const path = join(current, entry);
    const s = statSync(path);
    if (s.isDirectory()) {
      walk(root, path, files);
      continue;
    }
    const rel = relative(root, path).split(sep).join("/");
    files[rel] = readFileSync(path, "utf8");
  }
}

export function writeFileMapToDirectory(files: FileMap, root: string): void {
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
}
