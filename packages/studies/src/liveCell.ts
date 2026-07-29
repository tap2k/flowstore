import type { ChatUsage } from "@flowstore/core/llm/types";
import { runS2sCell, type RunS2sCellArgs, type S2sConnect, type TurnAccumulator } from "./s2sCell";

// Gemini Live vendor half of the s2s cell: the parser (Live message stream →
// TurnAccumulator) and the transport (ai.live.connect). The turn loop and
// CellState protocol live in s2sCell.

// Structural mirror of @google/genai's LiveServerMessage, kept local so the
// parser (and its tests) never import the SDK.
export type LiveServerEvent = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    responseTokenCount?: number;
    cachedContentTokenCount?: number;
    promptTokensDetails?: { modality?: string; tokenCount?: number }[];
    responseTokensDetails?: { modality?: string; tokenCount?: number }[];
  };
};

// Map Live usageMetadata to ChatUsage: TEXT details → inputTokens/outputTokens
// (kept text-only), AUDIO details → audioInputTokens/audioOutputTokens. When
// the modality breakdown is absent, fall back to the flat prompt/response
// counts as text so tokens are never silently dropped.
export function usageFromLiveMetadata(
  meta: NonNullable<LiveServerEvent["usageMetadata"]>,
): ChatUsage {
  const byModality = (details: { modality?: string; tokenCount?: number }[] | undefined) => {
    let text = 0;
    let audio = 0;
    let seen = false;
    for (const d of details ?? []) {
      seen = true;
      if ((d.modality ?? "").toUpperCase().includes("AUDIO")) audio += d.tokenCount ?? 0;
      else text += d.tokenCount ?? 0;
    }
    return seen ? { text, audio } : null;
  };
  const input = byModality(meta.promptTokensDetails);
  const output = byModality(meta.responseTokensDetails);
  return {
    inputTokens: input ? input.text : (meta.promptTokenCount ?? 0),
    outputTokens: output ? output.text : (meta.responseTokenCount ?? 0),
    ...(meta.cachedContentTokenCount ? { cachedInputTokens: meta.cachedContentTokenCount } : {}),
    ...(input && input.audio > 0 ? { audioInputTokens: input.audio } : {}),
    ...(output && output.audio > 0 ? { audioOutputTokens: output.audio } : {}),
  };
}

// Parse one Live message into accumulator calls. Returns true when the
// message signals session readiness (setupComplete).
export function feedLiveEvent(acc: TurnAccumulator, msg: LiveServerEvent, now: number): boolean {
  const content = msg.serverContent;
  for (const p of content?.modelTurn?.parts ?? []) {
    if (p.inlineData?.data) acc.addAudio(p.inlineData.data, now);
  }
  acc.addText(content?.outputTranscription?.text ?? "", now);
  if (msg.usageMetadata) acc.setUsage(usageFromLiveMetadata(msg.usageMetadata));
  if (content?.turnComplete) acc.complete(now);
  return Boolean(msg.setupComplete);
}

const connectGeminiLive: S2sConnect = async ({ dispatch, systemPrompt, acc, onReady, onFatal }) => {
  // SDK loaded lazily: only a live run pays for it, and importing the engine
  // (runner → liveCell) stays side-effect-free for node tests.
  const { GoogleGenAI, Modality } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: dispatch.apiKey });
  let readySent = false;
  const session = await ai.live.connect({
    model: dispatch.wireModel,
    callbacks: {
      onmessage: (msg: unknown) => {
        if (feedLiveEvent(acc, msg as LiveServerEvent, Date.now()) && !readySent) {
          readySent = true;
          onReady();
        }
      },
      onerror: (e: { message?: string }) => {
        onFatal(new Error(e.message || "Live socket error."));
      },
      onclose: () => {
        onFatal(new Error("Live session closed unexpectedly."));
      },
    },
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: systemPrompt,
      outputAudioTranscription: {},
    },
  });
  return {
    sendUserTurn: (text: string) => {
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    },
    close: () => session.close(),
  };
};

export function runLiveCell(args: RunS2sCellArgs): Promise<void> {
  return runS2sCell(args, connectGeminiLive, "Live");
}
