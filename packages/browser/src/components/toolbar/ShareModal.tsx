import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useGithubProjectStore } from "@/lib/store/githubProject";
import {
  addCollaborator,
  cancelInvitation,
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [pat, location]);

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
      await addCollaborator(client, location.owner, location.repo, username, newRole);
      setNewUser("");
      await refresh();
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
      await refresh();
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
      await cancelInvitation(client, location.owner, location.repo, invitationId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Shell onClose={onClose}>
      <h2 className="text-lg font-semibold text-zinc-900 mb-1">
        Share {location ? <span className="font-mono text-sm">{location.repo}</span> : "project"}
      </h2>
      <p className="text-[11px] text-zinc-500 mb-3">
        People need a GitHub account to be added.
      </p>

      <div className="flex gap-2">
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

      <div className="mt-4">
        <h3 className="text-xs font-medium text-zinc-700 mb-1">People with access</h3>
        {loading ? (
          <p className="text-[11px] text-zinc-500">Loading…</p>
        ) : (
          <ul className="space-y-1">
            {collaborators.map((c) => (
              <li key={c.login} className="flex items-center justify-between text-sm">
                <span className="text-zinc-800">
                  @{c.login}
                  {c.login === selfLogin && <span className="ml-1 text-[11px] text-zinc-500">(you)</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500">{labelForPermission(c.permission)}</span>
                  {c.login !== selfLogin && (
                    <button
                      onClick={() => void remove(c.login)}
                      className="text-[11px] text-zinc-500 hover:text-red-700"
                    >
                      remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {invitations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-zinc-700 mb-1">Pending invites</h3>
          <ul className="space-y-1">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between text-sm">
                <span className="text-zinc-800">@{inv.invitee}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500">
                    {labelForPermission(inv.permission)} · invite pending
                  </span>
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
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <button
          onClick={onClose}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
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

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
