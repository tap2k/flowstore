import { pcm16BytesToWav, pcm16ChunksToBytes } from "./audio";

// Session-scoped replay cache for spoken turns — compare's s2s columns AND
// simulate's voice/TTS turns share it (one budget, one replay UX). Sources:
// the engine hands over each s2s reply's PCM chunks (s2sCell onAudio),
// VoiceSession tees its live audio, and TTS synthesis stores ready blobs.
// Deliberately NOT in the zustand store and never persisted — a study's
// audio would blow the localStorage quota instantly, so replay is for the
// session that ran it. (Durable audio belongs in a future bundle export.)
//
// Insertion-ordered → oldest-first eviction, budgeted by WIRE bytes (raw
// PCM for the live sockets — ~48 KB/s; encoded mp3 for TTS — ~10x smaller,
// so TTS entries stretch the budget much further). Every writer goes
// through store() so the budget can't be bypassed.
//
// The cache is observable (version + subscribe) so React re-renders when
// entries arrive or evict — the "hear" control appears with the turn and
// disappears on eviction instead of silently breaking.

// Cache-key namespace for simulate's spoken turns (turn ts disambiguates;
// compare uses cellKey, which never collides with this).
export const SIMULATE_AUDIO_KEY = "simulate";

type Entry = ({ kind: "pcm"; pcm: Uint8Array } | { kind: "blob"; blob: Blob }) & {
  bytes: number;
  url?: string;
};

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

// The one writer: replaces any prior entry, then enforces the byte budget
// oldest-first. Both insertion paths (engine PCM, TTS blobs) come through
// here — a second path that skipped the budget would grow unbounded.
function store(k: string, e: Entry): void {
  evict(k);
  entries.set(k, e);
  totalBytes += e.bytes;
  for (const oldest of entries.keys()) {
    if (totalBytes <= MAX_AUDIO_BYTES || oldest === k) break;
    evict(oldest);
  }
  bump();
}

export function putTurnAudio(cellKey: string, turnTs: number, chunks: string[]): void {
  // Decode once at write time: exact accounting, and the base64 strings
  // (1.33x the payload) don't stay resident.
  const pcm = pcm16ChunksToBytes(chunks);
  store(keyOf(cellKey, turnTs), { kind: "pcm", pcm, bytes: pcm.length });
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
      e.kind === "blob"
        ? e.blob
        : new Blob([pcm16BytesToWav(e.pcm).buffer as ArrayBuffer], { type: "audio/wav" });
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
      store(k, { kind: "blob", blob, bytes: blob.size });
      return getTurnAudioUrl(cellKey, turnTs);
    })
    .finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
}

// Clear everything, or one namespace (`prefix` = the cellKey namespace, e.g.
// SIMULATE_AUDIO_KEY) — simulate's resets must not nuke compare's replays.
export function clearTurnAudio(prefix?: string): void {
  for (const k of [...entries.keys()]) {
    if (prefix === undefined || k.startsWith(`${prefix}::`)) evict(k);
  }
  bump();
}
