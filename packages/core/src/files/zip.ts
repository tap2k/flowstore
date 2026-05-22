import JSZip from "jszip";
import type { FileMap } from "./types";

// Pack a FileMap (path -> string) into a single zip Blob. Browser-side; the
// Blob is suitable for an anchor download. The on-disk layout inside the zip
// mirrors what writeFileMapToDirectory would produce — same paths, same
// content, no extra wrapping folder.
export async function makeZip(files: FileMap): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return await zip.generateAsync({ type: "blob" });
}

// Read a zip Blob/File into a FileMap. Skips directory entries and anything
// the loader wouldn't recognize is filtered later by loadProject (which only
// looks at the canonical paths). Non-canonical content in the zip is preserved
// in the FileMap but ignored by the loader.
export async function readZip(file: Blob): Promise<FileMap> {
  const zip = await JSZip.loadAsync(file);
  const fileEntries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);
  const out: FileMap = {};
  await Promise.all(
    fileEntries.map(async ([path, entry]) => {
      out[path] = await entry.async("string");
    }),
  );
  return out;
}
