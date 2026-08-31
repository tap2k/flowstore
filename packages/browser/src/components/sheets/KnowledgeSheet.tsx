import { useSpecStore } from "@/lib/store/spec";
import { genId } from "@flowstore/core/ids";
import type { GlossaryEntry, Knowledge, TableEntry, TableField } from "@flowstore/core/schema/v0";
import { defaultLanguage } from "@flowstore/core/schema/v0";
import { ListEditor } from "@/components/inspector/ListEditor";
import { FaqListEditor } from "@/components/inspector/FaqListEditor";
import { Field, Section, inputClass } from "@/components/inspector/primitives";
import { SheetShell, type SectionSheetProps } from "./SheetShell";
import { downloadCsv, useCsvFileInput } from "./csvIO";
import {
  faqToCsv,
  glossaryToCsv,
  parseFaqCsv,
  parseGlossaryCsv,
  parseTableRowsCsv,
  tableToCsv,
} from "@flowstore/core/codegen/knowledgeCsv";
import { AutoTextarea } from "@/components/ui";

export function KnowledgeSheet({ onClose, docked }: SectionSheetProps) {
  const knowledge = useSpecStore((s) => s.spec?.agent.knowledge ?? null);
  const languages = useSpecStore((s) => s.spec?.agent.meta.languages ?? ["EN"]);
  const updateAgent = useSpecStore((s) => s.updateAgent);
  const defaultLang = defaultLanguage(languages);

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
    <SheetShell title="Knowledge" onClose={onClose} docked={docked}>
      <Section
        title="FAQ"
        action={
          <CsvButtons
            filename="faq.csv"
            disableExport={faqEntries.length === 0}
            onExport={() => faqToCsv(faqEntries, languages)}
            onImport={(text) => {
              const next = parseFaqCsv(text, languages);
              patchKnowledge({ faq: next.length ? next : undefined });
            }}
          />
        }
      >
        <FaqListEditor
          entries={knowledge?.faq ?? []}
          onChange={(faq) => patchKnowledge({ faq: faq.length ? faq : undefined })}
          defaultLang={defaultLang}
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
          newItem={() => ({ id: genId("gloss"), term: "", definition: "" })}
          addLabel="add term"
          renderItem={(entry, update, remove) => (
            <div className="flex items-start gap-2">
              <input
                className={`${inputClass} max-w-[200px]`}
                value={entry.term}
                onChange={(e) => update({ ...entry, term: e.target.value })}
                placeholder="term"
              />
              <AutoTextarea
                className={`${inputClass} min-h-[40px]`}
                value={entry.definition}
                onChange={(e) => update({ ...entry, definition: e.target.value })}
                placeholder="definition"
              />
              <button
                onClick={remove}
                className="fs-caption text-text-tertiary hover:text-state-error-fg mt-1"
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
        <p className="fs-caption text-text-tertiary italic">No tables.</p>
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
        className="fs-caption text-text-secondary hover:text-text-primary underline"
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
    <div className="fs-item-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          value={table.name}
          onChange={(e) => onChange({ ...table, name: e.target.value })}
          placeholder="table name"
        />
        <span className="text-[10px] text-text-tertiary font-mono whitespace-nowrap">{table.id}</span>
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
          className="fs-caption text-text-tertiary hover:text-state-error-fg"
          title="remove table"
        >
          ×
        </button>
      </div>
      <Field label="Notes">
        <AutoTextarea
          className={`${inputClass} min-h-[40px]`}
          value={table.notes ?? ""}
          onChange={(e) =>
            onChange({ ...table, notes: e.target.value || undefined })
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
                className="fs-caption text-text-tertiary hover:text-state-error-fg"
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
      <details className="fs-caption">
        <summary className="cursor-pointer text-text-secondary hover:text-text-primary">
          Edit rows as JSON ({table.rows.length})
        </summary>
        <AutoTextarea
          className={`${inputClass} font-mono min-h-[80px] mt-2`}
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
  const { trigger, input } = useCsvFileInput(onImport);

  return (
    <span className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={trigger}
        className="fs-caption text-text-tertiary hover:text-text-primary"
        title="Import from CSV (replaces current entries)"
      >
        import
      </button>
      <button
        type="button"
        onClick={() => downloadCsv(filename, onExport())}
        disabled={disableExport}
        className="fs-caption text-text-tertiary hover:text-text-primary disabled:text-text-disabled disabled:hover:text-text-disabled"
        title="Download as CSV"
      >
        export
      </button>
      {input}
    </span>
  );
}
