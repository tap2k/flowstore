# GitHub UX for non-technical users

flowstore is GitHub-backed — the commit log is the system of record ([FILE-MODEL.md](../FILE-MODEL.md)). The current editor surfaces the underlying git model directly: PAT in Settings, repo + branch dropdowns to open, Save / Refresh icons, a conflict modal that displays a commit sha. That works for engineers; it's a steep cliff for the designers and consultants who are the primary editor audience.

This doc is the ongoing concern. The near-term plan is small. The rest is tracked here and pulled in when pilot friction surfaces.

## Problem

Shapes the editor currently exposes that non-technical users don't have a model for:

- **PAT setup** ([SettingsSheet.tsx:165-177](../packages/browser/src/components/sheets/SettingsSheet.tsx#L165-L177)). "Create a fine-grained PAT with Contents: Read & write" is the first cliff. Users with no GitHub-developer fluency bounce here.
- **Repo + branch picker** ([GitHubOpenModal.tsx](../packages/browser/src/components/toolbar/GitHubOpenModal.tsx)). Cold-start every time; "branch" is jargon.
- **Save / Refresh / conflict** ([GitHubProjectControls.tsx](../packages/browser/src/components/toolbar/GitHubProjectControls.tsx)). The conflict modal asks the user to choose between "Save anyway" and "Refresh first" with a sha shown — both options sound destructive and the sha is meaningless to a designer.
- **No safety net** if the user closes the tab dirty. Spec edits stay in-memory until explicit Save; there's no recovery path.

## Constraints

- **Pure browser app, no backend.** Octokit is called directly from the browser. Auth options that require a `client_secret` are off the table until/unless we add an edge function.
- **Commit-log hygiene is load-bearing.** GitHub is the system of record. Autosave-to-main would pollute the log with hundreds of "Update spec from flowstore editor" commits per session and destroy the reviewability that's the entire point of using GitHub. **Autosave directly to the main branch is rejected.**
- **GitHub is non-negotiable in MVP.** Alternative Git hosts are tracked in mvp-plan's "Still deferred" section and out of scope here.

## Near-term plan

Make explicit-save bulletproof. No architecture change. ~1 day of work.

1. **Loud "Unsaved changes" pill** where the Save button lives. Amber when dirty, "Saved · 12s ago" after a successful commit. Replaces the silent state today.
2. **`Cmd/Ctrl+S` keyboard shortcut** wired to the existing `doSave(false)` in [GitHubProjectControls.tsx:82](../packages/browser/src/components/toolbar/GitHubProjectControls.tsx#L82).
3. **`beforeunload` guard** when dirty — the browser's native "Are you sure you want to leave?" prompt.
4. **IndexedDB draft recovery.** Persist edits locally on every spec mutation (independent of GitHub). On app open, if there's a local draft newer than the loaded commit, prompt "You have unsaved changes from 2 hours ago. [Restore] [Discard]." Cheap insurance; no commits made.

Optional, defer if it bloats the PR:

5. **Idle nudge.** If dirty for >N minutes with no activity, surface a quiet toast: "You have unsaved changes — save to GitHub?" Tunable per how aggressive we want the safety net.

These together give Figma-grade safety (no work loss across tab close, crash, refresh) while preserving Word-grade commit hygiene.

## Deferred but tracked

Pulled in when a real pilot user hits the friction. Each has a stated trigger.

- **Rename "branch" → "draft" in UI labels.** Default branch becomes "Main version." "Save to a new branch…" becomes "Save as a new draft." Same git underneath; zero new jargon. **Trigger:** a designer asks what a branch is, or skips creating one because the affordance isn't legible.
- **Recent projects landing.** Cache the last few opened projects per account. Replace the cold repo+branch picker with a "Recent" grid + secondary "Open from GitHub…" action. **Trigger:** any user re-opens the same project more than twice.
- **History panel.** Surface the GitHub commit log as Figma-style version history ("Yesterday 3:14pm — you edited Greeting flow · [Restore]"). Sells version-control value without saying "commit." **Trigger:** a user asks how to undo a save, or a pilot loses work and asks if it's recoverable.
- **Conflict modal rework.** Show *who* changed it (lookup commit author) and *what* (a per-flow diff summary, not a sha). Options become "Keep their version" / "Keep mine" / (eventually) "Combine." **Trigger:** any pilot user hits the current modal and reports confusion.
- **Auto-merge non-overlapping edits.** When the conflict is on different flows than what the local user touched, merge silently instead of surfacing the modal at all. **Trigger:** paired with the conflict modal rework.
- **Sanitize branch names instead of validating.** [NewBranchModal](../packages/browser/src/components/toolbar/GitHubProjectControls.tsx#L334-L338) currently teaches git ref rules to the user. Replace with silent sanitization. **Trigger:** any user hits the validation error.

## Auth track

PAT-paste is the largest single cliff. Recommended replacement is **GitHub App + Device Flow** — no backend required, ~6mo refresh tokens, per-repo scoping, revocable from GitHub's UI. Tracked here because the UX motivation is identical.

Sketch: register a GitHub App, ship the `client_id` in the browser (safe — no secret), run device flow on "Connect GitHub", store the refresh token in localStorage in place of the PAT, mint access tokens silently via the existing `makeGitHubClient`. The entire GitHub section of [SettingsSheet](../packages/browser/src/components/sheets/SettingsSheet.tsx#L129-L178) becomes one button.

**Trigger:** any of (a) a pilot user bounces off PAT setup, (b) we want public sign-ups (Phase 4 course launch), (c) we add a backend for any other reason. Until then, the near-term plan (dirty pill + Cmd+S + draft recovery) carries the load.

## Open questions

- **Draft-branch autosave as a future model.** When the user starts editing, auto-create `drafts/<user>-<timestamp>` and autosave there freely — noisy commit log on the draft branch is fine. Explicit "Publish" squash-merges into main with one clean commit. Preserves main's commit hygiene, removes save anxiety, and is the natural home for the "drafts" UI rename above. Cost: per-user auth identity, draft cleanup policy, a real merge story. Not pulled in until the drafts UI lands and we're ready to own the lifecycle.
- **When to introduce a backend.** The auth track keeps us backend-free. The trigger for actually adding one (Cloudflare Workers / Hono is the recommended target) is: server-side webhooks, server-managed user state, or LLM-as-a-service (so users don't BYOK keys). When that day comes, revisit conflict UX (server-mediated CRDT becomes possible) and OAuth (web flow with `client_secret` becomes available).
