import { useState } from "react";
import { SheetShell } from "./SheetShell";
import { useSettingsStore, DEFAULT_RUNNER_URL } from "@/lib/store/settings";
import { GOOGLE_MODELS } from "@ux4/core/llm/dispatch";
import { makeGitHubClient, testConnection } from "@ux4/core/files/github";

interface SettingsSheetProps {
  onClose: () => void;
}

type GhTestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; login: string; name?: string }
  | { kind: "err"; message: string };

export function SettingsSheet({ onClose }: SettingsSheetProps) {
  const stored = useSettingsStore((s) => s.googleApiKey);
  const setGoogleApiKey = useSettingsStore((s) => s.setGoogleApiKey);
  const storedModel = useSettingsStore((s) => s.googleModel);
  const setGoogleModel = useSettingsStore((s) => s.setGoogleModel);
  const storedRunnerUrl = useSettingsStore((s) => s.runnerUrl);
  const setRunnerUrl = useSettingsStore((s) => s.setRunnerUrl);
  const storedGithubPat = useSettingsStore((s) => s.githubPat);
  const setGithubPat = useSettingsStore((s) => s.setGithubPat);
  const [value, setValue] = useState(stored);
  const [model, setModel] = useState(storedModel);
  const [runnerUrl, setRunnerUrlInput] = useState(storedRunnerUrl);
  const [pat, setPat] = useState(storedGithubPat);
  const [reveal, setReveal] = useState(false);
  const [patReveal, setPatReveal] = useState(false);
  const [ghStatus, setGhStatus] = useState<GhTestStatus>({ kind: "idle" });

  function save() {
    setGoogleApiKey(value.trim());
    setGoogleModel(model);
    setRunnerUrl(runnerUrl);
    setGithubPat(pat);
    onClose();
  }

  function clear() {
    setValue("");
    setGoogleApiKey("");
  }

  async function testGithub() {
    const trimmed = pat.trim();
    if (!trimmed) {
      setGhStatus({ kind: "err", message: "paste a PAT first" });
      return;
    }
    setGhStatus({ kind: "testing" });
    try {
      const info = await testConnection(makeGitHubClient(trimmed));
      setGhStatus({ kind: "ok", login: info.login, name: info.name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "connection failed";
      setGhStatus({ kind: "err", message: msg });
    }
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
      <div className="space-y-2 pt-3">
        <label className="text-xs font-medium text-zinc-700">GitHub PAT</label>
        <div className="flex gap-2">
          <input
            type={patReveal ? "text" : "password"}
            value={pat}
            onChange={(e) => {
              setPat(e.target.value);
              setGhStatus({ kind: "idle" });
            }}
            placeholder="ghp_… or github_pat_…"
            className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <button
            onClick={() => setPatReveal((r) => !r)}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            {patReveal ? "hide" : "show"}
          </button>
          <button
            onClick={testGithub}
            disabled={ghStatus.kind === "testing" || !pat.trim()}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
          >
            {ghStatus.kind === "testing" ? "Testing…" : "Test"}
          </button>
        </div>
        {ghStatus.kind === "ok" && (
          <p className="text-[11px] text-emerald-700">
            Connected as <span className="font-mono">{ghStatus.login}</span>
            {ghStatus.name ? ` (${ghStatus.name})` : ""}.
          </p>
        )}
        {ghStatus.kind === "err" && (
          <p className="text-[11px] text-rose-700">{ghStatus.message}</p>
        )}
        <p className="text-[11px] text-zinc-500">
          Fine-grained PAT with Contents: Read &amp; write on the repos you want UX4 to open. Stored in
          this browser&apos;s localStorage. Create at{" "}
          <a
            href="https://github.com/settings/personal-access-tokens"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zinc-900"
          >
            github.com/settings/personal-access-tokens
          </a>
          .
        </p>
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
