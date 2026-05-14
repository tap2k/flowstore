import { useState } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { genId } from "@/lib/ids";
import type { Flow, ScriptLine } from "@/lib/schema/v0";
import { defaultLanguage, getLanguage, setLanguage } from "@/lib/schema/v0";
import { flowToScriptsCsv, mergeScriptsCsv } from "@/lib/codegen/scriptsCsv";
import { downloadCsv, sanitizeFilename, useCsvFileInput } from "./csvIO";

interface ScriptsSheetProps {
  flow: Flow;
  onClose: () => void;
}

export function ScriptsSheet({ flow, onClose }: ScriptsSheetProps) {
  const agentLanguages = useSpecStore((s) => s.spec?.agent.meta.languages) ?? [];
  const updateFlow = useSpecStore((s) => s.updateFlow);
  const updateAgent = useSpecStore((s) => s.updateAgent);
  const agent = useSpecStore((s) => s.spec?.agent);
  const [newLang, setNewLang] = useState("");

  if (!agent) return null;

  // Column set: agent-declared languages plus any extras already in this
  // flow's script lines (defensive — usually agentLanguages is authoritative).
  const fromScripts = new Set<string>();
  for (const line of flow.scripts ?? []) {
    if (typeof line.text === "object") {
      for (const k of Object.keys(line.text)) fromScripts.add(k);
    }
    for (const k of Object.keys(line.variations ?? {})) fromScripts.add(k);
  }
  const merged: string[] = [];
  for (const lang of agentLanguages) if (!merged.includes(lang)) merged.push(lang);
  for (const lang of fromScripts) if (!merged.includes(lang)) merged.push(lang);
  const languages = merged.length > 0 ? merged : ["EN"];
  const defaultLang = defaultLanguage(agentLanguages);

  const lines = flow.scripts ?? [];

  function commit(nextLines: ScriptLine[]) {
    updateFlow(flow.id, { scripts: nextLines.length > 0 ? nextLines : undefined });
  }

  function addRow() {
    const newLine: ScriptLine = { id: genId("s"), text: "" };
    commit([...lines, newLine]);
  }

  function removeRow(id: string) {
    commit(lines.filter((l) => l.id !== id));
  }

  function editCell(id: string, lang: string, text: string) {
    commit(
      lines.map((l) => {
        if (l.id !== id) return l;
        const nextText = setLanguage(l.text, lang, text, defaultLang) ?? "";
        return { ...l, text: nextText };
      }),
    );
  }

  function editVariation(id: string, lang: string, idx: number, text: string) {
    commit(
      lines.map((l) => {
        if (l.id !== id) return l;
        const vars = { ...(l.variations ?? {}) };
        const arr = [...(vars[lang] ?? [])];
        arr[idx] = text;
        vars[lang] = arr;
        return { ...l, variations: vars };
      }),
    );
  }

  function addVariation(id: string, lang: string) {
    commit(
      lines.map((l) => {
        if (l.id !== id) return l;
        const vars = { ...(l.variations ?? {}) };
        vars[lang] = [...(vars[lang] ?? []), ""];
        return { ...l, variations: vars };
      }),
    );
  }

  function removeVariation(id: string, lang: string, idx: number) {
    commit(
      lines.map((l) => {
        if (l.id !== id) return l;
        const vars = { ...(l.variations ?? {}) };
        const next = (vars[lang] ?? []).filter((_, i) => i !== idx);
        if (next.length === 0) delete vars[lang];
        else vars[lang] = next;
        return { ...l, variations: Object.keys(vars).length > 0 ? vars : undefined };
      }),
    );
  }

  function addLanguage() {
    const code = newLang.trim();
    if (!code || languages.includes(code)) {
      setNewLang("");
      return;
    }
    const nextLanguages = [...(agentLanguages ?? []), code];
    updateAgent({ meta: { ...agent!.meta, languages: nextLanguages } });
    setNewLang("");
  }

  function removeLanguage(code: string) {
    if (!confirm(`Remove all "${code}" entries from "${flow.name}"?`)) return;
    const nextLines = lines.map((l) => {
      let nextText = l.text;
      if (typeof l.text === "object") {
        const { [code]: _drop, ...rest } = l.text;
        void _drop;
        const remaining = Object.keys(rest);
        if (remaining.length === 0) nextText = "";
        else if (remaining.length === 1 && remaining[0] === defaultLang) nextText = rest[defaultLang];
        else nextText = rest;
      }
      const vars = { ...(l.variations ?? {}) };
      if (code in vars) delete vars[code];
      return {
        ...l,
        text: nextText,
        variations: Object.keys(vars).length > 0 ? vars : undefined,
      };
    });
    commit(nextLines);
  }

  function exportCsv() {
    const safeName = sanitizeFilename(flow.name || flow.id || "scripts");
    downloadCsv(`${safeName}-scripts.csv`, flowToScriptsCsv(flow, languages));
  }

  const csvImport = useCsvFileInput((text) => {
    const nextScripts = mergeScriptsCsv(text, flow.scripts, languages);
    updateFlow(flow.id, {
      scripts: nextScripts.length > 0 ? nextScripts : undefined,
    });
  });

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
              onClick={csvImport.trigger}
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
            {csvImport.input}
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
              {lines.length === 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="text-center text-zinc-400 italic py-8 border-b border-zinc-200"
                  >
                    No script lines. Click &ldquo;+ Add row&rdquo; below.
                  </td>
                </tr>
              )}
              {lines.map((line) => (
                <tr key={line.id} className="group/row">
                  <td
                    className="border-b border-r border-zinc-200 align-top relative"
                    title={line.id}
                  >
                    <button
                      onClick={() => removeRow(line.id)}
                      className="absolute inset-0 opacity-0 group-hover/row:opacity-100 flex items-center justify-center text-zinc-400 hover:text-red-600"
                      title="remove row"
                    >
                      ×
                    </button>
                  </td>
                  {languages.map((lang) => {
                    const variations = line.variations?.[lang] ?? [];
                    const cellValue = getLanguage(line.text, lang, defaultLang) ?? "";
                    return (
                      <td
                        key={lang}
                        className="border-b border-r border-zinc-200 last:border-r-0 p-0 align-top"
                      >
                        <textarea
                          className="block w-full bg-transparent px-2 py-1.5 text-xs resize-none focus:outline-none focus:bg-blue-50/40 [field-sizing:content]"
                          value={cellValue}
                          onChange={(e) => editCell(line.id, lang, e.target.value)}
                          rows={1}
                          title={line.id}
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
                                editVariation(line.id, lang, i, e.target.value)
                              }
                              placeholder="alternate phrasing"
                              rows={1}
                            />
                            <button
                              onClick={() => removeVariation(line.id, lang, i)}
                              className="absolute top-0.5 right-0.5 opacity-0 group-hover/var:opacity-100 text-zinc-400 hover:text-red-600 text-sm leading-none p-1"
                              title="remove variation"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addVariation(line.id, lang)}
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
