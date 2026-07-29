import { pcm16ChunksToWav } from "./audio";

// Session-scoped replay cache for spoken turns — compare's s2s columns AND
// simulate's voice/TTS turns share it (one budget, one replay UX). Sources:
// the engine hands over each s2s reply's PCM chunks (s2sCell onAudio),
// VoiceSession tees its live audio, and TTS synthesis stores ready blobs.
// PCM is WAV-wrapped lazily on first replay — eagerly encoding every turn
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

// Two entry shapes: raw PCM chunks (the live sockets emit containerless
// audio — WAV-wrapped lazily on first play) or a ready-to-play Blob (TTS
// vendors return real containers; an <audio> element plays them natively,
// so transcoding would be pure waste).
type Entry = { chunks?: string[]; blob?: Blob; bytes: number; url?: string };

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
    const blob =
      e.blob ??
      new Blob([pcm16ChunksToWav(e.chunks ?? []).buffer as ArrayBuffer], { type: "audio/wav" });
    e.url = URL.createObjectURL(blob);
  }
  return e.url;
}

// Cache-miss fill with in-flight dedupe: two quick clicks (or the same turn
// rendered twice) must cost ONE synthesis call on the user's key — the
// dedupe has to live per entry, here, not in per-component React state.
const inFlight = new Map<string, Promise<string | undefined>>();

export function getOrSynthesizeTurnAudio(
  cellKey: string,
  turnTs: number,
  synth: () => Promise<Blob>,
): Promise<string | undefined> {
  const k = keyOf(cellKey, turnTs);
  const existing = getTurnAudioUrl(cellKey, turnTs);
  if (existing) return Promise.resolve(existing);
  const pending = inFlight.get(k);
  if (pending) return pending;
  const p = synth()
    .then((blob) => {
      evict(k);
      entries.set(k, { blob, bytes: blob.size });
      totalBytes += blob.size;
      bump();
      return getTurnAudioUrl(cellKey, turnTs);
    })
    .finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
}

export function clearTurnAudio(): void {
  for (const e of entries.values()) {
    if (e.url) URL.revokeObjectURL(e.url);
  }
  entries.clear();
  totalBytes = 0;
  bump();
}
