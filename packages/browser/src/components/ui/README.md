# flowstore ui atoms

The design system has two layers, and the rule of the repo is to never mix
them up:

1. **Look** — `src/styles/tokens.css` (colors, type roles, spacing, radii,
   elevation, motion) and the visual classes in each atom. This layer is ours,
   hand-written, and where all design decisions live. Change it freely; the
   `/?ds` gallery (dev only) shows every atom in both themes.

2. **Behavior** — focus traps, keyboard navigation, ARIA wiring, dismissal,
   positioning. This layer is **never hand-rolled**. Interactive atoms wrap a
   [Radix UI](https://www.radix-ui.com/primitives) primitive and style it with
   tokens:

   | Atom         | Primitive                      |
   | ------------ | ------------------------------ |
   | Dialog       | `@radix-ui/react-dialog`       |
   | DropdownMenu | `@radix-ui/react-dropdown-menu`|
   | Tooltip      | `@radix-ui/react-tooltip`      |
   | Tabs         | `@radix-ui/react-tabs`         |
   | Shell (lib/githubUi) | `@radix-ui/react-dialog` |

   Checkbox and Switch stay on **native inputs** — the platform primitive is
   already correct there; don't replace them with re-implementations.

   Visual-only atoms (Badge, Panel, Kbd, CodeBlock, DataChip, MetricStat,
   Button, IconButton, Input, Textarea, Select) have no behavior to get wrong
   and stay free-form.

## Rules for new/changed components

- A new interactive component (popover, combobox, context menu, toast queue,
  accordion…) starts from the matching Radix primitive. If Radix has no
  primitive for it, stop and discuss before hand-rolling.
- Never add document-level key listeners, focus traps, outside-click handlers,
  or `aria-*` bookkeeping by hand — that is the primitive's job.
- Button and IconButton spread unknown props onto their `<button>` so Radix
  `asChild` triggers can inject handlers and ARIA. Keep it that way; a new
  trigger-capable component must also forward its ref and spread rest props.
- App code never imports Radix directly — only atoms in this directory do.
  Callers use the atom APIs.
- Style only with token utilities (`surface-*`, `text-text-*`, `state-*`,
  `fs-*`, `elev-*`). A raw hex or Tailwind palette color (`zinc-500`,
  `red-600`) in app chrome is a bug. The one sanctioned exception is the
  canvas graph palette (nodes/edges), which is pinned until its retrofit.
