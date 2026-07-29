import { useState, useSyncExternalStore } from "react";
import {
  getOrSynthesizeTurnAudio,
  hasTurnAudio,
  peekTurnAudioUrl,
  subscribeTurnAudio,
  turnAudioVersion,
} from "@/lib/runtime/audioCache";
import { StatusIcon } from "@/components/ui";

// Replay a spoken reply (compare's s2s columns, simulate's voice/TTS turns). One module-level element and one source of
// truth for what's playing (the URL), published through a tiny external
// store — every button derives its own playing state from it, so starting a
// reply reliably flips the previous button back to "hear" (columns would
// cacophony otherwise, and HTMLAudioElement pause events arrive async).
const replay = (() => {
  const el = typeof Audio !== "undefined" ? new Audio() : null;
  let playingUrl: string | null = null;
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((cb) => cb());
  if (el) el.onended = el.onpause = () => {
    playingUrl = null;
    notify();
  };
  return {
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    playingUrl: () => playingUrl,
    toggle: (url: string) => {
      if (!el) return;
      if (playingUrl === url) {
        el.pause();
        return;
      }
      el.src = url;
      playingUrl = url;
      notify();
      void el.play();
    },
  };
})();

export function ReplayButton({
  cellKey,
  ts,
  synth,
}: {
  cellKey: string;
  ts: number;
  // Text columns only: synthesize the reply (the user's ear-test TTS vendor)
  // on first click and cache it like an s2s recording. s2s columns replay
  // the run's real audio and never synthesize. In-flight dedupe lives in the
  // cache (getOrSynthesize), not here — a second click or a second render of
  // the same turn must never double-bill.
  synth?: () => Promise<Blob>;
}) {
  const playingUrl = useSyncExternalStore(replay.subscribe, replay.playingUrl);
  // Self-sufficient cache subscription (don't rely on the page's) — memoize
  // a column and this still updates.
  useSyncExternalStore(subscribeTurnAudio, turnAudioVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // peek never builds — the WAV encode happens on click only.
  const playing = playingUrl !== null && peekTurnAudioUrl(cellKey, ts) === playingUrl;
  // Audio already in the cache → the click is free (replay). Otherwise the
  // label says "tts" so the cost of the click is legible before clicking.
  const cached = hasTurnAudio(cellKey, ts);
  const onClick = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const u = await getOrSynthesizeTurnAudio(cellKey, ts, synth ?? (() => Promise.reject(new Error("No audio for this reply."))));
      if (u) replay.toggle(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "TTS failed.");
    } finally {
      setBusy(false);
    }
  };
  const state = busy ? "synth" : playing ? "playing" : error ? "error" : cached ? "cached" : "new";
  const TITLES = {
    synth: "Synthesizing…",
    playing: "Stop",
    error: error ?? "TTS failed.",
    cached: "Hear this reply (already generated — free to replay)",
    new: "Synthesize and hear this reply — your ear-test TTS vendor (settings), then kept for this session",
  } as const;
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={TITLES[state]}
      className={`cursor-pointer ${state === "error" ? "text-state-error-fg" : "text-text-tertiary hover:text-text-primary"}`}
    >
      {state === "synth" ? (
        <span className="inline-flex items-center gap-1">
          <StatusIcon status="running" size={11} />
          tts…
        </span>
      ) : state === "playing" ? (
        "◼ stop"
      ) : state === "error" ? (
        "✕ tts"
      ) : state === "cached" ? (
        "▶ hear"
      ) : (
        "▶ tts"
      )}
    </button>
  );
}
