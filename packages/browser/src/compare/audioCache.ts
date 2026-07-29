import { LIVE_AUDIO_SAMPLE_RATE } from "@flowstore/studies";

// Session-scoped replay cache for s2s columns: the engine hands over each
// spoken reply's PCM chunks (liveCell onAudio), we wrap a WAV header and
// keep a blob URL keyed by cell + agent-turn ts. Deliberately NOT in the
// zustand store and never persisted — a study's audio would blow the
// localStorage quota instantly, so replay is for the session that ran it.
// (Durable audio belongs in a future bundle export, not in state.)

// Insertion-ordered → oldest-first eviction. Budgeted by bytes, not entries:
// PCM16@24kHz is ~48 KB/s, so 64 MB holds ~20 minutes of spoken replies —
// a large study with headroom. Re-runs mint new turn timestamps (old entries
// go stale, not replaced), so without the budget a long session would leak.
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const urls = new Map<string, { url: string; bytes: number }>();
let totalBytes = 0;

const keyOf = (cellKey: string, turnTs: number) => `${cellKey}::${turnTs}`;

function evict(k: string): void {
  const e = urls.get(k);
  if (!e) return;
  URL.revokeObjectURL(e.url);
  totalBytes -= e.bytes;
  urls.delete(k);
}

// Wrap base64 PCM16 chunks (Live output: 24kHz mono) in a RIFF/WAV header so
// a plain <audio>/Audio element can play them.
export function pcm16ChunksToWav(
  chunks: string[],
  sampleRate: number = LIVE_AUDIO_SAMPLE_RATE,
): Uint8Array {
  const bins = chunks.map((c) => {
    const s = atob(c);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  });
  const dataLen = bins.reduce((a, b) => a + b.length, 0);
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataLen, true);
  const out = new Uint8Array(buf);
  let off = 44;
  for (const b of bins) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

export function putTurnAudio(cellKey: string, turnTs: number, chunks: string[]): void {
  const k = keyOf(cellKey, turnTs);
  evict(k);
  const wav = pcm16ChunksToWav(chunks);
  urls.set(k, {
    url: URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" })),
    bytes: wav.length,
  });
  totalBytes += wav.length;
  for (const oldest of urls.keys()) {
    if (totalBytes <= MAX_AUDIO_BYTES || oldest === k) break;
    evict(oldest);
  }
}

export function getTurnAudio(cellKey: string, turnTs: number): string | undefined {
  return urls.get(keyOf(cellKey, turnTs))?.url;
}

export function clearTurnAudio(): void {
  for (const e of urls.values()) URL.revokeObjectURL(e.url);
  urls.clear();
  totalBytes = 0;
}
