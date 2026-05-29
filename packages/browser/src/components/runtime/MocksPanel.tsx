import { useEffect, useMemo, useState } from "react";
import type { CapabilityMock } from "@flowstore/core/schema/files/capabilityMock";
import { useTestsStore } from "@/lib/store/tests";
import { useSpecStore } from "@/lib/store/spec";
import { TypedValueInput } from "./TypedValueInput";

// Saved capability-mock library for the Run pill's Mocks tab.
// Matches the personas/golds pattern: list of mocks (each row labelled
// <capability_id>.<variant>), click to expand an inline editor.
// Static-behavior mocks render typed inputs per output declared on the
// capability; error-behavior mocks just take the error string.
// Placeholder-first creation: + New immediately saves a mock for the
// first capability + variant "happy" (static, empty returns) and opens
// it. Abandoned placeholders are removed via Delete; they don't reach
// GitHub until the next Save commits the project. Mirrors PersonasPanel.

export function MocksPanel() {
  const mocksByCapability = useTestsStore((s) => s.mocksByCapability);
  const saveCapabilityMock = useTestsStore((s) => s.saveCapabilityMock);
  const deleteCapabilityMock = useTestsStore((s) => s.deleteCapabilityMock);
  const uniqueMockVariant = useTestsStore((s) => s.uniqueMockVariant);
  const spec = useSpecStore((s) => s.spec);

  const allMocks = useMemo(() => {
    const out: CapabilityMock[] = [];
    for (const list of Object.values(mocksByCapability)) out.push(...list);
    return out.sort((a, b) =>
      `${a.capability_id}.${a.variant}`.localeCompare(
        `${b.capability_id}.${b.variant}`,
      ),
    );
  }, [mocksByCapability]);

  const capabilities = spec?.agent.capabilities ?? [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  function startNew() {
    if (capabilities.length === 0) return;
    const initialCap = capabilities[0].id;
    const variant = uniqueMockVariant(initialCap, "happy");
    saveCapabilityMock({
      $schema: "flowstore://test/mock/v0",
      capability_id: initialCap,
      variant,
      behavior: { kind: "static", returns: {} },
    });
    setSelectedKey(`${initialCap}.${variant}`);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
        <div className="text-[11px] text-zinc-500">
          {allMocks.length} {allMocks.length === 1 ? "mock" : "mocks"}
        </div>
        <button
          type="button"
          onClick={startNew}
          disabled={capabilities.length === 0}
          title={
            capabilities.length === 0
              ? "Spec has no capabilities declared."
              : "Create a placeholder mock for the first capability — rename/retarget by deleting and recreating."
          }
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {allMocks.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">
            No mocks yet.{" "}
            {capabilities.length === 0
              ? "Declare a capability in the agent first."
              : "Click + New to author one."}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {allMocks.map((m) => {
              const key = `${m.capability_id}.${m.variant}`;
              return (
                <MockRow
                  key={key}
                  mock={m}
                  expanded={selectedKey === key}
                  onToggle={() => setSelectedKey(selectedKey === key ? null : key)}
                  onSave={(updated) => saveCapabilityMock(updated)}
                  onDelete={() => {
                    const ok = window.confirm(
                      `Delete mock "${key}"? Cases binding this variant will lose the binding.`,
                    );
                    if (!ok) return;
                    deleteCapabilityMock(m.capability_id, m.variant);
                    if (selectedKey === key) setSelectedKey(null);
                  }}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function MockRow({
  mock,
  expanded,
  onToggle,
  onSave,
  onDelete,
}: {
  mock: CapabilityMock;
  expanded: boolean;
  onToggle: () => void;
  onSave: (m: CapabilityMock) => void;
  onDelete: () => void;
}) {
  const spec = useSpecStore((s) => s.spec);
  const capability = spec?.agent.capabilities?.find(
    (c) => c.id === mock.capability_id,
  );
  const declaredOutputs = capability?.outputs ?? [];
  const declMap = useMemo(() => {
    const decls = spec?.agent.variables ?? {};
    return decls as Record<string, unknown>;
  }, [spec]);

  const [kind, setKind] = useState<"static" | "error">(mock.behavior.kind);
  const [returns, setReturns] = useState<Record<string, unknown>>(
    mock.behavior.kind === "static" && typeof mock.behavior.returns === "object" && mock.behavior.returns !== null
      ? (mock.behavior.returns as Record<string, unknown>)
      : {},
  );
  const [errorText, setErrorText] = useState(
    mock.behavior.kind === "error" ? mock.behavior.error : "",
  );

  useEffect(() => {
    if (expanded) {
      setKind(mock.behavior.kind);
      setReturns(
        mock.behavior.kind === "static" && typeof mock.behavior.returns === "object" && mock.behavior.returns !== null
          ? (mock.behavior.returns as Record<string, unknown>)
          : {},
      );
      setErrorText(mock.behavior.kind === "error" ? mock.behavior.error : "");
    }
  }, [expanded, mock]);

  const dirty =
    kind !== mock.behavior.kind ||
    (kind === "static" &&
      JSON.stringify(returns) !==
        JSON.stringify(
          mock.behavior.kind === "static" ? mock.behavior.returns : {},
        )) ||
    (kind === "error" &&
      errorText !== (mock.behavior.kind === "error" ? mock.behavior.error : ""));

  function handleSave() {
    const next: CapabilityMock = {
      $schema: "flowstore://test/mock/v0",
      capability_id: mock.capability_id,
      variant: mock.variant,
      behavior:
        kind === "static"
          ? { kind: "static", returns }
          : { kind: "error", error: errorText },
    };
    onSave(next);
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] text-zinc-900">
            {mock.capability_id}.{mock.variant}
            {mock.behavior.kind === "error" && (
              <span className="ml-1.5 text-[10px] text-red-700">(error)</span>
            )}
          </div>
        </div>
        <span className="ml-2 text-zinc-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/50 px-3 py-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
              behavior
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "static" | "error")}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px]"
            >
              <option value="static">static</option>
              <option value="error">error</option>
            </select>
          </div>

          {kind === "static" && (
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                returns
              </label>
              {declaredOutputs.length > 0 ? (
                <div className="space-y-1">
                  {declaredOutputs.map((outName) => (
                    <div key={outName}>
                      <label className="block text-[10px] font-mono text-zinc-700">
                        {outName}
                      </label>
                      <TypedValueInput
                        decl={
                          (declMap[outName] as
                            | { type: "string" | "number" | "boolean" | "enum"; values?: string[] }
                            | undefined) ?? undefined
                        }
                        value={returns[outName]}
                        disabled={false}
                        onChange={(v) =>
                          setReturns({ ...returns, [outName]: v })
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  value={JSON.stringify(returns, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      if (typeof parsed === "object" && parsed !== null) {
                        setReturns(parsed as Record<string, unknown>);
                      }
                    } catch {
                      // ignore invalid JSON mid-typing
                    }
                  }}
                  rows={4}
                  className="w-full resize-y rounded border border-zinc-300 bg-white p-1.5 font-mono text-[10px]"
                  placeholder='{"output": "value"}'
                />
              )}
            </div>
          )}

          {kind === "error" && (
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                error
              </label>
              <input
                type="text"
                value={errorText}
                onChange={(e) => setErrorText(e.target.value)}
                placeholder="Error string the runner will surface"
                className="w-full rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px]"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty}
              title={dirty ? "Save changes" : "No unsaved edits"}
              className="rounded-md bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
