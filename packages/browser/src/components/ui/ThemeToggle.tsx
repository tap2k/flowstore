import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { useThemeStore, type ThemePreference } from "@/lib/store/theme";
import { IconButton } from "./IconButton";

const GLYPH: Record<ThemePreference, PhosphorIcon> = {
  light: Sun,
  dark: Moon,
  system: Desktop,
};

// The label names the CURRENT preference, not the next one. A control that says
// "Switch to dark" while showing a sun glyph makes the icon ambiguous — is it
// what you have, or what you'd get?
const LABEL: Record<ThemePreference, string> = {
  light: "Theme: light",
  dark: "Theme: dark",
  system: "Theme: system",
};

/**
 * Cycles light → dark → system. "system" is a distinct third state rather than
 * a two-way switch because following the OS is a real preference, and a plain
 * toggle silently discards it the first time the user touches it.
 */
export function ThemeToggle({ size }: { size?: "sm" | "md" | "lg" | "canvas" }) {
  const preference = useThemeStore((s) => s.preference);
  const cycle = useThemeStore((s) => s.cycle);
  return (
    <IconButton icon={GLYPH[preference]} size={size} label={LABEL[preference]} onClick={cycle} />
  );
}
