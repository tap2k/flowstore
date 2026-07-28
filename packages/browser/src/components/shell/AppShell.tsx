import type { ReactNode } from "react";

interface AppShellProps {
  topBar: ReactNode;
  rail: ReactNode;
  /** The docked left panel — null when no rail tab is active. */
  leftPanel: ReactNode;
  canvas: ReactNode;
  /**
   * The right-hand panels, in DOM order: node controls, assistant, simulate.
   * Order is the layout — the last one rendered is the one against the right
   * edge of the screen.
   */
  rightPanels: ReactNode;
  /**
   * Modals, sheets and anything else with a `fixed` scrim. Rendered outside the
   * workspace on purpose: the workspace is a container-query container, which
   * makes it a containing block for fixed descendants (see globals.css).
   */
  overlays?: ReactNode;
  /**
   * How many docked panels are currently open (0-4). Drives the canvas-collapse
   * breakpoints in globals.css — see the .fs-workspace block there.
   */
  panelCount: number;
}

/**
 * The workspace frame. Owns geometry only: what goes where, and how the space
 * is divided when panels crowd the canvas out. It deliberately knows nothing
 * about what any panel contains, so panels can be added or reordered without
 * touching layout logic.
 */
export function AppShell({
  topBar,
  rail,
  leftPanel,
  canvas,
  rightPanels,
  overlays,
  panelCount,
}: AppShellProps) {
  return (
    <>
      <div className="fs-root flex h-screen flex-col bg-surface-canvas">
        {topBar}
        <div className="fs-workspace" data-panels={panelCount}>
          {rail}
          {leftPanel}
          <div className="fs-canvas-slot relative">{canvas}</div>
          {rightPanels}
        </div>
      </div>
      {overlays}
    </>
  );
}
