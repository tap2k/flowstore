import { useState } from "react";
import { SheetShell } from "./SheetShell";
import { useSettingsStore, DEFAULT_RUNNER_URL, DEFAULT_MODEL_ID } from "@/lib/store/settings";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { makeGitHubClient, testConnection } from "@flowstore/core/files/github";

interface SettingsSheetProps {
  onClose: () => void;
}

type GhTestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; login: string; name?: string }
  | { kind: "err"; message: string };

export function SettingsSheet({ onClose }: SettingsSheetProps) {
  const storedGoogle = useSettingsStore((s) => s.googleApiKey);
  const setGoogleApiKey = useSettingsStore((s) => s.setGoogleApiKey);
  const storedOpenai = useSettingsStore((s) => s.openaiApiKey);
  const setOpenaiApiKey = useSettingsStore((s) => s.setOpenaiApiKey);
  const storedOpenrouter = useSettingsStore((s) => s.openrouterApiKey);
  const setOpenrouterApiKey = useSettingsStore((s) => s.setOpenrouterApiKey);
  const storedRunnerUrl = useSettingsStore((s) => s.runnerUrl);
  const setRunnerUrl = useSettingsStore((s) => s.setRunnerUrl);
  const storedGithubPat = useSettingsStore((s) => s.githubPat);
  const setGithubPat = useSettingsStore((s) => s.setGithubPat);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setGenerateModel = useSettingsStore((s) => s.setGenerateModel);

  const [google, setGoogle] = useState(storedGoogle);
  const [openai, setOpenai] = useState(storedOpenai);
  const [openrouter, setOpenrouter] = useState(storedOpenrouter);
  const [runnerUrl, setRunnerUrlInput] = useState(storedRunnerUrl);
  const [pat, setPat] = useState(storedGithubPat);
  const [patReveal, setPatReveal] = useState(false);
  const [ghStatus, setGhStatus] = useState<GhTestStatus>({ kind: "idle" });
  // Two-step guard: first click arms, second click wipes. Clearing erases
  // API keys and the GitHub PAT from localStorage, so a stray click is costly.
  const [clearArmed, setClearArmed] = useState(false);

  function save() {
    setGoogleApiKey(google.trim());
    setOpenaiApiKey(openai.trim());
    setOpenrouterApiKey(openrouter.trim());
    setRunnerUrl(runnerUrl);
    setGithubPat(pat);
    onClose();
  }

  // Wipe every stored setting: keys + PAT (and cached identity) from
  // localStorage, runner URL, and the default model back to the built-in.
  // Drafts reset too so the open sheet reflects the cleared state.
  function clearAll() {
    setGoogleApiKey("");
    setOpenaiApiKey("");
    setOpenrouterApiKey("");
    setRunnerUrl("");
    setGithubPat("");
    setGenerateModel(DEFAULT_MODEL_ID);
    setGoogle("");
    setOpenai("");
    setOpenrouter("");
    setRunnerUrlInput("");
    setPat("");
    setGhStatus({ kind: "idle" });
    setClearArmed(false);
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
      bodyClass="flex-1 overflow-auto px-5 py-4 space-y-4"
    >
      <ApiKeyRow
        label="Google API key"
        placeholder="AIza…"
        value={google}
        onChange={setGoogle}
        help={
          <>
            For Gemini models. Get a key at{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-text-primary"
            >
              aistudio.google.com
            </a>
            .
          </>
        }
      />
      <ApiKeyRow
        label="OpenAI API key"
        placeholder="sk-…"
        value={openai}
        onChange={setOpenai}
        help={
          <>
            For GPT models. Get a key at{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-text-primary"
            >
              platform.openai.com/api-keys
            </a>
            .
          </>
        }
      />
      <ApiKeyRow
        label="OpenRouter API key"
        placeholder="sk-or-…"
        value={openrouter}
        onChange={setOpenrouter}
        help={
          <>
            For any
            other model OpenRouter hosts. Get a key at{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-text-primary"
            >
              openrouter.ai/keys
            </a>
            .
          </>
        }
      />

      <div className="space-y-2">
        <label className="fs-label text-text-secondary">Default model</label>
        <ModelPicker
          value={defaultModel}
          onChange={setGenerateModel}
          showUnconfigured
          structuredOnly
          keyOverrides={{ google: google.trim(), openai: openai.trim() }}
          className="w-full rounded border border-border-default px-2 py-1.5 fs-body focus:outline-none focus:ring-1 focus:ring-focus-ring"
        />
        <p className="text-[11px] text-text-tertiary">
          Used wherever no explicit model is picked — generating personas,
          variables and mocks, and translating transcripts. Pick a structured-output model (Gemini or GPT). 
        </p>
      </div>

      <div className="space-y-2">
        <label className="fs-label text-text-secondary">GitHub PAT</label>
        <div className="flex gap-2">
          <input
            type={patReveal ? "text" : "password"}
            value={pat}
            onChange={(e) => {
              setPat(e.target.value);
              setGhStatus({ kind: "idle" });
            }}
            placeholder="ghp_… or github_pat_…"
            className="flex-1 rounded border border-border-default px-2 py-1.5 fs-data focus:outline-none focus:ring-1 focus:ring-focus-ring"
          />
          <button
            onClick={() => setPatReveal((r) => !r)}
            className="rounded-md border border-border-default px-2 py-1 fs-caption text-text-secondary hover:bg-surface-hover"
          >
            {patReveal ? "hide" : "show"}
          </button>
          <button
            onClick={testGithub}
            disabled={ghStatus.kind === "testing" || !pat.trim()}
            className="rounded-md border border-border-default px-2 py-1 fs-caption text-text-secondary hover:bg-surface-hover disabled:opacity-40"
          >
            {ghStatus.kind === "testing" ? "testing…" : "test"}
          </button>
        </div>
        {ghStatus.kind === "ok" && (
          <p className="text-[11px] text-state-success-fg">
            Connected as <span className="font-mono">{ghStatus.login}</span>
            {ghStatus.name ? ` (${ghStatus.name})` : ""}.
          </p>
        )}
        {ghStatus.kind === "err" && (
          <p className="text-[11px] text-state-error-fg">{ghStatus.message}</p>
        )}
        <p className="text-[11px] text-text-tertiary">
          Fine-grained PAT. Set <span className="font-medium">Repository access</span> to
          {" "}<span className="font-medium">All repositories</span> (needed to create new
          projects), and grant these <span className="font-medium">Permissions</span>:
          {" "}<span className="font-mono">Contents: Read &amp; write</span> and
          {" "}<span className="font-mono">Administration: Read &amp; write</span> (for
          creating repos and managing collaborators). Create at{" "}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-text-primary"
          >
            github.com/settings/personal-access-tokens
          </a>
          .
        </p>
      </div>

      {/* Deliberately circular — a fresh prod session can't reach the runner
          tier while the runner is a dev-only prototype. Drop the wrapper when
          it ships; the runner-gated editors key off runnerUrl and follow. */}
      {(import.meta.env.VITE_DEV === "1" || storedRunnerUrl !== "") && (
        <div className="space-y-2">
          <label className="fs-label text-text-secondary">Runner URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={runnerUrl}
              onChange={(e) => setRunnerUrlInput(e.target.value)}
              placeholder={DEFAULT_RUNNER_URL}
              className="flex-1 rounded border border-border-default px-2 py-1.5 fs-data focus:outline-none focus:ring-1 focus:ring-focus-ring"
            />
          </div>
          <p className="text-[11px] text-text-tertiary">
            Endpoint for the Python runner backing Simulate&apos;s runner mode.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => (clearArmed ? clearAll() : setClearArmed(true))}
            className="rounded-md border border-state-error-line px-3 py-1.5 fs-label text-state-error-fg hover:bg-state-error-bg"
          >
            {clearArmed ? "Confirm clear" : "Clear"}
          </button>
          {clearArmed && (
            <button
              onClick={() => setClearArmed(false)}
              className="fs-caption text-text-tertiary hover:text-text-primary"
            >
              cancel
            </button>
          )}
        </div>
        <button
          onClick={save}
          className="rounded-md bg-emphasis px-3 py-1.5 fs-label text-emphasis-fg hover:bg-emphasis-hover"
        >
          Save
        </button>
      </div>
    </SheetShell>
  );
}

interface ApiKeyRowProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  help: React.ReactNode;
}

function ApiKeyRow({ label, placeholder, value, onChange, help }: ApiKeyRowProps) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="space-y-2">
      <label className="fs-label text-text-secondary">{label}</label>
      <div className="flex gap-2">
        <input
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded border border-border-default px-2 py-1.5 fs-data focus:outline-none focus:ring-1 focus:ring-focus-ring"
        />
        <button
          onClick={() => setReveal((r) => !r)}
          className="rounded-md border border-border-default px-2 py-1 fs-caption text-text-secondary hover:bg-surface-hover"
        >
          {reveal ? "hide" : "show"}
        </button>
      </div>
      <p className="text-[11px] text-text-tertiary">{help}</p>
    </div>
  );
}
