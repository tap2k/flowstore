// Browser audio plumbing for the Simulation panel's voice mode. Two halves:
//
//   MicCapture  — getUserMedia → AudioWorklet → mono PCM16 frames at the
//                 socket's rate (16 kHz for Gemini Live, 24 kHz for the
//                 Realtime vendors), base64-encoded, handed to a callback.
//   AudioPlayer — base64 PCM16 @ 24 kHz chunks from the model, decoded and
//                 scheduled gaplessly on an output AudioContext, with a
//                 flush() for barge-in (the model interrupts itself).
//
// All vendors speak raw little-endian PCM; output is uniformly 24 kHz mono
// (S2S_AUDIO_SAMPLE_RATE), input rate is per-vendor via MicCapture's
// constructor.

import workletUrl from "./capture-worklet.js?url";
import { S2S_AUDIO_SAMPLE_RATE } from "@flowstore/studies";

const INPUT_SAMPLE_RATE = 16000;
// Output rate is owned by the engine constant so live playback (here) and
// replay WAVs (pcm16ChunksToWav) can never disagree about what 24 kHz means.
const OUTPUT_SAMPLE_RATE = S2S_AUDIO_SAMPLE_RATE;

function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Nearest-sample decimation from the device rate to the target. Linear-enough for
// ASR; we're not preserving fidelity, just intelligibility for the model.
function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    out[i] = samples[Math.floor(i * ratio)];
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // avoid String.fromCharCode arg-count limits
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function int16ToBase64(pcm: Int16Array): string {
  return bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64ToInt16(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  // The model always sends an even byte count (16-bit samples); guard anyway.
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

// Concatenate base64 PCM16 chunks into one decoded byte array.
export function pcm16ChunksToBytes(chunks: string[]): Uint8Array {
  const bins = chunks.map(base64ToBytes);
  const out = new Uint8Array(bins.reduce((a, b) => a + b.length, 0));
  let off = 0;
  for (const b of bins) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

// Wrap raw PCM16 bytes (s2s output: 24kHz mono) in a RIFF/WAV header so a
// plain <audio>/Audio element can play them. Lives beside the player so the
// consumers of the wire format share one decoder and one rate.
export function pcm16BytesToWav(data: Uint8Array): Uint8Array {
  const dataLen = data.length;
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
  v.setUint32(24, OUTPUT_SAMPLE_RATE, true);
  v.setUint32(28, OUTPUT_SAMPLE_RATE * 2, true); // byte rate (16-bit mono)
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataLen, true);
  const out = new Uint8Array(buf);
  out.set(data, 44);
  return out;
}

export function pcm16ChunksToWav(chunks: string[]): Uint8Array {
  return pcm16BytesToWav(pcm16ChunksToBytes(chunks));
}

// Captures the mic as base64 PCM16 @ 16 kHz and pushes each frame to onChunk.
// `muted` gates emission without tearing down the graph, so toggling the mic
// is instant and doesn't re-prompt for permission.
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  muted = false;

  // sampleRate: what the socket expects — 16k for Gemini Live, 24k for the
  // Realtime-protocol vendors.
  constructor(
    private onChunk: (base64Pcm16: string) => void,
    private sampleRate: number = INPUT_SAMPLE_RATE,
  ) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "flowstore-capture");
    const fromRate = this.ctx.sampleRate;
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.muted) return;
      const down = downsample(e.data, fromRate, this.sampleRate);
      this.onChunk(int16ToBase64(floatTo16BitPCM(down)));
    };
    this.source.connect(this.node);
    // The worklet must be in the graph to pull audio, but we don't want it
    // audible — route to a zero-gain sink rather than destination.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctx.destination);
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}

// Schedules model audio chunks gaplessly and reports playing/idle transitions
// so the panel can show a "speaking" indicator. flush() drops everything
// queued — used on barge-in when the model says it was interrupted.
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private onPlayingChange?: (playing: boolean) => void) {}

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.nextStartTime = this.ctx.currentTime;
    }
    return this.ctx;
  }

  enqueue(base64Pcm24: string): void {
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") void ctx.resume();
    const pcm = base64ToInt16(base64Pcm24);
    if (pcm.length === 0) return;
    const buffer = ctx.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    // Never schedule in the past — if we've drained, start from now.
    this.nextStartTime = Math.max(this.nextStartTime, ctx.currentTime);
    src.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.sources.add(src);
    this.setPlaying(true);
    src.onended = () => {
      this.sources.delete(src);
      // Only flip to idle once the whole queue has drained.
      if (this.sources.size === 0) this.scheduleIdle();
    };
  }

  // Barge-in: stop and discard everything in flight, reset the cursor.
  flush(): void {
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    if (this.ctx) this.nextStartTime = this.ctx.currentTime;
    this.setPlaying(false);
  }

  close(): void {
    this.flush();
    void this.ctx?.close();
    this.ctx = null;
  }

  private playing = false;
  private setPlaying(p: boolean): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (p === this.playing) return;
    this.playing = p;
    this.onPlayingChange?.(p);
  }

  // Debounce the idle flip so brief gaps between chunks don't flicker the
  // indicator off and back on.
  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.setPlaying(false), 150);
  }
}
