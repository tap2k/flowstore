import { useSpecStore } from "@/lib/store/spec";

interface SingleFlowPickerProps {
  selected: string | null;
  onChange: (id: string | null) => void;
  excludeId?: string;
  allowNull?: boolean;
}

export function SingleFlowPicker({ selected, onChange, excludeId, allowNull }: SingleFlowPickerProps) {
  const flows = useSpecStore((s) => s.spec?.flows) ?? [];
  const candidates = flows.filter((f) => f.id !== excludeId);

  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full rounded border border-zinc-300 px-2 py-1 text-xs bg-white"
    >
      {allowNull && <option value="">(none)</option>}
      {candidates.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
