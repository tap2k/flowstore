import { useSpecStore } from "@/lib/store/spec";
import { VariablesEditor } from "@/components/inspector/VariablesEditor";
import { SheetShell, type SectionSheetProps } from "./SheetShell";

export function VariablesSheet({ onClose, docked }: SectionSheetProps) {
  const variables = useSpecStore((s) => s.spec?.agent.variables);
  const updateAgent = useSpecStore((s) => s.updateAgent);

  return (
    <SheetShell
      title="Variables"
      subtitle="Agent-level variables shared across flows."
      onClose={onClose}
      docked={docked}
      maxWidth="max-w-2xl"
    >
      <VariablesEditor
        variables={variables}
        onChange={(v) => updateAgent({ variables: v })}
        scope="agent"
      />
    </SheetShell>
  );
}
