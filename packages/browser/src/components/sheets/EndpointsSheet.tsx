import { useState } from "react";
import type { ModelEntry, CapabilityEndpoint } from "@flowstore/core/files/models";
import { genId } from "@flowstore/core/ids";
import { useModelsStore } from "@/lib/store/models";
import { useSpecStore } from "@/lib/store/spec";
import { inputClass, Section, Field } from "@/components/inspector/primitives";
import { SheetShell } from "./SheetShell";

export function EndpointsSheet({ onClose }: { onClose: () => void }) {
  const config = useModelsStore((s) => s.config);
  const setModelEntry = useModelsStore((s) => s.setModelEntry);
  const removeModelEntry = useModelsStore((s) => s.removeModelEntry);
  const setCapabilityEndpoint = useModelsStore((s) => s.setCapabilityEndpoint);
  const removeCapabilityEndpoint = useModelsStore((s) => s.removeCapabilityEndpoint);
  const capabilities = useSpecStore((s) => s.spec?.agent.capabilities) ?? [];

  const models = config?.models ?? {};
  const capEndpoints = config?.capabilityEndpoints ?? {};

  return (
    <SheetShell
      title="Endpoints"
      subtitle="Project inference servers and live capability endpoints."
      onClose={onClose}
    >
      <div className="space-y-6">
        <Section
          title="Inference"
          action={
            <button
              className="fs-caption text-text-tertiary hover:text-text-primary"
              onClick={() => {
                setModelEntry(genId("model"), { name: "", endpoint: "openai-compatible", base_url: "" });
              }}
            >
              + add
            </button>
          }
        >
          {Object.keys(models).length === 0 ? (
            <p className="fs-caption text-text-tertiary italic">
              No project inference endpoints. Add one to target a custom or self-hosted server.
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(models).map(([id, entry]) => (
                <InferenceRow
                  key={id}
                  entry={entry}
                  onChange={(newEntry) => setModelEntry(id, newEntry)}
                  onRemove={() => removeModelEntry(id)}
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Capabilities"
          action={
            capabilities.length === 0 ? undefined : (
              <span className="text-[10px] text-text-tertiary">toggle live/mock per capability</span>
            )
          }
        >
          {capabilities.length === 0 ? (
            <p className="fs-caption text-text-tertiary italic">
              No capabilities defined in this spec. Add capabilities first.
            </p>
          ) : (
            <div className="space-y-3">
              {capabilities.map((cap) => {
                const ep = capEndpoints[cap.name];
                return (
                  <CapabilityRow
                    key={cap.id}
                    name={cap.name}
                    endpoint={ep ?? null}
                    onChange={(newEp) => {
                      if (newEp) setCapabilityEndpoint(cap.name, newEp);
                      else removeCapabilityEndpoint(cap.name);
                    }}
                  />
                );
              })}
              {/* Configured endpoints not matching any current capability */}
              {Object.keys(capEndpoints)
                .filter((name) => !capabilities.some((c) => c.name === name))
                .map((name) => (
                  <CapabilityRow
                    key={name}
                    name={name}
                    endpoint={capEndpoints[name]}
                    stale
                    onChange={(newEp) => {
                      if (newEp) setCapabilityEndpoint(name, newEp);
                      else removeCapabilityEndpoint(name);
                    }}
                  />
                ))}
            </div>
          )}
        </Section>


      </div>
    </SheetShell>
  );
}

// ── Inference row ──────────────────────────────────────────────────────────────

function InferenceRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: ModelEntry;
  onChange: (entry: ModelEntry) => void;
  onRemove: () => void;
}) {
  const [localApiKey, setLocalApiKey] = useState(entry.api_key ?? "");

  function commit(field: Partial<ModelEntry>) {
    // api_key is kept in localApiKey only; never merged here so other-field
    // edits don't race with in-progress key typing.
    onChange({ ...entry, ...field });
  }

  function flushApiKey() {
    onChange({ ...entry, api_key: localApiKey || undefined });
  }

  return (
    <div className="rounded border border-border-default bg-surface-sunken p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          className={`${inputClass} flex-1`}
          value={entry.name ?? ""}
          onChange={(e) => commit({ name: e.target.value || undefined })}
          placeholder="Endpoint name"
          autoFocus={!entry.name}
        />
        <button onClick={onRemove} className="fs-caption text-text-tertiary hover:text-state-error-fg shrink-0">
          ×
        </button>
      </div>
      <Field label="base URL">
        <input
          className={`${inputClass} font-mono`}
          value={entry.base_url ?? ""}
          onChange={(e) => commit({ base_url: e.target.value || undefined })}
          placeholder="https://staging.example.com/v1"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="model id (optional)">
          <input
            className={`${inputClass} font-mono`}
            value={entry.model_id ?? ""}
            onChange={(e) => commit({ model_id: e.target.value || undefined })}
            placeholder="actual-model-name"
          />
        </Field>
        <Field label="api key (not saved to disk)">
          <input
            className={inputClass}
            type="password"
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            onBlur={flushApiKey}
            placeholder="sk-..."
            autoComplete="off"
          />
        </Field>
      </div>
    </div>
  );
}

// ── Capability row ─────────────────────────────────────────────────────────────

function CapabilityRow({
  name,
  endpoint,
  stale,
  onChange,
}: {
  name: string;
  endpoint: CapabilityEndpoint | null;
  stale?: boolean;
  onChange: (ep: CapabilityEndpoint | null) => void;
}) {
  const isLive = endpoint !== null;

  return (
    <div className={`rounded border px-3 py-2 space-y-2 ${stale ? "border-state-warning-line bg-state-warning-bg" : "border-border-default bg-surface-sunken"}`}>
      <div className="flex items-center gap-2">
        <span className="fs-data text-text-primary flex-1">{name}</span>
        {stale && <span className="text-[10px] text-state-warning-fg">not in spec</span>}
        <label className="flex items-center gap-1.5 fs-caption text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={isLive}
            onChange={(e) =>
              onChange(e.target.checked ? { url: "", method: "POST" } : null)
            }
          />
          live
        </label>
        {stale && (
          <button onClick={() => onChange(null)} className="fs-caption text-text-tertiary hover:text-state-error-fg">
            ×
          </button>
        )}
      </div>
      {isLive && endpoint && (
        <div className="space-y-2">
          <div className="grid grid-cols-[80px_1fr] gap-2">
            <Field label="method">
              <select
                className={inputClass}
                value={endpoint.method ?? "POST"}
                onChange={(e) =>
                  onChange({ ...endpoint, method: e.target.value as CapabilityEndpoint["method"] })
                }
              >
                <option>POST</option>
                <option>GET</option>
                <option>PUT</option>
                <option>PATCH</option>
              </select>
            </Field>
            <Field label="URL">
              <input
                className={`${inputClass} font-mono`}
                value={endpoint.url}
                onChange={(e) => onChange({ ...endpoint, url: e.target.value })}
                placeholder="https://api.example.com/check_balance"
              />
            </Field>
          </div>
          <HeadersEditor
            headers={endpoint.headers ?? {}}
            onChange={(headers) =>
              onChange({ ...endpoint, headers: Object.keys(headers).length ? headers : undefined })
            }
          />
        </div>
      )}
    </div>
  );
}

// ── Headers key=value editor ───────────────────────────────────────────────────

function HeadersEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>;
  onChange: (h: Record<string, string>) => void;
}) {
  const entries = Object.entries(headers);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary">headers (not saved to disk)</span>
        <button
          className="text-[10px] text-text-tertiary hover:text-text-primary"
          onClick={() => onChange({ ...headers, "": "" })}
        >
          + add
        </button>
      </div>
      {entries.map(([k, v], i) => (
        <div key={`${i}:${k}`} className="flex items-center gap-1">
          <input
            className={`${inputClass} font-mono flex-1`}
            value={k}
            onChange={(e) => {
              const next = Object.fromEntries(
                entries.map(([ek, ev], j) => [j === i ? e.target.value : ek, ev]),
              );
              onChange(next);
            }}
            placeholder="Authorization"
          />
          <input
            className={`${inputClass} font-mono flex-1`}
            value={v}
            onChange={(e) => onChange({ ...Object.fromEntries(entries), [k]: e.target.value })}
            placeholder="Bearer ..."
          />
          <button
            className="fs-caption text-text-tertiary hover:text-state-error-fg shrink-0"
            onClick={() => {
              const next = Object.fromEntries(entries.filter((_, j) => j !== i));
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
