import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { FileMap, LoadResult } from "./types";
import { isFileMapBundle, loadProject } from "./load";

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

// Resolve a CLI input path to a loaded project. Accepts the two supported
// on-disk forms: a decomposed project directory, or a .flowstore.json bundle
// (serialized FileMap). Bare spec JSON files are no longer accepted — export
// a bundle from the editor or point at the project directory instead.
export function loadProjectFromPath(path: string): LoadResult {
  if (statSync(path).isDirectory()) {
    return loadProject(readDirectoryToFileMap(path));
  }
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (isFileMapBundle(data)) return loadProject(data);
  throw new Error(
    `${path} is not a project directory or .flowstore.json bundle. ` +
      "Bare spec JSON is no longer accepted as a file input; export a bundle " +
      "from the editor (Export project) or use the decomposed project directory.",
  );
}
