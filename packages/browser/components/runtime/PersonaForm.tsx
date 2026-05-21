import { useSimulateStore } from "@/lib/store/simulate";
import { useSpecStore } from "@/lib/store/spec";
import { useSettingsStore } from "@/lib/store/settings";
import { generatePersonaPrompt } from "@ux4/core/runtime/personaGen";
import { useState } from "react";

interface PersonaFormProps {
  disabled: boolean;
}

export function PersonaForm({ disabled }: PersonaFormProps) {
  const personaPrompt = useSimulateStore((s) => s.personaPrompt);
  const autoRun = useSimulateStore((s) => s.autoRun);
  const contextVars = useSimulateStore((s) => s.contextVars);
  const personaTurnLimit = useSimulateStore((s) => s.personaTurnLimit);
  const personaTurnsLeft = useSimulateStore((s) => s.personaTurnsLeft);
  const setPersonaPrompt = useSimulateStore((s) => s.setPersonaPrompt);
  const setAutoRun = useSimulateStore((s) => s.setAutoRun);
  const setPersonaTurnLimit = useSimulateStore((s) => s.setPersonaTurnLimit);
  const spec = useSpecStore((s) => s.spec);
  const apiKey = useSettingsStore((s) => s.googleApiKey);
  const model = useSettingsStore((s) => s.googleModel);

  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const configured = personaPrompt.trim().length > 0;

  async function onGenerate() {
    if (!apiKey || !spec) return;
    if (configured) {
      const ok = window.confirm("Replace the current persona prompt with a generated one?");
      if (!ok) return;
    }
    setOpen(true);
    setGenerating(true);
    setGenError(null);
    try {
      const prompt = await generatePersonaPrompt({ spec, contextVars, apiKey, model });
      setPersonaPrompt(prompt);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="border-b border-zinc-200 bg-zinc-50/50">
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-zinc-600">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center text-left hover:text-zinc-900"
        >
          <span className="mr-1 text-zinc-400">{open ? "▾" : "▸"}</span>
          Persona
          <span className="ml-1 text-zinc-400">
            {configured ? "configured" : "empty"}
            {autoRun ? ` · ${personaTurnsLeft} left` : ""}
          </span>
        </button>
        <div className="flex items-center gap-1">
          {apiKey && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled || generating}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              title="Use the LLM to draft a persona prompt from the agent's purpose, business goals, and current variable values."
            >
              {generating ? "Generating…" : "✨ Generate"}
            </button>
          )}
          <input
            type="number"
            min={1}
            max={200}
            value={personaTurnLimit}
            onChange={(e) => setPersonaTurnLimit(parseInt(e.target.value, 10))}
            disabled={disabled || autoRun}
            title="Hard cap on user turns. Stops the loop if the agent gets stuck."
            className="w-10 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
          />
          <button
            type="button"
            onClick={() => setAutoRun(!autoRun)}
            disabled={!configured || !apiKey}
            title={
              !apiKey
                ? "Persona simulation uses the Google API key in Settings."
                : !configured
                  ? "Write a persona system prompt below to start."
                  : autoRun
                    ? "Stop the persona. An in-flight reply is dropped."
                    : "Start: persona runs for the configured number of turns, then pauses. Click again for more."
            }
            className={
              autoRun
                ? "rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-40"
                : "rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            }
          >
            {autoRun ? "■ Stop" : "▶ Start"}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-2 px-4 pb-3">
          {genError && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {genError}
            </div>
          )}
          <textarea
            value={personaPrompt}
            onChange={(e) => setPersonaPrompt(e.target.value)}
            disabled={disabled || generating}
            rows={8}
            placeholder={
              "System prompt for the persona playing the user.\n\nE.g.: You are a customer who ordered a laptop 3 days ago. The screen arrived cracked (order #12345). You are terse and impatient. Reply as the user would; emit [DONE] when satisfied."
            }
            className="w-full resize-y rounded border border-zinc-300 bg-white p-2 font-mono text-[11px] leading-snug text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:bg-zinc-50"
          />
          <p className="text-[10px] text-zinc-500">
            Persona drives the user side of the conversation when running. The agent&rsquo;s
            lines are sent to this prompt as user input; the model&rsquo;s reply becomes the next
            user turn. Saved per agent.
          </p>
        </div>
      )}
    </div>
  );
}
