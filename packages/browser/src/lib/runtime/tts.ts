// Browser-direct Gemini TTS for compare's cascade-column ear test: text
// columns synthesize a reply on demand so the cascade candidate is audible
// next to the s2s column (which recorded its real audio). Output is PCM16 @
// 24kHz base64 — the same wire format as the live sockets — so the chunks
// feed the existing replay cache/WAV path unchanged.
//
// Synthesis is lazy (first click) and billed to the user's own Google key;
// nothing here runs during a matrix run.

const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;

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

export async function synthesizeSpeech(text: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${GENERATE_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as GenerateResponse;
  if (!res.ok) throw new Error(body.error?.message || `TTS failed (${res.status}).`);
  const chunks = extractPcmChunks(body);
  if (chunks.length === 0) throw new Error("TTS returned no audio.");
  return chunks;
}
