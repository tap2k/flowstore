import { useState } from "react";
import { SheetShell } from "./SheetShell";
import { useSettingsStore, DEFAULT_RUNNER_URL } from "@/lib/store/settings";
import { GOOGLE_MODELS } from "@/lib/llm/dispatch";

interface SettingsSheetProps {
  onClose: () => void;
}

export function SettingsSheet({ onClose }: SettingsSheetProps) {
  const stored = useSettingsStore((s) => s.googleApiKey);
  const setGoogleApiKey = useSettingsStore((s) => s.setGoogleApiKey);
  const storedModel = useSettingsStore((s) => s.googleModel);
  const setGoogleModel = useSettingsStore((s) => s.setGoogleModel);
  const storedRunnerUrl = useSettingsStore((s) => s.runnerUrl);
  const setRunnerUrl = useSettingsStore((s) => s.setRunnerUrl);
  const [value, setValue] = useState(stored);
  const [model, setModel] = useState(storedModel);
  const [runnerUrl, setRunnerUrlInput] = useState(storedRunnerUrl);
  const [reveal, setReveal] = useState(false);

  function save() {
    setGoogleApiKey(value.trim());
    setGoogleModel(model);
    setRunnerUrl(runnerUrl);
    onClose();
  }

  function clear() {
    setValue("");
    setGoogleApiKey("");
  }

  return (
    <SheetShell
      title="Settings"
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-700">Google API key</label>
        <div className="flex gap-2">
          <input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="AIza…"
            className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <button
            onClick={() => setReveal((r) => !r)}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            {reveal ? "hide" : "show"}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          Only for chat / simulate. Stored in this browser&apos;s localStorage. Anyone with access to this browser can read it. 
          Get a key at{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zinc-900"
          >
            aistudio.google.com
          </a>
          .
        </p>
      </div>
      <div className="space-y-2 pt-3">
        <label className="text-xs font-medium text-zinc-700">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
        >
          {GOOGLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2 pt-3">
        <label className="text-xs font-medium text-zinc-700">Runner URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={runnerUrl}
            onChange={(e) => setRunnerUrlInput(e.target.value)}
            placeholder={DEFAULT_RUNNER_URL}
            className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={clear}
          disabled={!stored && !value}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
        >
          Clear
        </button>
        <button
          onClick={save}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
        >
          Save
        </button>
      </div>
    </SheetShell>
  );
}
