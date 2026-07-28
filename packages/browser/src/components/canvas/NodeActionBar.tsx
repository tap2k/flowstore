import { Plus, StarFour } from "@phosphor-icons/react";
import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSpecStore } from "@/lib/store/spec";
import { useUiStore } from "@/lib/store/ui";
import { useSettingsStore } from "@/lib/store/settings";

/**
 * The canvas's primary action surface, centred at the bottom edge. A single
 * "+" always adds a happy path flow — the common case — leaving type changes
 * to the inspector rather than a type picker up front.
 */
export function NodeActionBar() {
  const addFlow = useSpecStore((s) => s.addFlow);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const hasLlmKey = useSettingsStore(
    (s) => !!(s.googleApiKey || s.openaiApiKey || s.openrouterApiKey),
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center gap-2">
      <Tooltip label="Add a happy path flow" className="pointer-events-auto">
        <button
          type="button"
          // addFlow scaffolds a blank agent when no spec is loaded, so the
          // first click both creates the spec and adds the first flow —
          // never disabled.
          onClick={() => addFlow(true, undefined, "happy")}
          aria-label="Add a happy path flow"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-4 border border-border-default bg-surface-panel text-text-secondary shadow-elev-2 transition-colors duration-[var(--dur-1)] ease-standard hover:bg-surface-hover hover:text-text-primary"
        >
          <Icon icon={Plus} size={18} />
        </button>
      </Tooltip>
      {hasLlmKey && (
        <Tooltip label="Assistant — describe a spec change in natural language" className="pointer-events-auto">
          <button
            type="button"
            onClick={() => setChatOpen(!chatOpen)}
            aria-pressed={chatOpen}
            aria-label="Assistant"
            // Separated from the type cluster by its own container: it doesn't add
            // anything by itself, it opens a conversation.
            className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-4 border shadow-elev-2 transition-colors duration-[var(--dur-1)] ease-standard ${
              chatOpen
                ? "border-transparent bg-emphasis text-emphasis-fg"
                : "border-border-default bg-surface-panel text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            }`}
          >
            <Icon icon={StarFour} size={18} weight={chatOpen ? "fill" : "regular"} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
