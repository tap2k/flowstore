import type { TtsProvider } from "@/lib/store/settings";

// Browser-direct TTS for compare's cascade-column ear test: text columns
// synthesize a reply on demand so the cascade candidate is audible next to
// the s2s column (which recorded its real audio). The vendor is the USER'S
// choice (settings → ear-test TTS) — the point is to sound like their
// cascade stack, not ours. All three vendors can emit raw PCM16 @ 24kHz —
// the same wire format as the live sockets — so the chunks feed the
// existing replay cache/WAV path unchanged.
//
// Synthesis is lazy (first click) and billed to the user's own key; nothing
// here runs during a matrix run.

export type TtsConfig = {
  provider: TtsProvider;
  // Vendor voice name/id. Blank picks a vendor default where one exists;
  // ElevenLabs requires a voice id.
  voice: string;
  googleApiKey: string;
  openaiApiKey: string;
  elevenlabsApiKey: string;
};

// The key the chosen provider needs — the ▶ hear affordance is gated on it.
export function ttsKeyFor(cfg: TtsConfig): string {
  switch (cfg.provider) {
    case "gemini":
      return cfg.googleApiKey.trim();
    case "openai":
      return cfg.openaiApiKey.trim();
    case "elevenlabs":
      return cfg.elevenlabsApiKey.trim();
  }
}

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // avoid String.fromCharCode arg-count limits
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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
  const body = (await res.json().catch(() => ({}))) as GenerateResponse;
  if (!res.ok) throw new Error(body.error?.message || `TTS failed (${res.status}).`);
  const chunks = extractPcmChunks(body);
  if (chunks.length === 0) throw new Error("TTS returned no audio.");
  return chunks;
}

async function synthesizeOpenai(text: string, voice: string, apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: voice || "alloy",
      input: text,
      // Raw PCM16 @ 24kHz — the replay cache's native format.
      response_format: "pcm",
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message || `TTS failed (${res.status}).`);
  }
  return [bytesToBase64(new Uint8Array(await res.arrayBuffer()))];
}

async function synthesizeElevenlabs(text: string, voice: string, apiKey: string): Promise<string[]> {
  if (!voice.trim()) {
    throw new Error("ElevenLabs needs a voice id — set it in settings (ear-test TTS).");
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.trim())}?output_format=pcm_24000`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: { message?: string } | string;
    };
    const detail = typeof body.detail === "string" ? body.detail : body.detail?.message;
    throw new Error(detail || `TTS failed (${res.status}).`);
  }
  return [bytesToBase64(new Uint8Array(await res.arrayBuffer()))];
}

export async function synthesizeSpeech(text: string, cfg: TtsConfig): Promise<string[]> {
  const key = ttsKeyFor(cfg);
  switch (cfg.provider) {
    case "gemini":
      return synthesizeGemini(text, cfg.voice, key);
    case "openai":
      return synthesizeOpenai(text, cfg.voice, key);
    case "elevenlabs":
      return synthesizeElevenlabs(text, cfg.voice, key);
  }
}
