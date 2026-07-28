import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Badge } from "@/components/ui";
import { SpecChangesModal } from "@/components/toolbar/SpecChangesModal";
import { useSpecStore } from "@/lib/store/spec";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { useDirtyStore } from "@/lib/store/dirty";
import { useSettingsStore } from "@/lib/store/settings";

/**
 * The application bar: what file you have open on the left, what you can do to
 * it on the right. Everything that acts on the CONTENTS of the spec lives in
 * the left rail instead — this bar is about the file as a file.
 */
export function TopBar({ actions }: { actions: ReactNode }) {
  const spec = useSpecStore((s) => s.spec);
  return (
    <header className="flex h-[var(--h-toolbar)] shrink-0 items-center gap-3 border-b border-border-default bg-surface-panel px-3">
      {spec ? <ProjectTitle name={spec.agent.name} /> : null}
      <SaveStatePill />
      <div className="ml-auto flex items-center gap-1">{actions}</div>
    </header>
  );
}

/**
 * The filename, and a caret revealing where it actually lives. The GitHub
 * coordinates used to sit permanently under the title as a second line; they
 * are reference material you check occasionally, not something worth a
 * permanent row in the tallest-value strip of the window.
 */
function ProjectTitle({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const location = useGithubProjectStore((s) => s.location);
  const canWrite = useGithubProjectStore((s) => s.canWrite);
  const lastSavedAt = useDirtyStore((s) => s.lastSavedAt);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      wrapper.current?.querySelector("button")?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={wrapper} className="relative flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="fs-sectionTitle flex min-w-0 cursor-pointer items-center gap-1 rounded-2 border-none bg-transparent px-1.5 py-1 text-text-primary hover:bg-surface-hover"
      >
        <span className="truncate">{name}</span>
        <CaretDown size={12} weight="bold" className="shrink-0 text-text-tertiary" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-70" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Project location"
            className="absolute left-0 top-[calc(100%+6px)] z-71 w-72 animate-fs-pop-in rounded-4 border border-border-default bg-surface-raised p-3 shadow-elev-2"
          >
            <dl className="m-0 flex flex-col gap-2">
              <Row label="Location">
                {location ? (
                  <a
                    href={`https://github.com/${location.owner}/${location.repo}/tree/${location.ref}`}
                    target="_blank"
                    rel="noreferrer"
                    className="fs-data break-all text-text-primary"
                  >
                    {location.owner}/{location.repo}@{location.ref}
                  </a>
                ) : (
                  <span className="fs-data text-text-secondary">
                    Working locally — not connected to a repo
                  </span>
                )}
              </Row>
              {location && (
                <Row label="Access">
                  <span className="fs-data text-text-secondary">
                    {canWrite ? "Read and write" : "Read-only"}
                  </span>
                </Row>
              )}
              <Row label="Last saved">
                <span className="fs-data text-text-secondary">
                  {lastSavedAt ? timeAgo(lastSavedAt) : "Not saved yet"}
                </span>
              </Row>
            </dl>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="fs-micro uppercase tracking-caps text-text-tertiary">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

// Amber "Unsaved changes" when there's pending work, muted "Saved · 12s ago"
// otherwise. Tick re-renders every 15s so the relative time stays roughly fresh
// without per-frame work. The dirty pill is a button: clicking it opens a diff
// of the working copy vs the saved version on GitHub.
function SaveStatePill() {
  const spec = useSpecStore((s) => s.spec);
  const isDirty = useDirtyStore((s) => s.isDirty);
  const lastSavedAt = useDirtyStore((s) => s.lastSavedAt);
  const hasProject = useGithubProjectStore((s) => s.location !== null);
  const githubPat = useSettingsStore((s) => s.githubPat);
  const [showChanges, setShowChanges] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  if (!spec) return null;
  // Without a PAT there is nowhere to save to — "Unsaved changes" would nag
  // about an action the user can't take (localStorage autosave covers local).
  if (isDirty && !githubPat.trim()) return null;
  if (isDirty) {
    // Only offer the diff when there's a GitHub project to compare against;
    // otherwise the pill is just a status indicator.
    const badge = <Badge status="warning">Unsaved changes</Badge>;
    return (
      <>
        {hasProject ? (
          <button
            type="button"
            onClick={() => setShowChanges(true)}
            title="Compare with the saved version on GitHub"
            className="cursor-pointer border-none bg-transparent p-0"
          >
            {badge}
          </button>
        ) : (
          badge
        )}
        {showChanges && <SpecChangesModal onClose={() => setShowChanges(false)} />}
      </>
    );
  }
  if (lastSavedAt) {
    return <Badge tone="neutral">Saved · {timeAgo(lastSavedAt)}</Badge>;
  }
  return null;
}

function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString();
}
