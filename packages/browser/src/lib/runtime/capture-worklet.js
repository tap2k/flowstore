// AudioWorklet processor for MicCapture (audio.ts). Forwards raw mono Float32
// frames to the main thread; downsampling + PCM conversion happen there
// (cheaper to keep the audio-thread code trivial). A real file imported via
// Vite's `?url` — not an inline Blob URL — so it loads under a CSP whose
// script-src has no `blob:` (worklet module loads are governed by script-src).
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
registerProcessor("flowstore-capture", CaptureProcessor);
