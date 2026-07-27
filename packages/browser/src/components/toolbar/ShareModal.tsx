import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import { Shell } from "@/lib/githubUi";
import {
  addCollaborator,
  cancelInvitation,
  isForbidden,
  listCollaborators,
  listInvitations,
  makeGitHubClient,
  removeCollaborator,
  type Collaborator,
  type CollaboratorRole,
  type PendingInvitation,
} from "@flowstore/core/files/github";

interface ShareModalProps {
  onClose: () => void;
}

// Manages who can read or edit the current GitHub project. GitHub permission
// tiers higher than "write" (admin/maintain/triage) show as read-only labels
// on existing collaborators but can't be granted from here — the two
// user-facing tiers are intentionally just Read and Read & write.
export function ShareModal({ onClose }: ShareModalProps) {
  const pat = useSettingsStore((s) => s.githubPat);
  const selfLogin = useSettingsStore((s) => s.githubLogin);
  const location = useGithubProjectStore((s) => s.location);
  const setCanAdmin = useGithubProjectStore((s) => s.setCanAdmin);

  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<CollaboratorRole>("write");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    if (!pat || !location) return;
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      const [c, inv] = await Promise.all([
        listCollaborators(client, location.owner, location.repo),
        listInvitations(client, location.owner, location.repo),
      ]);
      setCollaborators(c);
      setInvitations(inv);
    } catch (e) {
      // 403 on listInvitations means the user isn't actually admin —
      // happens for legacy persisted entries (pre-canAdmin) that defaulted
      // to true. Flip the store flag so the Share button hides on the next
      // render, then close: there's nothing useful for them to do here.
      if (isForbidden(e)) {
        setCanAdmin(false);
        onClose();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [pat, location, setCanAdmin, onClose]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add() {
    const username = newUser.trim();
    if (!pat || !location || !username || adding) return;
    setAdding(true);
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      const isNewInvite = await addCollaborator(
        client,
        location.owner,
        location.repo,
        username,
        newRole,
      );
      setNewUser("");
      if (isNewInvite) {
        // listInvitations lags the addCollaborator response by a beat —
        // a refresh here would return the pre-add list and the user
        // would think nothing happened. Insert optimistically with a
        // sentinel negative id so it can't collide with real ids; the
        // next reopen reconciles with truth.
        setInvitations((prev) =>
          prev.some((p) => p.invitee.toLowerCase() === username.toLowerCase())
            ? prev
            : [...prev, { id: -Date.now(), invitee: username, permission: newRole }],
        );
      } else {
        // Already a collaborator (permission updated in place) — refresh
        // now to pick up the new role label.
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function remove(username: string) {
    if (!pat || !location) return;
    if (!window.confirm(`Remove @${username} from this project?`)) return;
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      await removeCollaborator(client, location.owner, location.repo, username);
      // Drop from local state immediately — listCollaborators sometimes
      // lags the delete and a refresh here would briefly re-show the row.
      setCollaborators((prev) => prev.filter((c) => c.login !== username));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function cancel(invitationId: number, invitee: string) {
    if (!pat || !location) return;
    if (!window.confirm(`Cancel invite to @${invitee}?`)) return;
    setError(null);
    try {
      const client = makeGitHubClient(pat);
      // Optimistic placeholders carry a negative sentinel id — GitHub
      // doesn't know them. Resolve to the real invitation id via
      // listInvitations before calling cancel. If the lookup turns up
      // nothing the invite was never created (or already gone), so we
      // just drop the local row.
      let realId = invitationId;
      if (realId < 0) {
        const invs = await listInvitations(client, location.owner, location.repo);
        const match = invs.find(
          (i) => i.invitee.toLowerCase() === invitee.toLowerCase(),
        );
        if (!match) {
          setInvitations((prev) => prev.filter((p) => p.id !== invitationId));
          return;
        }
        realId = match.id;
      }
      await cancelInvitation(client, location.owner, location.repo, realId);
      // Drop from local state immediately — both the placeholder id and
      // the resolved real id, since either could be in the list depending
      // on whether listInvitations had caught up yet.
      setInvitations((prev) =>
        prev.filter((p) => p.id !== invitationId && p.id !== realId),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const hasAnyone = collaborators.length > 0 || invitations.length > 0;

  return (
    <Shell
      onClose={onClose}
      title={
        <>
          Share{" "}
          {location ? (
            <span className="font-mono text-sm text-zinc-600">{location.repo}</span>
          ) : (
            "project"
          )}
        </>
      }
    >

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={newUser}
          onChange={(e) => {
            setNewUser(e.target.value);
            setError(null);
          }}
          placeholder="GitHub username"
          className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
        />
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as CollaboratorRole)}
          className="rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
        >
          <option value="write">Read &amp; write</option>
          <option value="read">Read</option>
        </select>
        <button
          onClick={() => void add()}
          disabled={!newUser.trim() || adding}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-red-700">{error}</p>
      )}

      {/* One unified people list — accepted collaborators and pending
          invites distinguished by the "· invite pending" suffix rather
          than a separate section header. */}
      <div className="mt-5">
        {loading ? (
          <p className="text-[11px] text-zinc-500">Loading…</p>
        ) : !hasAnyone ? (
          <p className="text-[11px] text-zinc-500">No collaborators yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {/* Fixed-width role and action columns so values align
                vertically across rows regardless of label length. */}
            {collaborators.map((c) => (
              <li key={c.login} className="flex items-center py-1.5 text-sm">
                <span className="flex-1 truncate text-zinc-800">
                  @{c.login}
                  {c.login === selfLogin && (
                    <span className="ml-1 text-[11px] text-zinc-500">(you)</span>
                  )}
                </span>
                <span className="ml-3 w-28 text-right text-[11px] text-zinc-500">
                  {labelForPermission(c.permission)}
                </span>
                <span className="ml-3 w-14 text-right">
                  {c.login !== selfLogin && (
                    <button
                      onClick={() => void remove(c.login)}
                      className="text-[11px] text-red-600 hover:text-red-700"
                    >
                      remove
                    </button>
                  )}
                </span>
              </li>
            ))}
            {invitations.map((inv) => (
              <li
                key={`inv-${inv.id}`}
                className="flex items-center py-1.5 text-sm"
              >
                <span className="flex-1 truncate text-zinc-800">
                  @{inv.invitee}
                  <span className="ml-1 text-[11px] text-amber-700">· invite pending</span>
                </span>
                <span className="ml-3 w-28 text-right text-[11px] text-zinc-500">
                  {labelForPermission(inv.permission)}
                </span>
                <span className="ml-3 w-14 text-right">
                  <button
                    onClick={() => void cancel(inv.id, inv.invitee)}
                    className="text-[11px] text-zinc-500 hover:text-red-700"
                  >
                    cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-5 text-[11px] text-zinc-400">
        People need a GitHub account to be added.
      </p>

      <div className="mt-3 flex justify-end">
        <button
          onClick={onClose}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Done
        </button>
      </div>
    </Shell>
  );
}

// Map raw permission names from GitHub to the two user-facing tiers when
// possible; surface admin/maintain/triage verbatim so existing roles aren't
// silently re-labeled.
function labelForPermission(p: string): string {
  switch (p) {
    case "admin":
      return "Admin";
    case "maintain":
      return "Maintainer";
    case "triage":
      return "Triage";
    case "write":
    case "push":
      return "Read & write";
    case "read":
    case "pull":
      return "Read";
    default:
      return p;
  }
}

