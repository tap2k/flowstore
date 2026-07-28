import { AgentSheet } from "@/components/sheets/AgentSheet";
import { VariablesSheet } from "@/components/sheets/VariablesSheet";
import { GuardrailsSheet } from "@/components/sheets/GuardrailsSheet";
import { BusinessGoalsSheet } from "@/components/sheets/BusinessGoalsSheet";
import { CapabilitiesSheet } from "@/components/sheets/CapabilitiesSheet";
import { KnowledgeSheet } from "@/components/sheets/KnowledgeSheet";
import { EndpointsSheet } from "@/components/sheets/EndpointsSheet";
import { SystemPromptPanel } from "@/components/runtime/SystemPromptPanel";
import { useUiStore } from "@/lib/store/ui";

/**
 * The docked left panel: one rail tab's contents, always against the rail.
 *
 * Every section here is still the same component that used to open as a modal
 * sheet — they render in `docked` mode instead (see SheetShell), so there is
 * one implementation of each editor rather than a modal and a panel version
 * drifting apart.
 */
export function LeftPanel() {
  const leftTab = useUiStore((s) => s.leftTab);
  const close = () => useUiStore.getState().setLeftTab(null);
  if (!leftTab) return null;

  return (
    <aside className="fs-dock flex flex-col border-r border-border-default bg-surface-panel">
      {leftTab === "prompt" && <SystemPromptPanel onClose={close} />}
      {leftTab === "agent" && <AgentSheet docked onClose={close} />}
      {leftTab === "variables" && <VariablesSheet docked onClose={close} />}
      {leftTab === "guardrails" && <GuardrailsSheet docked onClose={close} />}
      {leftTab === "business_goals" && <BusinessGoalsSheet docked onClose={close} />}
      {leftTab === "capabilities" && <CapabilitiesSheet docked onClose={close} />}
      {leftTab === "knowledge" && <KnowledgeSheet docked onClose={close} />}
      {leftTab === "endpoints" && <EndpointsSheet docked onClose={close} />}
    </aside>
  );
}
