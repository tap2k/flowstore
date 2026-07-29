import { pcm16ChunksToWav } from "./audio";

// Browser-direct TTS for the ear test — compare's cascade columns and
// simulate's transcripts both synthesize replies on demand so the spoken
// form is audible next to (or in place of) real s2s audio. The vendor is
// the USER'S choice (settings → ear-test TTS) — the point is to sound like
// their cascade stack, not ours.
//
// Synthesis is lazy (first click) and billed to the user's own key; nothing
// here runs during a matrix run. Every vendor returns a ready-to-play Blob:
// mp3 wherever the vendor can serve a container (every tier supports it, and
// <audio> plays it natively — no transcoding); Gemini's TTS only emits raw
// PCM, so it alone gets the WAV wrap. This module owns the provider
// vocabulary — the settings store consumes it (never the other way around).

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

async function synthesizeGemini(text: string, voice: string, apiKey: string): Promise<Blob> {
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
  const wav = pcm16ChunksToWav(chunks);
  return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
}

// Shared fetch for the vendors that return mp3 bytes directly.
async function fetchMp3(
  url: string,
  init: RequestInit,
  vendor: string,
  pickError: (body: unknown) => string | undefined,
): Promise<Blob> {
  const res = await fetch(url, init);
  if (!res.ok) throw await ttsError(res, vendor, pickError);
  return new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
}

function synthesizeOpenai(text: string, voice: string, apiKey: string): Promise<Blob> {
  return fetchMp3(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voice || "alloy",
        input: text,
        response_format: "mp3",
      }),
    },
    "OpenAI",
    (b) => (b as { error?: { message?: string } }).error?.message,
  );
}

// ElevenLabs gates raw PCM output behind paid tiers; mp3 is the every-tier
// format (and the free tier also rejects LIBRARY voices via API — use a
// voice from the account's own list).
function synthesizeElevenlabs(text: string, voice: string, apiKey: string): Promise<Blob> {
  if (!voice.trim()) {
    return Promise.reject(
      new Error("ElevenLabs needs a voice id — set it in settings (ear-test TTS)."),
    );
  }
  return fetchMp3(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.trim())}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    },
    "ElevenLabs",
    (b) => {
      const detail = (b as { detail?: { message?: string } | string }).detail;
      return typeof detail === "string" ? detail : detail?.message;
    },
  );
}

// One table answers every per-vendor question: adding a vendor is one entry.
const VENDORS: Record<
  TtsProvider,
  (text: string, voice: string, apiKey: string) => Promise<Blob>
> = {
  gemini: synthesizeGemini,
  openai: synthesizeOpenai,
  elevenlabs: synthesizeElevenlabs,
};

export function synthesizeSpeech(text: string, tts: ResolvedTts): Promise<Blob> {
  if (!tts.apiKey.trim()) {
    return Promise.reject(new Error(`No API key for ${tts.provider} TTS.`));
  }
  return VENDORS[tts.provider](text, tts.voice, tts.apiKey);
}
