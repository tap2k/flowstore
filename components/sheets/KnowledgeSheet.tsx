import { useRef, type ChangeEvent } from "react";
import { useSpecStore } from "@/lib/store/spec";
import { genId } from "@/lib/ids";
import type { FaqEntry, GlossaryEntry, Knowledge, TableEntry, TableField } from "@/lib/schema/v0";
import { ListEditor } from "@/components/inspector/ListEditor";
import { Field, Section, inputClass } from "@/components/inspector/primitives";
import { SheetShell } from "./SheetShell";
import {
  faqToCsv,
  glossaryToCsv,
  parseFaqCsv,
  parseGlossaryCsv,
  parseTableRowsCsv,
  tableToCsv,
} from "@/lib/codegen/knowledgeCsv";

export function KnowledgeSheet({ onClose }: { onClose: () => void }) {
  const knowledge = useSpecStore((s) => s.spec?.agent.knowledge ?? null);
  const languages = useSpecStore((s) => s.spec?.agent.meta.languages ?? ["EN"]);
  const updateAgent = useSpecStore((s) => s.updateAgent);

  function patchKnowledge(p: Partial<Knowledge>) {
    const merged = { ...(knowledge ?? {}), ...p };
    const empty =
      (!merged.faq || merged.faq.length === 0) &&
      (!merged.glossary || merged.glossary.length === 0) &&
      (!merged.tables || merged.tables.length === 0);
    updateAgent({ knowledge: empty ? undefined : merged });
  }

  const faqEntries = knowledge?.faq ?? [];
  const glossaryEntries = knowledge?.glossary ?? [];

  return (
    <SheetShell title="Knowledge" onClose={onClose}>
      <Section
        title="FAQ"
        action={
          <CsvButtons
            filename="faq.csv"
            disableExport={faqEntries.length === 0}
            onExport={() => faqToCsv(faqEntries, languages)}
            onImport={(text) => {
              const next = parseFaqCsv(text);
              patchKnowledge({ faq: next.length ? next : undefined });
            }}
          />
        }
      >
        <ListEditor<FaqEntry>
          items={knowledge?.faq ?? []}
          onChange={(faq) => patchKnowledge({ faq: faq.length ? faq : undefined })}
          newItem={() => ({ question: "", answer: "" })}
          addLabel="add FAQ entry"
          renderItem={(entry, update, remove) => (
            <div className="rounded border border-zinc-200 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={entry.question}
                  onChange={(e) => update({ ...entry, question: e.target.value })}
                  placeholder="Question"
                />
                <button
                  onClick={remove}
                  className="text-xs text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
              </div>
              <textarea
                className={`${inputClass} resize-y min-h-[50px]`}
                value={entry.answer}
                onChange={(e) => update({ ...entry, answer: e.target.value })}
                placeholder="Answer"
              />
            </div>
          )}
        />
      </Section>

      <Section
        title="Glossary"
        action={
          <CsvButtons
            filename="glossary.csv"
            disableExport={glossaryEntries.length === 0}
            onExport={() => glossaryToCsv(glossaryEntries)}
            onImport={(text) => {
              const next = parseGlossaryCsv(text);
              patchKnowledge({ glossary: next.length ? next : undefined });
            }}
          />
        }
      >
        <ListEditor<GlossaryEntry>
          items={knowledge?.glossary ?? []}
          onChange={(glossary) =>
            patchKnowledge({ glossary: glossary.length ? glossary : undefined })
          }
          newItem={() => ({ term: "", definition: "" })}
          addLabel="add term"
          renderItem={(entry, update, remove) => (
            <div className="flex items-start gap-2">
              <input
                className={`${inputClass} max-w-[200px]`}
                value={entry.term}
                onChange={(e) => update({ ...entry, term: e.target.value })}
                placeholder="term"
              />
              <textarea
                className={`${inputClass} resize-y min-h-[40px]`}
                value={entry.definition}
                onChange={(e) => update({ ...entry, definition: e.target.value })}
                placeholder="definition"
              />
              <button
                onClick={remove}
                className="text-xs text-zinc-400 hover:text-red-600 mt-1"
              >
                ×
              </button>
            </div>
          )}
        />
      </Section>

      <Section title="Tables">
        <TablesView
          tables={knowledge?.tables ?? []}
          onChange={(tables) => patchKnowledge({ tables: tables.length ? tables : undefined })}
        />
      </Section>
    </SheetShell>
  );
}

