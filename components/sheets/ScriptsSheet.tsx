import { useRef, useState, type ChangeEvent } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { genId } from "@/lib/ids";
import type { Flow, ScriptLine } from "@/lib/schema/v0";
import { flowToScriptsCsv, mergeScriptsCsv } from "@/lib/codegen/scriptsCsv";

interface ScriptsSheetProps {
  flow: Flow;
  onClose: () => void;
}

interface Row {
  id: string;
  textsByLang: Record<string, string>;
  variationsByLang: Record<string, string[]>;
}

// Merge script ids across all languages, preserving each language's order.
function rowsFromFlow(flow: Flow, languages: string[]): Row[] {
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const lang of languages) {
    for (const line of flow.scripts?.[lang] ?? []) {
      if (!seen.has(line.id)) {
        seen.add(line.id);
        orderedIds.push(line.id);
      }
    }
  }
  return orderedIds.map((id) => {
    const textsByLang: Record<string, string> = {};
    const variationsByLang: Record<string, string[]> = {};
    for (const lang of languages) {
      const line = flow.scripts?.[lang]?.find((l) => l.id === id);
      textsByLang[lang] = line?.text ?? "";
      variationsByLang[lang] = line?.variations ?? [];
    }
    return { id, textsByLang, variationsByLang };
  });
}

function rowsToScripts(rows: Row[], languages: string[]): Record<string, ScriptLine[]> {
  const out: Record<string, ScriptLine[]> = {};
  for (const lang of languages) {
    out[lang] = rows
      .filter((r) => r.textsByLang[lang] !== undefined && r.textsByLang[lang] !== "")
      .map((r) => {
        const vars = r.variationsByLang[lang] ?? [];
        return vars.length > 0
          ? { id: r.id, text: r.textsByLang[lang], variations: vars }
          : { id: r.id, text: r.textsByLang[lang] };
      });
  }
  return out;
}

