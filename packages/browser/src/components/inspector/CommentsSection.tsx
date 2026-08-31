import { useMemo, useState } from "react";
import { useCommentsStore } from "@/lib/store/comments";
import type { Comment, CommentAnchor } from "@flowstore/core/schema/files/comment";
import { anchorKey } from "@flowstore/core/schema/files/comment";
import { AutoTextarea } from "@/components/ui";

interface CommentsSectionProps {
  anchor: CommentAnchor;
}

// Anchor-scoped comments surface. Flat list, no threading. Resolved
// comments hide by default; toggle to show. Resolve marks the file with
// `resolved: true` rather than deleting — keeps the Git-shaped audit
// trail. Lives at the bottom of whichever inspector owns the entity
// (FlowInspector today; ExitPathInspector / others can drop it in).
export function CommentsSection({ anchor }: CommentsSectionProps) {
  const commentsByAnchor = useCommentsStore((s) => s.commentsByAnchor);
  const createComment = useCommentsStore((s) => s.createComment);
  const setResolved = useCommentsStore((s) => s.setResolved);

  const key = anchorKey(anchor);
  const all = useMemo(() => commentsByAnchor.get(key) ?? [], [commentsByAnchor, key]);
  const unresolved = all.filter((c) => !c.resolved);
  const resolved = all.filter((c) => c.resolved);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  async function onPost() {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    try {
      await createComment(anchor, text);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post comment.");
    } finally {
      setPosting(false);
    }
  }

  async function onToggleResolve(commentId: string, currentlyResolved: boolean) {
    setError(null);
    try {
      await setResolved(commentId, !currentlyResolved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update comment.");
    }
  }

  const visible = showResolved ? all : unresolved;

  return (
    <div className="space-y-2 border-t border-border-default pt-4">
      <div className="flex items-center justify-between">
        <span className="fs-label text-text-secondary">
          Comments {unresolved.length > 0 && <span className="text-text-tertiary">({unresolved.length})</span>}
        </span>
        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            className="text-[10px] text-text-tertiary hover:text-text-primary underline"
          >
            {showResolved ? "hide resolved" : `show resolved (${resolved.length})`}
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <p className="text-[11px] text-text-tertiary italic">No comments yet.</p>
      )}

      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((c) => (
            <CommentItem key={c.id} comment={c} onToggleResolve={onToggleResolve} />
          ))}
        </ul>
      )}

      <div className="space-y-1 pt-2">
        <AutoTextarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          disabled={posting}
          className="w-full rounded border border-border-default p-2 fs-caption focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:bg-state-disabled-bg"
        />
        {error && <p className="text-[11px] text-state-error-fg">{error}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onPost}
            disabled={!draft.trim() || posting}
            className="rounded-md bg-emphasis px-2 py-1 fs-micro text-emphasis-fg hover:bg-emphasis-hover disabled:opacity-40"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  onToggleResolve,
}: {
  comment: Comment;
  onToggleResolve: (commentId: string, currentlyResolved: boolean) => void;
}) {
  const ts = new Date(comment.timestamp);
  const tsLabel = isNaN(ts.getTime()) ? comment.timestamp : ts.toLocaleString();
  return (
    <li
      className={
        "group rounded border px-2 py-1.5 fs-caption " +
        (comment.resolved
          ? "border-border-default bg-surface-sunken text-text-tertiary"
          : "border-border-default bg-surface-panel text-text-primary")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[10px] text-text-tertiary">
          <span className="font-mono">{comment.author}</span>
          <span className="mx-1">·</span>
          <span>{tsLabel}</span>
          {comment.resolved && <span className="ml-1 text-state-success-fg">✓ resolved</span>}
        </div>
        <button
          type="button"
          onClick={() => onToggleResolve(comment.id, comment.resolved)}
          className="text-[10px] text-text-tertiary opacity-0 hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
          title={comment.resolved ? "Reopen this comment" : "Mark as resolved"}
        >
          {comment.resolved ? "reopen" : "resolve"}
        </button>
      </div>
      <p className="mt-1 whitespace-pre-wrap leading-snug">{comment.body}</p>
    </li>
  );
}
