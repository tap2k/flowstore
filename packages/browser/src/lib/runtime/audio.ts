// Browser audio plumbing for the Simulation panel's voice mode. Two halves:
//
//   MicCapture  — getUserMedia → AudioWorklet → mono PCM16 @ 16 kHz frames,
//                 base64-encoded, handed to a callback for the Live socket.
//   AudioPlayer — base64 PCM16 @ 24 kHz chunks from the model, decoded and
//                 scheduled gaplessly on an output AudioContext, with a
//                 flush() for barge-in (the model interrupts itself).
//
// The Gemini Live API speaks raw little-endian PCM: 16 kHz mono in, 24 kHz
// mono out. These are the only two rates here; nothing else negotiates them.

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Inline AudioWorklet processor. Forwards raw mono Float32 frames to the main
// thread; downsampling + PCM conversion happen there (cheaper to keep the
// audio-thread code trivial). Shipped as a Blob URL so there's no separate
// worklet file for Vite to special-case.
const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Copy — the underlying buffer is reused by the audio thread.
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('flowstore-capture', CaptureProcessor);
`;

function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Nearest-sample decimation from the device rate to 16 kHz. Linear-enough for
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

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const CHUNK = 0x8000; // avoid String.fromCharCode arg-count limits
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // The model always sends an even byte count (16-bit samples); guard anyway.
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

// Captures the mic as base64 PCM16 @ 16 kHz and pushes each frame to onChunk.
// `muted` gates emission without tearing down the graph, so toggling the mic
// is instant and doesn't re-prompt for permission.
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletUrl: string | null = null;
  muted = false;

  constructor(private onChunk: (base64Pcm16: string) => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext();
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    this.workletUrl = URL.createObjectURL(blob);
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "flowstore-capture");
    const fromRate = this.ctx.sampleRate;
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.muted) return;
      const down = downsample(e.data, fromRate, INPUT_SAMPLE_RATE);
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
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
    this.workletUrl = null;
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
