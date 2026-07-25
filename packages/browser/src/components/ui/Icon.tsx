import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

// One outline weight, three sizes — that is the whole icon system.
//
// The design system loads Phosphor Regular and nothing else for ordinary UI: five
// weights would be five decisions per glyph with no reader benefit. Two exceptions
// stay available, and neither is a choice page code should make:
//   bold — 11-13px micro glyphs (carets, checks, tree twisties) where Regular's
//          stroke dissolves, and the active state of a toolbar toggle.
//   fill — StatusIcon only, where a silhouette must read at 12px in monochrome.
// A filled icon in this app always means "this is a status".
export type IconSize = "sm" | "md" | "lg";
export type IconWeight = "regular" | "bold" | "fill";

// Mirrors --icon-sm/md/lg in styles/tokens.css. Duplicated as numbers because
// Phosphor takes a numeric size prop, not a CSS length.
const SIZES: Record<IconSize, number> = {
  sm: 14, // dense rows, menu items, breadcrumbs, inline-in-text
  md: 16, // DEFAULT — toolbar, buttons, palette rows, inspector rows
  lg: 20, // floating canvas controls, empty states
};

export interface IconProps {
  /** The Phosphor component itself, e.g. `import { Wrench } from "@phosphor-icons/react"`. */
  icon: PhosphorIcon;
  /** 'sm' | 'md' (default) | 'lg', or a raw px number for the few sub-14px micro glyphs. */
  size?: IconSize | number;
  /** Leave unset. See the note above before reaching for 'bold' or 'fill'. */
  weight?: IconWeight;
  /** Defaults to currentColor, so an icon inherits the text colour of its control. */
  color?: string;
  /** Accessible label. Omit for decorative icons — they render aria-hidden. */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The single chokepoint for icon size and weight. Importing a Phosphor component
 * directly works, but bypasses the size→context mapping above, which is the one
 * thing keeping icons consistent across screens.
 */
export function Icon({
  icon: Glyph,
  size = "md",
  weight = "regular",
  color = "currentColor",
  title,
  className,
  style,
}: IconProps) {
  const px = typeof size === "number" ? size : SIZES[size];
  return (
    <Glyph
      // `flex-none` because an icon in a flex row must never be the thing that
      // shrinks when the label is long.
      className={`inline-flex flex-none${className ? ` ${className}` : ""}`}
      size={px}
      weight={weight}
      color={color}
      style={style}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
    />
  );
}
