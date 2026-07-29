import { bytesToBase64, floatTo16BitPCM } from "./audio";
import { S2S_AUDIO_SAMPLE_RATE } from "@flowstore/studies";

// Browser-direct TTS for compare's cascade-column ear test: text columns
// synthesize a reply on demand so the cascade candidate is audible next to
// the s2s column (which recorded its real audio). The vendor is the USER'S
// choice (settings → ear-test TTS) — the point is to sound like their
// cascade stack, not ours. All three vendors can emit raw PCM16 @ 24kHz —
// the same wire format as the live sockets — so the chunks feed the
// existing replay cache/WAV path unchanged.
//
// Synthesis is lazy (first click) and billed to the user's own key; nothing
// here runs during a matrix run. This module owns the provider vocabulary —
// the settings store consumes it (never the other way around).

export type TtsProvider = "gemini" | "openai" | "elevenlabs";

// The store-resolved dispatch for one synthesis call: provider, its ONE key,
// and the voice. Mirrors resolveDispatch's shape discipline — callers never
// juggle every vendor's key.
export type ResolvedTts = {
  provider: TtsProvider;
  voice: string;
  apiKey: string;
};

const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

type GenerateResponse = {
  candidates?: {
    content?: { parts?: { inlineData?: { data?: string } }[] };
  }[];
  error?: { message?: string };
};

// Pure extractor, split out for tests.
export function extractPcmChunks(resp: GenerateResponse): string[] {
  return (resp.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.inlineData?.data)
    .filter((d): d is string => Boolean(d));
}

async function ttsError(
  res: Response,
  vendor: string,
  pick: (body: unknown) => string | undefined,
): Promise<Error> {
  const body: unknown = await res.json().catch(() => ({}));
  return new Error(pick(body) || `${vendor} TTS failed (${res.status}).`);
}

async function synthesizeGemini(text: string, voice: string, apiKey: string): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Kore" } },
        },
      },
    }),
  });
  if (!res.ok) {
    throw await ttsError(res, "Gemini", (b) => (b as GenerateResponse).error?.message);
  }
  const chunks = extractPcmChunks((await res.json()) as GenerateResponse);
  if (chunks.length === 0) throw new Error("Gemini TTS returned no audio.");
  return chunks;
}

// Shared shape for the vendors that return raw PCM bytes.
async function fetchPcm(
  url: string,
  init: RequestInit,
  vendor: string,
  pickError: (body: unknown) => string | undefined,
): Promise<string[]> {
  const res = await fetch(url, init);
  if (!res.ok) throw await ttsError(res, vendor, pickError);
  return [bytesToBase64(new Uint8Array(await res.arrayBuffer()))];
}

function synthesizeOpenai(text: string, voice: string, apiKey: string): Promise<string[]> {
  return fetchPcm(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voice || "alloy",
        input: text,
        // Raw PCM16 @ 24kHz — the replay cache's native format.
        response_format: "pcm",
      }),
    },
    "OpenAI",
    (b) => (b as { error?: { message?: string } }).error?.message,
  );
}

// ElevenLabs gates raw PCM output formats behind paid tiers — free accounts
// get mp3. We take the mp3 and transcode to the cache's native PCM16@24k
// locally (WebAudio decode + offline resample), so the tier difference never
// reaches the replay pipeline.
async function synthesizeElevenlabs(text: string, voice: string, apiKey: string): Promise<string[]> {
  if (!voice.trim()) {
    throw new Error("ElevenLabs needs a voice id — set it in settings (ear-test TTS).");
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.trim())}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    },
  );
  if (!res.ok) {
    throw await ttsError(res, "ElevenLabs", (b) => {
      const detail = (b as { detail?: { message?: string } | string }).detail;
      return typeof detail === "string" ? detail : detail?.message;
    });
  }
  return mp3ToPcmChunks(await res.arrayBuffer());
}

// Decode compressed audio and resample to the s2s wire format. Browser-only
// (WebAudio) — which is where all synthesis happens anyway.
async function mp3ToPcmChunks(buf: ArrayBuffer): Promise<string[]> {
  const probe = new AudioContext();
  const decoded = await probe.decodeAudioData(buf);
  await probe.close();
  const off = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * S2S_AUDIO_SAMPLE_RATE),
    S2S_AUDIO_SAMPLE_RATE,
  );
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const pcm = floatTo16BitPCM(rendered.getChannelData(0));
  return [bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))];
}

// One table answers every per-vendor question: adding a vendor is one entry.
const VENDORS: Record<
  TtsProvider,
  (text: string, voice: string, apiKey: string) => Promise<string[]>
> = {
  gemini: synthesizeGemini,
  openai: synthesizeOpenai,
  elevenlabs: synthesizeElevenlabs,
};

export function synthesizeSpeech(text: string, tts: ResolvedTts): Promise<string[]> {
  if (!tts.apiKey.trim()) {
    return Promise.reject(new Error(`No API key for ${tts.provider} TTS.`));
  }
  return VENDORS[tts.provider](text, tts.voice, tts.apiKey);
}
