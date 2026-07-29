import { pcm16ChunksToWav } from "@/lib/runtime/audio";

// Session-scoped replay cache for s2s columns: the engine hands over each
// spoken reply's PCM chunks (s2sCell onAudio); we keep the chunks and build
// the WAV blob URL lazily on first replay — eagerly encoding every turn
// would burn main-thread time and triple-copy audio nobody may ever click.
// Deliberately NOT in the zustand store and never persisted — a study's
// audio would blow the localStorage quota instantly, so replay is for the
// session that ran it. (Durable audio belongs in a future bundle export.)
//
// Insertion-ordered → oldest-first eviction. Budgeted by decoded bytes:
// PCM16@24kHz is ~48 KB/s, so 64 MB holds ~20 minutes of spoken replies —
// a large study with headroom. Re-runs mint new turn timestamps (old entries
// go stale, not replaced), so without the budget a long session would leak.
//
// The cache is observable (version + subscribe) so React re-renders when
// entries arrive or evict — the "hear" control appears with the turn and
// disappears on eviction instead of silently breaking.

type Entry = { chunks: string[]; bytes: number; url?: string };

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const entries = new Map<string, Entry>();
let totalBytes = 0;

let version = 0;
const listeners = new Set<() => void>();
function bump(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribeTurnAudio(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function turnAudioVersion(): number {
  return version;
}

const keyOf = (cellKey: string, turnTs: number) => `${cellKey}::${turnTs}`;

function evict(k: string): void {
  const e = entries.get(k);
  if (!e) return;
  if (e.url) URL.revokeObjectURL(e.url);
  totalBytes -= e.bytes;
  entries.delete(k);
}

export function putTurnAudio(cellKey: string, turnTs: number, chunks: string[]): void {
  const k = keyOf(cellKey, turnTs);
  evict(k);
  // Decoded size from base64 length — close enough for a budget, and it
  // avoids decoding audio that may never be played.
  const bytes = Math.floor(chunks.reduce((a, c) => a + c.length, 0) * 0.75);
  entries.set(k, { chunks, bytes });
  totalBytes += bytes;
  for (const oldest of entries.keys()) {
    if (totalBytes <= MAX_AUDIO_BYTES || oldest === k) break;
    evict(oldest);
  }
  bump();
}

export function hasTurnAudio(cellKey: string, turnTs: number): boolean {
  return entries.has(keyOf(cellKey, turnTs));
}

// Render-safe peek: the entry's URL if (and only if) it has already been
// built — never triggers an encode.
export function peekTurnAudioUrl(cellKey: string, turnTs: number): string | undefined {
  return entries.get(keyOf(cellKey, turnTs))?.url;
}

// First call pays the WAV build; the URL is memoized on the entry (and
// revoked on eviction/clear).
export function getTurnAudioUrl(cellKey: string, turnTs: number): string | undefined {
  const e = entries.get(keyOf(cellKey, turnTs));
  if (!e) return undefined;
  if (!e.url) {
    const wav = pcm16ChunksToWav(e.chunks);
    e.url = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }));
  }
  return e.url;
}

export function clearTurnAudio(): void {
  for (const e of entries.values()) {
    if (e.url) URL.revokeObjectURL(e.url);
  }
  entries.clear();
  totalBytes = 0;
  bump();
}
