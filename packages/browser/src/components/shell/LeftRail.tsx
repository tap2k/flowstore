import {
  ArrowsLeftRight,
  Article,
  BookOpen,
  BracketsCurly,
  Headset,
  Plugs,
  Question,
  Target,
  Wall,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui";
import { useUiStore, type LeftTab } from "@/lib/store/ui";
import { useSpecStore } from "@/lib/store/spec";
import { computeDiagnostics, diagnosticCounts } from "@/lib/diagnostics";

interface RailItem {
  tab: LeftTab;
  label: string;
  icon: PhosphorIcon;
  /** Dev-only entries stay behind the same flag they had in the old toolbar. */
  dev?: boolean;
  /** Endpoints is editable with no spec loaded; everything else needs one. */
  alwaysEnabled?: boolean;
}

// Prompt sits alone above the divider: it is the only READ surface here — the
// compiled result of everything below it — where the rest are editors.
const PROMPT_ITEM: RailItem = { tab: "prompt", label: "Prompt", icon: Article };

const SECTION_ITEMS: RailItem[] = [
  { tab: "agent", label: "Agent", icon: Headset },
  { tab: "variables", label: "Variables", icon: BracketsCurly },
  { tab: "guardrails", label: "Guardrails", icon: Wall },
  { tab: "business_goals", label: "Goals", icon: Target, dev: true },
  // The longest label in the rail, and the one that sets its width. Kept as-is
  // deliberately — if the rail needs to be narrower, shrink the rail, not the
  // vocabulary.
  { tab: "capabilities", label: "Capabilities", icon: ArrowsLeftRight },
  { tab: "knowledge", label: "Knowledge", icon: BookOpen },
  { tab: "endpoints", label: "Endpoints", icon: Plugs, dev: true, alwaysEnabled: true },
];

const DEV = import.meta.env.VITE_DEV === "1";

/**
 * The permanent left rail. Its buttons are TABS into the single docked left
 * panel, not independent toggles — one panel, one active tab, and clicking the
 * active tab collapses it.
 */
export function LeftRail() {
  const spec = useSpecStore((s) => s.spec);
  const leftTab = useUiStore((s) => s.leftTab);
  const toggleLeftTab = useUiStore((s) => s.toggleLeftTab);
  const items = SECTION_ITEMS.filter((i) => !i.dev || DEV);

  return (
    <nav
      aria-label="Sections"
      className="flex w-[var(--w-rail)] shrink-0 flex-col border-r border-border-default bg-surface-panel py-2"
    >
      <RailButton
        item={PROMPT_ITEM}
        active={leftTab === PROMPT_ITEM.tab}
        disabled={!spec}
        onClick={() => toggleLeftTab(PROMPT_ITEM.tab)}
      />
      <hr className="mx-auto my-1.5 w-6 border-0 border-t border-border-subtle" />
      {items.map((item) => (
        <RailButton
          key={item.tab}
          item={item}
          active={leftTab === item.tab}
          disabled={!spec && !item.alwaysEnabled}
          onClick={() => toggleLeftTab(item.tab)}
        />
      ))}
      {/* Pinned to the bottom of the rail. Inert for now — the resources it
          points at don't exist yet, and a button that navigates nowhere is
          worse than one that is visibly not ready. */}
      <div className="mt-auto flex justify-center pt-2">
        <IconButton icon={Question} label="FAQs and resources — coming soon" disabled />
      </div>
    </nav>
  );
}

function RailButton({
  item,
  active,
  disabled,
  onClick,
}: {
  item: RailItem;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={item.label}
      className={`group relative flex w-full flex-col items-center gap-1 py-1.5 ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {/* The state lives on the icon TILE, not on the whole row — same shape
          and same hover/selected treatment as IconButton in the toolbar and
          the flow-type buttons in the canvas action bar, so "pressable thing"
          looks the same everywhere. The label below is never a surface. */}
      <span
        className={`inline-flex size-9 items-center justify-center rounded-2 border transition-[background-color,border-color,color] duration-[var(--dur-1)] ease-standard ${
          disabled
            ? "border-transparent text-text-disabled"
            : active
              ? // --surface-active rather than --surface-selected: a rail tab
                // stays selected while you work, so it has to out-read a
                // transient hover, and those two tokens are 0.07 vs 0.055 apart.
                // The fill-weight glyph below is the second, non-colour signal.
                "border-border-default bg-surface-active text-text-primary"
              : "border-transparent text-text-secondary group-hover:border-border-default group-hover:bg-surface-hover"
        }`}
      >
        <Icon icon={item.icon} size={20} weight={active ? "fill" : "regular"} />
      </span>
      {/* Regular weight, not fs-micro's medium: seven labels stacked in a
          narrow column read as a list, and medium made every one of them shout.
          Tight tracking claws back the width fs-micro's positive tracking spent. */}
      <span
        className={`text-11 font-normal leading-none tracking-tight ${
          disabled
            ? "text-text-disabled"
            : active
              ? "text-text-primary"
              : "text-text-secondary group-hover:text-text-primary"
        }`}
      >
        {item.label}
      </span>
      {item.tab === "prompt" && !disabled && <PromptDiagnosticsBadge />}
    </button>
  );
}

/**
 * Error/warning count for the spec, pinned to the Prompt tab — that panel owns
 * the Problems list, so this is the count telling you to go look. Errors
 * outrank warnings rather than both showing: the rail has room for one number,
 * and an error is the one you act on first.
 *
 * Deliberately not the Badge atom. Badge is 18px with a status glyph, which at
 * a 72px rail width lands on top of the icon it is annotating. This is the same
 * palette in the smallest form that still carries a number.
 */
function PromptDiagnosticsBadge() {
  const spec = useSpecStore((s) => s.spec);
  const { errors, warnings } = useMemo(
    () => diagnosticCounts(spec ? computeDiagnostics(spec) : []),
    [spec],
  );
  if (errors === 0 && warnings === 0) return null;
  const isError = errors > 0;
  const count = isError ? errors : warnings;
  return (
    <span
      title={`${count} ${isError ? "error" : "warning"}${count === 1 ? "" : "s"} in this spec`}
      className={`fs-micro absolute right-1.5 top-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border px-1 tabular ${
        isError
          ? "border-state-error-line bg-state-error-bg text-state-error-fg"
          : "border-state-warning-line bg-state-warning-bg text-state-warning-fg"
      }`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
