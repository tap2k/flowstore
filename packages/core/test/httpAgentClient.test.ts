import { describe, it, expect, vi, afterEach } from "vitest";
import { sendAgentTurn } from "@flowstore/core/runtime/httpAgentClient";
import type { AgentEndpoint } from "@flowstore/core/files/models";

// Minimal Response stand-in covering the surface sendAgentTurn touches.
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendAgentTurn — request shaping", () => {
  it("interpolates {{session_id}} and {{input}} into url and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "hi" }));
    vi.stubGlobal("fetch", fetchMock);

    const agent: AgentEndpoint = {
      turn_url: "https://api.example.com/sessions/{{session_id}}/turn",
      turn_method: "POST",
      turn_body: { message: "{{input}}", sid: "{{session_id}}", nested: ["{{input}}"] },
      response_text_path: "text",
    };
    await sendAgentTurn(agent, "sess-123", "hello there");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/sessions/sess-123/turn");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      message: "hello there",
      sid: "sess-123",
      nested: ["hello there"],
    });
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("defaults method to POST and omits body when turn_body is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const agent: AgentEndpoint = {
      turn_url: "https://api.example.com/turn",
      response_text_path: "text",
    };
    await sendAgentTurn(agent, "s", "hi");

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeUndefined();
  });

  it("merges custom turn_headers over the default Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const agent: AgentEndpoint = {
      turn_url: "https://api.example.com/turn",
      turn_headers: { Authorization: "Bearer xyz" },
      response_text_path: "text",
    };
    await sendAgentTurn(agent, "s", "hi");

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer xyz");
  });
});

describe("sendAgentTurn — response extraction", () => {
  it("extracts reply text via a nested dot-notation path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { message: "nested reply" } })));
    const agent: AgentEndpoint = {
      turn_url: "https://x/turn",
      response_text_path: "data.message",
    };
    const res = await sendAgentTurn(agent, "s", "hi");
    expect(res.text).toBe("nested reply");
    expect(res.ended).toBe(false);
  });

  it("supports array indices in the path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ choices: [{ content: "first" }] })));
    const agent: AgentEndpoint = {
      turn_url: "https://x/turn",
      response_text_path: "choices.0.content",
    };
    const res = await sendAgentTurn(agent, "s", "hi");
    expect(res.text).toBe("first");
  });

  it("reads ended_path as a boolean when present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ text: "bye", endInteraction: true })));
    const agent: AgentEndpoint = {
      turn_url: "https://x/turn",
      response_text_path: "text",
      ended_path: "endInteraction",
    };
    const res = await sendAgentTurn(agent, "s", "hi");
    expect(res.ended).toBe(true);
  });

  it("coerces a non-string match to a string", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ text: 42 })));
    const agent: AgentEndpoint = { turn_url: "https://x/turn", response_text_path: "text" };
    const res = await sendAgentTurn(agent, "s", "hi");
    expect(res.text).toBe("42");
  });

  it("preserves a genuine empty-string reply (not a config error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ text: "" })));
    const agent: AgentEndpoint = { turn_url: "https://x/turn", response_text_path: "text" };
    const res = await sendAgentTurn(agent, "s", "hi");
    expect(res.text).toBe("");
  });
});

describe("sendAgentTurn — error surfacing", () => {
  it("throws a diagnostic when response_text_path matches nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ reply: "oops wrong key" })));
    const agent: AgentEndpoint = { turn_url: "https://x/turn", response_text_path: "text" };
    await expect(sendAgentTurn(agent, "s", "hi")).rejects.toThrow(/response_text_path "text" matched nothing/);
    await expect(sendAgentTurn(agent, "s", "hi")).rejects.toThrow(/reply/); // names available keys
  });

  it("throws with status and body on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse("server boom", { ok: false, status: 500, statusText: "Internal Server Error" })),
    );
    const agent: AgentEndpoint = { turn_url: "https://x/turn", response_text_path: "text" };
    await expect(sendAgentTurn(agent, "s", "hi")).rejects.toThrow(/500.*server boom/);
  });

  it("throws 'unreachable' when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const agent: AgentEndpoint = { turn_url: "https://down.example/turn", response_text_path: "text" };
    await expect(sendAgentTurn(agent, "s", "hi")).rejects.toThrow(/unreachable at https:\/\/down\.example\/turn/);
  });
});
