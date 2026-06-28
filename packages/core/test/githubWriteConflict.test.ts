import { describe, it, expect, afterEach, vi } from "vitest";
import { writeFileMapToRepo, ConflictError } from "@flowstore/core/files/github";
import type { GitHubLocation } from "@flowstore/core/files/github";

// Builds a fake Octokit whose getRef returns the supplied sequence of SHAs (one
// per call), and stubs the remaining write methods with fixed results so the
// commit path completes. Only the refs-API read behavior under test varies.
function fakeClient(refShas: string[]) {
  const getRef = vi.fn();
  for (const sha of refShas) {
    getRef.mockResolvedValueOnce({ data: { object: { sha } } });
  }
  // Any read past the scripted sequence repeats the last value (a stable ref).
  getRef.mockResolvedValue({ data: { object: { sha: refShas[refShas.length - 1] } } });

  const client = {
    rest: {
      git: {
        getRef,
        getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: "base-tree" } } }),
        createBlob: vi.fn().mockResolvedValue({ data: { sha: "blob" } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: "new-tree" } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: "new-commit" } }),
        updateRef: vi.fn().mockResolvedValue({}),
        createRef: vi.fn().mockResolvedValue({}),
      },
    },
  };
  return { client, getRef };
}

function loc(client: unknown): GitHubLocation {
  return { client: client as GitHubLocation["client"], owner: "o", repo: "r", ref: "main" };
}

const FILES = { "agent.json": "{}" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("writeFileMapToRepo refs-API replica lag tolerance", () => {
  it("proceeds when a lagging getRef converges to the expected SHA", async () => {
    vi.useFakeTimers();
    // First read returns the pre-save (stale) SHA, then the replica catches up.
    const { client, getRef } = fakeClient(["stale", "expected"]);

    const promise = writeFileMapToRepo(loc(client), FILES, "msg", {
      expectedCommitSha: "expected",
    });
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.commitSha).toBe("new-commit");
    expect(getRef).toHaveBeenCalledTimes(2); // re-read once to see convergence
  });

  it("throws ConflictError when the ref settles on a different SHA", async () => {
    vi.useFakeTimers();
    // Every read returns a SHA other than expected → genuine conflict.
    const { client } = fakeClient(["other"]);

    const promise = writeFileMapToRepo(loc(client), FILES, "msg", {
      expectedCommitSha: "expected",
    });
    // Surface rejection without an unhandled-rejection warning while timers run.
    const settled = promise.then(
      () => ({ ok: true as const }),
      (e) => ({ ok: false as const, e }),
    );
    await vi.runAllTimersAsync();
    const outcome = await settled;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.e).toBeInstanceOf(ConflictError);
      expect((outcome.e as ConflictError).expected).toBe("expected");
      expect((outcome.e as ConflictError).actual).toBe("other");
    }
  });

  it("does not re-read when the first getRef already matches expected", async () => {
    const { client, getRef } = fakeClient(["expected"]);

    const res = await writeFileMapToRepo(loc(client), FILES, "msg", {
      expectedCommitSha: "expected",
    });

    expect(res.commitSha).toBe("new-commit");
    expect(getRef).toHaveBeenCalledTimes(1); // converged immediately, no backoff
  });
});
