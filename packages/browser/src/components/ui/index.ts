// Flowstore design system — foundation layer.
//
// Ported from the Claude Design handoff bundle. Tokens live in
// styles/tokens.css and are exposed as Tailwind utilities via the @theme block
// in styles/globals.css; the `.fs-*` type role classes are the preferred way to
// set typography, since size, weight and optical tracking only work as a set.
//
// Two deliberate deviations from the bundle:
//   - Icons are @phosphor-icons/react components, not webfont class names. The
//     app's CSP (public/_headers) allows font-src 'self' only, so the bundle's
//     jsDelivr webfont import would be blocked in production.
//   - Components are Tailwind-class TSX rather than inline-style JSX with
//     useState hover tracking, matching the rest of packages/browser.
//
// Not ported: NodeIcon / NODE_ICONS. Those map a node taxonomy (Trigger, LLM
// Call, Tool Call, ...) that the bundle's own readme notes was invented from a
// written brief; the real canvas models flow *types* instead. See
// components/canvas/FlowNode.tsx.

export { DisclosureCaret } from "./DisclosureCaret";
export { Icon, type IconProps, type IconSize, type IconWeight } from "./Icon";
export { StatusIcon, type StatusIconProps, type Status } from "./StatusIcon";
export { ThemeToggle } from "./ThemeToggle";

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { IconButton, type IconButtonProps, type IconButtonSize } from "./IconButton";
export { Input, type InputProps } from "./Input";
export { Textarea, type TextareaProps } from "./Textarea";
export { Select, type SelectProps, type SelectOption } from "./Select";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export { Switch, type SwitchProps } from "./Switch";
export { Badge, type BadgeProps, type BadgeTone } from "./Badge";
export { Kbd, type KbdProps } from "./Kbd";
export { Panel, type PanelProps } from "./Panel";
export { Tabs, type TabsProps, type TabItem } from "./Tabs";

export { CodeBlock, type CodeBlockProps } from "./CodeBlock";
export { DataChip, type DataChipProps } from "./DataChip";
export { FieldRow, type FieldRowProps } from "./FieldRow";
export { MetricStat, type MetricStatProps, type MetricTone } from "./MetricStat";

export { Tooltip, type TooltipProps, type TooltipSide } from "./Tooltip";
export { DropdownMenu, type DropdownMenuProps, type MenuItemSpec } from "./DropdownMenu";
export { Dialog, type DialogProps } from "./Dialog";
export { Toast, type ToastProps } from "./Toast";
