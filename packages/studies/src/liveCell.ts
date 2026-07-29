import type { ChatUsage } from "@flowstore/core/llm/types";
import {
  TurnAccumulator,
  runS2sCell,
  type RunS2sCellArgs,
  type S2sConnect,
  type S2sTurn,
} from "./s2sCell";

// Gemini Live vendor half of the s2s cell: the parser (Live message stream →
// TurnAccumulator) and the transport (ai.live.connect). The turn loop and
// CellState protocol live in s2sCell.

// Back-compat alias — the accumulator's flush type predates the shared
// skeleton under this name.
export type LiveTurnResult = S2sTurn;
export { LIVE_AUDIO_SAMPLE_RATE } from "./s2sCell";

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
    ...(input && input.audio > 0 ? { audioInputTokens: input.audio } : {}),
    ...(output && output.audio > 0 ? { audioOutputTokens: output.audio } : {}),
  };
}

// Parses the interleaved Live message stream into TurnAccumulator calls.
// One instance per session; feed() every message.
export class LiveTurnCollector {
  private acc: TurnAccumulator;
  ready = false;

  constructor(onTurn: (turn: LiveTurnResult) => void) {
    this.acc = new TurnAccumulator(onTurn);
  }

  markSent(now: number): void {
    this.acc.markSent(now);
  }

  feed(msg: LiveServerEvent, now: number): void {
    if (msg.setupComplete) this.ready = true;
    const content = msg.serverContent;
    for (const p of content?.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) this.acc.addAudio(p.inlineData.data, now);
    }
    this.acc.addText(content?.outputTranscription?.text ?? "", now);
    if (msg.usageMetadata) this.acc.setUsage(usageFromLiveMetadata(msg.usageMetadata));
    if (content?.turnComplete) this.acc.complete(now);
  }
}

const connectGeminiLive: S2sConnect = async ({
  dispatch,
  systemPrompt,
  onTurn,
  onReady,
  onFatal,
}) => {
  const collector = new LiveTurnCollector(onTurn);
  // SDK loaded lazily: only a live run pays for it, and importing the engine
  // (runner → liveCell) stays side-effect-free for node tests.
  const { GoogleGenAI, Modality } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: dispatch.apiKey });
  const session = await ai.live.connect({
    model: dispatch.wireModel,
    callbacks: {
      onmessage: (msg: unknown) => {
        collector.feed(msg as LiveServerEvent, Date.now());
        if (collector.ready) onReady();
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
      collector.markSent(Date.now());
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
