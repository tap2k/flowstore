import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export interface AutoTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * A textarea that grows to fit its content and never shows the native resize
 * grip. Two problems, one component:
 *
 *  - The grip is a white/system-drawn square that ignores the theme, and it
 *    landed in the bottom-right corner of every field in the inspector and the
 *    left-panel sheets. `resize-none` removes it.
 *  - Dropping the grip removes the only way to see text past the fixed `rows`
 *    height, so the height has to follow the content instead.
 *
 * A `min-h-*` class in `className` still applies as a floor, since this only
 * ever sets an inline height.
 *
 * Height is measured, not computed from line counts: reset to `auto`, read
 * `scrollHeight`, write it back. `scrollHeight` excludes the border but
 * `box-sizing: border-box` (Tailwind's default) makes `height` include it, so
 * the border width is added back — otherwise every field sits ~2px short and
 * shows a scrollbar it doesn't need.
 */
export function AutoTextarea({ className, onChange, ...rest }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = `${el.scrollHeight + border}px`;
  }, []);

  // Layout effect, not effect: resizing after paint makes every field visibly
  // jump from its `rows` height to its real one on mount.
  useLayoutEffect(resize);

  // Width changes re-wrap the text, which changes the height the content needs
  // — panels opening and closing resize these fields without the value ever
  // changing, so a value-only effect would leave them clipped.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

  return (
    <textarea
      ref={ref}
      onChange={(e) => {
        resize();
        onChange?.(e);
      }}
      className={`resize-none overflow-hidden ${className ?? ""}`}
      {...rest}
    />
  );
}
