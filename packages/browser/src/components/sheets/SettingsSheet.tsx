import { useState } from "react";
import { SheetShell } from "./SheetShell";
import { useSettingsStore, DEFAULT_RUNNER_URL, DEFAULT_MODEL_ID, type TtsProvider } from "@/lib/store/settings";
import { ModelPicker } from "@/components/runtime/ModelPicker";
import { DisclosureCaret, Input, Select } from "@/components/ui";
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
  const storedXai = useSettingsStore((s) => s.xaiApiKey);
  const setXaiApiKey = useSettingsStore((s) => s.setXaiApiKey);
  const storedRunnerUrl = useSettingsStore((s) => s.runnerUrl);
  const setRunnerUrl = useSettingsStore((s) => s.setRunnerUrl);
  const storedGithubPat = useSettingsStore((s) => s.githubPat);
  const setGithubPat = useSettingsStore((s) => s.setGithubPat);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setGenerateModel = useSettingsStore((s) => s.setGenerateModel);
  const storedTtsProvider = useSettingsStore((s) => s.ttsProvider);
  const setTtsProvider = useSettingsStore((s) => s.setTtsProvider);
  const storedTtsVoice = useSettingsStore((s) => s.ttsVoice);
  const setTtsVoice = useSettingsStore((s) => s.setTtsVoice);
  const storedS2sVoice = useSettingsStore((s) => s.s2sVoice);
  const setS2sVoice = useSettingsStore((s) => s.setS2sVoice);
  const storedElevenlabs = useSettingsStore((s) => s.elevenlabsApiKey);
  const setElevenlabsApiKey = useSettingsStore((s) => s.setElevenlabsApiKey);
  const storedAsrPerMin = useSettingsStore((s) => s.voiceAsrPerMin);
  const setVoiceAsrPerMin = useSettingsStore((s) => s.setVoiceAsrPerMin);
  const storedTtsPerMChars = useSettingsStore((s) => s.voiceTtsPerMChars);
  const setVoiceTtsPerMChars = useSettingsStore((s) => s.setVoiceTtsPerMChars);

  const [google, setGoogle] = useState(storedGoogle);
  const [openai, setOpenai] = useState(storedOpenai);
  const [openrouter, setOpenrouter] = useState(storedOpenrouter);
  const [xai, setXai] = useState(storedXai);
  const [runnerUrl, setRunnerUrlInput] = useState(storedRunnerUrl);
  const [pat, setPat] = useState(storedGithubPat);
  const [ttsProvider, setTtsProviderDraft] = useState<TtsProvider>(storedTtsProvider);
  const [ttsVoice, setTtsVoiceDraft] = useState(storedTtsVoice);
  const [s2sVoice, setS2sVoiceDraft] = useState(storedS2sVoice);
  const [elevenlabs, setElevenlabs] = useState(storedElevenlabs);
  const [asrPerMin, setAsrPerMin] = useState(storedAsrPerMin);
  const [ttsPerMChars, setTtsPerMChars] = useState(storedTtsPerMChars);
  const [patReveal, setPatReveal] = useState(false);
  const [ghStatus, setGhStatus] = useState<GhTestStatus>({ kind: "idle" });
  // Two-step guard: first click arms, second click wipes. Clearing erases
  // API keys and the GitHub PAT from localStorage, so a stray click is costly.
  const [clearArmed, setClearArmed] = useState(false);

  function save() {
    setGoogleApiKey(google.trim());
    setOpenaiApiKey(openai.trim());
    setOpenrouterApiKey(openrouter.trim());
    setXaiApiKey(xai.trim());
    setRunnerUrl(runnerUrl);
    setGithubPat(pat);
    setTtsProvider(ttsProvider);
    setTtsVoice(ttsVoice.trim());
    setS2sVoice(s2sVoice.trim());
    setElevenlabsApiKey(elevenlabs.trim());
    setVoiceAsrPerMin(asrPerMin.trim());
    setVoiceTtsPerMChars(ttsPerMChars.trim());
    onClose();
  }

  // Wipe every stored setting: keys + PAT (and cached identity) from
  // localStorage, runner URL, and the default model back to the built-in.
  // Drafts reset too so the open sheet reflects the cleared state.
  function clearAll() {
    setGoogleApiKey("");
    setOpenaiApiKey("");
    setOpenrouterApiKey("");
    setXaiApiKey("");
    setRunnerUrl("");
    setGithubPat("");
    setGenerateModel(DEFAULT_MODEL_ID);
    setTtsProvider("gemini");
    setTtsVoice("");
    setS2sVoice("");
    setElevenlabsApiKey("");
    setTtsProviderDraft("gemini");
    setTtsVoiceDraft("");
    setS2sVoiceDraft("");
    setElevenlabs("");
    setVoiceAsrPerMin("");
    setVoiceTtsPerMChars("");
    setAsrPerMin("");
    setTtsPerMChars("");
    setGoogle("");
    setOpenai("");
    setOpenrouter("");
    setXai("");
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
      {/* Appearance row parked (Tapan 2026-07-29) — the header theme toggle
          covers it. To restore: re-import useThemeStore/ThemePreference from
          @/lib/store/theme, re-import FieldRow, subscribe preference/
          setPreference, and render:
      <FieldRow label="Appearance" hint="Applies immediately; not staged behind Save.">
        <Select
          value={themePreference}
          onChange={(e) => setThemePreference(e.target.value as ThemePreference)}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "Match system" },
          ]}
          className="w-full"
        />
      </FieldRow>
      */}

      <Section
        title="API keys"
        summary={`${[google, openai, openrouter, xai].filter((k) => k.trim()).length}/4 set`}
        defaultOpen={[google, openai, openrouter, xai].every((k) => !k.trim())}
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
      <ApiKeyRow
        label="xAI API key"
        placeholder="xai-…"
        value={xai}
        onChange={setXai}
        help={
          <>
            For Grok Voice (s2s). Get a key at{" "}
            <a
              href="https://console.x.ai"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-text-primary"
            >
              console.x.ai
            </a>
            .
          </>
        }
      />

      </Section>
      <Section title="Models" summary={defaultModel} defaultOpen={false}>
      <div className="space-y-2">
        <label className="fs-label text-text-secondary">Default model</label>
        <ModelPicker
          value={defaultModel}
          onChange={setGenerateModel}
          showUnconfigured
          keyOverrides={{ google: google.trim(), openai: openai.trim() }}
          className="w-full rounded border border-border-default px-2 py-1.5 fs-body focus:outline-none focus:ring-1 focus:ring-focus-ring"
        />
        <p className="text-[11px] text-text-tertiary">
          Used wherever no explicit model is picked — generating personas,
          variables and mocks, and translating transcripts.
        </p>
      </div>




      </Section>
      <Section
        title="Voice"
        summary={`${ttsProvider}${ttsVoice.trim() ? ` · ${ttsVoice.trim()}` : ""}${s2sVoice.trim() ? ` · s2s ${s2sVoice.trim()}` : ""}`}
        defaultOpen={false}
      >
      <div className="space-y-2">
        <label className="fs-label text-text-secondary">S2S voice</label>
        <Input
          value={s2sVoice}
          onChange={(e) => setS2sVoiceDraft(e.target.value)}
          placeholder="vendor default (Gemini: Kore · OpenAI: marin · Grok: eve)"
          className="w-full"
        />
        <p className="text-[11px] text-text-tertiary">
          Speaker for live s2s sessions. Vendor&apos;s namespace; blank = default.
        </p>
      </div>

      <div className="space-y-2">
        <label className="fs-label text-text-secondary">Ear-test TTS</label>
        <div className="flex gap-2">
          <Select
            value={ttsProvider}
            onChange={(e) => setTtsProviderDraft(e.target.value as TtsProvider)}
            options={[
              { value: "gemini", label: "Gemini (Google key)" },
              { value: "openai", label: "OpenAI (OpenAI key)" },
              { value: "elevenlabs", label: "ElevenLabs" },
            ]}
            className="w-44"
          />
          <Input
            value={ttsVoice}
            onChange={(e) => setTtsVoiceDraft(e.target.value)}
            placeholder={
              ttsProvider === "elevenlabs"
                ? "voice id (required)"
                : ttsProvider === "openai"
                  ? "voice (default: alloy)"
                  : "voice (default: Kore)"
            }
            className="flex-1"
          />
        </div>
        <p className="text-[11px] text-text-tertiary">
          Voices ▶ hear on text columns. Synthesized on click, on your key.
        </p>
      </div>
      {ttsProvider === "elevenlabs" && (
        <ApiKeyRow
          label="ElevenLabs API key"
          placeholder="xi-…"
          value={elevenlabs}
          onChange={setElevenlabs}
          help={<>Only used for ear-test TTS.</>}
        />
      )}

      <div className="space-y-2">
        <label className="fs-label text-text-secondary">Cascade rates</label>
        <div className="flex gap-2">
          <label className="flex flex-1 items-center gap-1.5 text-[11px] text-text-tertiary">
            asr $/min
            <Input
              value={asrPerMin}
              onChange={(e) => setAsrPerMin(e.target.value)}
              placeholder="0.008"
              className="w-full"
            />
          </label>
          <label className="flex flex-1 items-center gap-1.5 text-[11px] text-text-tertiary">
            tts $/1M chars
            <Input
              value={ttsPerMChars}
              onChange={(e) => setTtsPerMChars(e.target.value)}
              placeholder="8.00"
              className="w-full"
            />
          </label>
        </div>
        <p className="text-[11px] text-text-tertiary">
          Prices the voice estimate. Blank hides it.
        </p>
      </div>

      </Section>
      <Section
        title="GitHub"
        summary={pat.trim() ? "connected" : "not connected"}
        defaultOpen={!pat.trim()}
      >
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

      </Section>

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

// Collapsible section — the sheet outgrew one screen. Same disclosure idiom
// as compare's placeholders strip (caret + truthful summary + aria); a
// section whose fields are all configured starts collapsed with the summary
// carrying its state, anything needing attention starts open.
function Section({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  // Shown while collapsed — the section's state at a glance ("4/4 set").
  summary?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `settings-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="border-b border-border-subtle pb-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full cursor-pointer items-center gap-1 pb-1 pt-2 text-left"
      >
        <DisclosureCaret open={open} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {title}
        </span>
        {!open && summary && (
          <span className="text-[10px] text-text-disabled">{summary}</span>
        )}
      </button>
      {open && (
        <div id={id} className="space-y-4">
          {children}
        </div>
      )}
    </div>
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