export function ScriptsSheet({ flow, onClose }: ScriptsSheetProps) {
  const agentLanguages = useSpecStore((s) => s.spec?.agent.meta.languages) ?? [];
  const updateFlow = useSpecStore((s) => s.updateFlow);
  const agent = useSpecStore((s) => s.spec?.agent);
  const [newLang, setNewLang] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!agent) return null;

  // Sheet columns are the union of agent-supported languages and any extras
  // already in this flow's scripts. Per-flow add/delete operates only on
  // flow.scripts; agent.meta.languages is managed elsewhere.
  const merged: string[] = [];
  for (const lang of agentLanguages) if (!merged.includes(lang)) merged.push(lang);
  for (const lang of Object.keys(flow.scripts ?? {})) {
    if (!merged.includes(lang)) merged.push(lang);
  }
  const languages = merged.length > 0 ? merged : ["EN"];
  const rows = rowsFromFlow(flow, languages);

  function commit(nextRows: Row[]) {
    const scripts = rowsToScripts(nextRows, languages);
    const hasAny = Object.values(scripts).some((arr) => arr.length > 0);
    updateFlow(flow.id, { scripts: hasAny ? scripts : undefined });
  }

  function addRow() {
    const id = genId("s");
    const empty: Record<string, string> = {};
    const emptyVars: Record<string, string[]> = {};
    for (const lang of languages) {
      empty[lang] = "";
      emptyVars[lang] = [];
    }
    commit([...rows, { id, textsByLang: empty, variationsByLang: emptyVars }]);
  }

  function removeRow(rowId: string) {
    commit(rows.filter((r) => r.id !== rowId));
  }

  function editCell(rowId: string, lang: string, text: string) {
    commit(
      rows.map((r) =>
        r.id === rowId ? { ...r, textsByLang: { ...r.textsByLang, [lang]: text } } : r
      )
    );
  }

  function editVariation(rowId: string, lang: string, idx: number, text: string) {
    commit(
      rows.map((r) => {
        if (r.id !== rowId) return r;
        const vars = [...(r.variationsByLang[lang] ?? [])];
        vars[idx] = text;
        return { ...r, variationsByLang: { ...r.variationsByLang, [lang]: vars } };
      })
    );
  }

  function addVariation(rowId: string, lang: string) {
    commit(
      rows.map((r) => {
        if (r.id !== rowId) return r;
        const vars = [...(r.variationsByLang[lang] ?? []), ""];
        return { ...r, variationsByLang: { ...r.variationsByLang, [lang]: vars } };
      })
    );
  }

  function removeVariation(rowId: string, lang: string, idx: number) {
    commit(
      rows.map((r) => {
        if (r.id !== rowId) return r;
        const vars = (r.variationsByLang[lang] ?? []).filter((_, i) => i !== idx);
        return { ...r, variationsByLang: { ...r.variationsByLang, [lang]: vars } };
      })
    );
  }

  function addLanguage() {
    const code = newLang.trim();
    if (!code || languages.includes(code)) {
      setNewLang("");
      return;
    }
    const nextScripts = { ...(flow.scripts ?? {}), [code]: [] };
    updateFlow(flow.id, { scripts: nextScripts });
    setNewLang("");
  }

  function exportCsv() {
    const csv = flowToScriptsCsv(flow, languages);
    const safeName = (flow.name || flow.id || "scripts").replace(/[^a-z0-9_-]+/gi, "_");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}-scripts.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const nextScripts = mergeScriptsCsv(text, flow.scripts);
      updateFlow(flow.id, {
        scripts: Object.keys(nextScripts).length > 0 ? nextScripts : undefined,
      });
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  }

  function removeLanguage(code: string) {
    if (
      !confirm(
        `Remove all ${code} script entries from "${flow.name}"?`
      )
    )
      return;
    const nextScripts = { ...(flow.scripts ?? {}) };
    delete nextScripts[code];
    updateFlow(flow.id, {
      scripts: Object.keys(nextScripts).length > 0 ? nextScripts : undefined,
    });
  }

  const colCount = languages.length + 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900">Scripts</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{flow.name}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <input
              type="text"
              value={newLang}
              onChange={(e) => setNewLang(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLanguage()}
              placeholder="+ add language (e.g. ES)"
              className="rounded border border-zinc-200 px-2 py-1 text-xs w-48 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
            />
            <button
              onClick={triggerImport}
              className="text-xs text-zinc-500 hover:text-zinc-900"
              title="Import scripts from a CSV file"
            >
              import
            </button>
            <button
              onClick={exportCsv}
              className="text-xs text-zinc-500 hover:text-zinc-900"
              title="Download this flow's scripts as a CSV"
            >
              export
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              onClick={onClose}
              className="text-xs text-zinc-500 hover:text-zinc-900"
            >
              close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse table-fixed">
            <colgroup>
              <col style={{ width: 28 }} />
              {languages.map((lang) => (
                <col key={lang} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-zinc-50">
              <tr>
                <th className="border-b border-r border-zinc-200" />
                {languages.map((lang) => (
                  <th
                    key={lang}
                    className="group/lang relative border-b border-r border-zinc-200 last:border-r-0 px-2 py-2 text-left text-xs font-semibold text-zinc-700"
                  >
                    {lang}
                    <button
                      onClick={() => removeLanguage(lang)}
                      className="absolute top-1 right-1 opacity-0 group-hover/lang:opacity-100 text-zinc-400 hover:text-red-600 text-sm leading-none px-1"
                      title={`remove ${lang}`}
                    >
                      ×
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="text-center text-zinc-400 italic py-8 border-b border-zinc-200"
                  >
                    No script lines. Click &ldquo;+ Add row&rdquo; below.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="group/row">
                  <td
                    className="border-b border-r border-zinc-200 align-top relative"
                    title={row.id}
                  >
                    <button
                      onClick={() => removeRow(row.id)}
                      className="absolute inset-0 opacity-0 group-hover/row:opacity-100 flex items-center justify-center text-zinc-400 hover:text-red-600"
                      title="remove row"
                    >
                      ×
                    </button>
                  </td>
                  {languages.map((lang) => {
                    const variations = row.variationsByLang[lang] ?? [];
                    return (
                      <td
                        key={lang}
                        className="border-b border-r border-zinc-200 last:border-r-0 p-0 align-top"
                      >
                        <textarea
                          className="block w-full bg-transparent px-2 py-1.5 text-xs resize-none focus:outline-none focus:bg-blue-50/40 [field-sizing:content]"
                          value={row.textsByLang[lang] ?? ""}
                          onChange={(e) => editCell(row.id, lang, e.target.value)}
                          rows={1}
                        />
                        {variations.map((v, i) => (
                          <div
                            key={i}
                            className="group/var relative border-t border-dashed border-zinc-200"
                          >
                            <textarea
                              className="block w-full bg-transparent px-2 py-1 pr-6 text-[11px] text-zinc-600 italic resize-none focus:outline-none focus:bg-blue-50/40 focus:not-italic focus:text-zinc-900 [field-sizing:content]"
                              value={v}
                              onChange={(e) =>
                                editVariation(row.id, lang, i, e.target.value)
                              }
                              placeholder="alternate phrasing"
                              rows={1}
                            />
                            <button
                              onClick={() => removeVariation(row.id, lang, i)}
                              className="absolute top-0.5 right-0.5 opacity-0 group-hover/var:opacity-100 text-zinc-400 hover:text-red-600 text-sm leading-none p-1"
                              title="remove variation"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addVariation(row.id, lang)}
                          className="block w-full px-2 py-1 text-left text-[10px] text-zinc-300 hover:text-zinc-700 hover:bg-zinc-50 border-t border-dashed border-zinc-100"
                        >
                          + alt
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-zinc-200 px-5 py-3">
          <button
            onClick={addRow}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            + Add row
          </button>
        </div>
      </div>
    </div>
  );
}
