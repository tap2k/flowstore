export * from "./types";
export * from "./decompose";
export * from "./load";
// node.ts uses node:fs and node:path; consume via the deep import
// "@ux4/core/files/node" so browser bundlers don't pull it.