function TablesView({
  tables,
  onChange,
}: {
  tables: TableEntry[];
  onChange: (tables: TableEntry[]) => void;
}) {
  function addTable() {
    onChange([
      ...tables,
      { id: genId("tbl"), name: "", structure: [], rows: [] },
    ]);
  }
  function removeTable(i: number) {
    onChange(tables.filter((_, j) => j !== i));
  }
  function updateTable(i: number, t: TableEntry) {
    onChange(tables.map((x, j) => (j === i ? t : x)));
  }

  return (
    <div className="space-y-3">
      {tables.length === 0 && (
        <p className="text-xs text-zinc-400 italic">No tables.</p>
      )}
      {tables.map((t, i) => (
        <TableEditor
          key={t.id}
          table={t}
          onChange={(next) => updateTable(i, next)}
          onRemove={() => removeTable(i)}
        />
      ))}
      <button
        type="button"
        onClick={addTable}
        className="text-xs text-zinc-600 hover:text-zinc-900 underline"
      >
        + add table
      </button>
    </div>
  );
}

function TableEditor({
  table,
  onChange,
  onRemove,
}: {
  table: TableEntry;
  onChange: (t: TableEntry) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-zinc-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          value={table.name}
          onChange={(e) => onChange({ ...table, name: e.target.value })}
          placeholder="table name"
        />
        <span className="text-[10px] text-zinc-400 font-mono whitespace-nowrap">{table.id}</span>
        <CsvButtons
          filename={`${(table.name || "table").replace(/[^a-z0-9-_]+/gi, "-")}-rows.csv`}
          disableExport={table.structure.length === 0 && table.rows.length === 0}
          onExport={() => tableToCsv(table)}
          onImport={(text) => {
            const rows = parseTableRowsCsv(text, table);
            onChange({ ...table, rows });
          }}
        />
        <button
          onClick={onRemove}
          className="text-xs text-zinc-400 hover:text-red-600"
          title="remove table"
        >
          ×
        </button>
      </div>
      <Field label="Purpose">
        <textarea
          className={`${inputClass} resize-y min-h-[40px]`}
          value={table.purpose ?? ""}
          onChange={(e) =>
            onChange({ ...table, purpose: e.target.value || undefined })
          }
          placeholder="(optional) what this table is for"
        />
      </Field>
      <Field label="Fields">
        <ListEditor<TableField>
          items={table.structure}
          onChange={(structure) => onChange({ ...table, structure })}
          newItem={() => ({ field: "" })}
          addLabel="add field"
          renderItem={(f, update, remove) => (
            <div className="flex gap-2">
              <input
                className={`${inputClass} max-w-[160px]`}
                value={f.field}
                onChange={(e) => update({ ...f, field: e.target.value })}
                placeholder="field"
              />
              <input
                className={`${inputClass} max-w-[100px]`}
                value={f.type ?? ""}
                onChange={(e) =>
                  update({ ...f, type: e.target.value || undefined })
                }
                placeholder="type (optional)"
              />
              <input
                className={inputClass}
                value={f.description ?? ""}
                onChange={(e) =>
                  update({ ...f, description: e.target.value || undefined })
                }
                placeholder="description (optional)"
              />
              <button
                onClick={remove}
                className="text-xs text-zinc-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          )}
        />
      </Field>
      <Field label="Scaling rule">
        <input
          className={inputClass}
          value={table.scaling_rule ?? ""}
          onChange={(e) =>
            onChange({ ...table, scaling_rule: e.target.value || undefined })
          }
          placeholder="(optional)"
        />
      </Field>
      <details className="text-xs">
        <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900">
          Edit rows as JSON ({table.rows.length})
        </summary>
        <textarea
          className={`${inputClass} font-mono resize-y min-h-[80px] mt-2`}
          defaultValue={JSON.stringify(table.rows, null, 2)}
          onBlur={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (Array.isArray(parsed)) {
                onChange({ ...table, rows: parsed });
              }
            } catch {
              // leave previous value; invalid JSON ignored on blur
            }
          }}
        />
      </details>
    </div>
  );
}

function CsvButtons({
  filename,
  disableExport,
  onExport,
  onImport,
}: {
  filename: string;
  disableExport?: boolean;
  onExport: () => string;
  onImport: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function doExport() {
    const csv = onExport();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      onImport(text);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  }

  return (
    <span className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-xs text-zinc-500 hover:text-zinc-900"
        title="Import from CSV (replaces current entries)"
      >
        import
      </button>
      <button
        type="button"
        onClick={doExport}
        disabled={disableExport}
        className="text-xs text-zinc-500 hover:text-zinc-900 disabled:text-zinc-300 disabled:hover:text-zinc-300"
        title="Download as CSV"
      >
        export
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFile}
      />
    </span>
  );
}
