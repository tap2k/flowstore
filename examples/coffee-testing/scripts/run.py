"""
Worked example: drive a UX4 spec through a test case with the Anthropic API.

This is one shape, not THE shape. Adapt for your provider, evaluator
framework, and result-handling needs.

Usage:
  cd examples/coffee-testing
  python scripts/run.py tests/cases/happy-path-latte.test.json

  # Compare a hand-authored prompt against the UX4-compiled one,
  # against the same test case and tool schemas:
  python scripts/run.py tests/cases/happy-path-latte.test.json \
    --system-prompt /path/to/your-prompt.txt \
    --label nikunj-handauth

Requirements:
  ANTHROPIC_API_KEY env var
  pip install -r scripts/requirements.txt
  uxflows checked out at ../../  (so we can shell out to ux4-compile)

Contract:
  Reads:  tests/cases/<id>.test.json, capabilities/<id>.<variant>.mock.json
  Writes: tests/runs/<timestamp>-<label>/<test_case_id>.result.json

See docs/testing-from-scripts.md for the full reference.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ----- inputs -----

parser = argparse.ArgumentParser(description="Drive a UX4 test case through the Anthropic API.")
parser.add_argument("case", help="Path to a tests/cases/<id>.test.json file")
parser.add_argument(
    "--system-prompt",
    type=Path,
    default=None,
    help="Override the compiled prompt with a hand-authored one (plain text file). "
         "Tool schemas still come from the spec, so the comparison stays apples-to-apples.",
)
parser.add_argument(
    "--label",
    default="manual",
    help="Sub-directory tag under tests/runs/ (default: 'manual'). "
         "Useful for tagging comparison runs: --label ux4 vs --label handauth.",
)
args = parser.parse_args()

CASE_PATH = Path(args.case).resolve()
PROJECT = CASE_PATH.parents[2]  # tests/cases/<file>.json -> project root
UXFLOWS_REPO = (PROJECT / ".." / "..").resolve()  # examples/coffee-testing -> uxflows

if not CASE_PATH.exists():
    sys.exit(f"test case not found: {CASE_PATH}")
if args.system_prompt is not None and not args.system_prompt.exists():
    sys.exit(f"--system-prompt file not found: {args.system_prompt}")

case = json.loads(CASE_PATH.read_text())

# ----- 1. compile the spec into {system_prompt, tool_schemas} -----

# In a customer's repo this would invoke a published @ux4/cli; today we
# shell out to the local workspace. Either way, the output is the contract.
proc = subprocess.run(
    [
        "npm", "-w", "@ux4/core", "run", "--silent", "ux4-compile", "--",
        str(PROJECT), "--format", "prompt",
    ],
    cwd=UXFLOWS_REPO,
    capture_output=True,
    text=True,
    check=True,
)
compiled = json.loads(proc.stdout)
tool_schemas: list[dict[str, Any]] = compiled["tool_schemas"]

# Either use the UX4-compiled prompt (default) or a hand-authored override.
# Tool schemas always come from the spec — that's how comparison runs stay
# apples-to-apples.
if args.system_prompt is not None:
    system_prompt: str = args.system_prompt.read_text()
else:
    system_prompt: str = compiled["system_prompt"]

# Anthropic's API wants tools with `input_schema`, not `parameters`. Rename.
anthropic_tools = [
    {
        "name": t["name"],
        "description": t["description"],
        "input_schema": t["parameters"],
    }
    for t in tool_schemas
]

# ----- 2. load mocks, indexed by (capability_id, variant) -----

mocks: dict[tuple[str, str], dict[str, Any]] = {}
for p in (PROJECT / "capabilities").glob("*.mock.json"):
    m = json.loads(p.read_text())
    mocks[(m["capability_id"], m["variant"])] = m

# Anthropic's tool_use blocks return the tool *name* (the spec's
# capability.name, snake_case dispatch identifier). Mocks are keyed by
# capability *id*. Build a name -> id map from the agent envelope so we can
# translate the LLM's tool call back to a binding lookup.
agent = json.loads((PROJECT / "agent.json").read_text())
NAME_TO_ID: dict[str, str] = {
    c["name"]: c["id"] for c in agent.get("capabilities", [])
}


def dispatch_mock(tool_name: str, args: dict[str, Any]) -> tuple[Any, str | None]:
    """Return (result, error). Either result or error is non-None.
    Raises if the test case didn't bind a mock for this capability — silent
    defaults mask broken tests."""
    capability_id = NAME_TO_ID.get(tool_name)
    if capability_id is None:
        raise RuntimeError(
            f"tool '{tool_name}' did not map to any capability.id; "
            f"check agent.capabilities[].name"
        )
    variant = case.get("mock_bindings", {}).get(capability_id)
    if variant is None:
        raise RuntimeError(
            f"unbound capability '{capability_id}' — add it to "
            f"mock_bindings in {CASE_PATH.name}"
        )
    mock = mocks.get((capability_id, variant))
    if mock is None:
        raise RuntimeError(
            f"no mock at capabilities/{capability_id}.{variant}.mock.json"
        )
    behavior = mock["behavior"]
    if behavior["kind"] == "static":
        return behavior["returns"], None
    if behavior["kind"] == "error":
        return None, behavior["error"]
    raise RuntimeError(f"unknown mock behavior kind: {behavior['kind']}")


# ----- 3. drive the LLM through user_turns -----

from anthropic import Anthropic

client = Anthropic()
model = case.get("model", "claude-sonnet-4-5")

transcript: list[dict[str, Any]] = []
capability_calls: list[dict[str, Any]] = []
messages: list[dict[str, Any]] = []
run_error: str | None = None

try:
    for user_turn in case["user_turns"]:
        transcript.append({"role": "user", "content": user_turn})
        messages.append({"role": "user", "content": user_turn})

        # Inner loop: the assistant may chain multiple tool calls before
        # producing a text turn we hand to the user. Cap iterations to
        # avoid runaway loops in a broken test.
        for _ in range(8):
            resp = client.messages.create(
                model=model,
                system=system_prompt,
                tools=anthropic_tools,
                messages=messages,
                max_tokens=1024,
            )
            messages.append({"role": "assistant", "content": resp.content})

            text_parts = [b.text for b in resp.content if b.type == "text"]
            if text_parts:
                transcript.append({
                    "role": "agent",
                    "content": "\n".join(text_parts),
                })

            tool_uses = [b for b in resp.content if b.type == "tool_use"]
            if not tool_uses:
                break

            tool_results = []
            for tu in tool_uses:
                result, err = dispatch_mock(tu.name, tu.input)
                # capability_calls[].capability uses the spec's capability id
                # (not the runtime tool name) so evaluators can pivot
                # consistently regardless of LLM-provider naming.
                call_record = {
                    "capability": NAME_TO_ID.get(tu.name, tu.name),
                    "params": tu.input,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                if err is not None:
                    call_record["error"] = err
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "is_error": True,
                        "content": err,
                    })
                else:
                    call_record["result"] = result
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": json.dumps(result),
                    })
                capability_calls.append(call_record)

            messages.append({"role": "user", "content": tool_results})
        else:
            run_error = "exceeded inner tool-call budget (8 iterations)"
            break
except Exception as e:  # noqa: BLE001 — record any unexpected fault
    run_error = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"

# ----- 4. write the result file -----

now = datetime.now(timezone.utc)
run_dir = PROJECT / "tests" / "runs" / f"{now.strftime('%Y%m%dT%H%M%SZ')}-{args.label}"
run_dir.mkdir(parents=True, exist_ok=True)

prompt_source = (
    str(args.system_prompt) if args.system_prompt is not None else "ux4-compile"
)

result: dict[str, Any] = {
    "$schema": "UX4://result/v0",
    "test_case_id": case["id"],
    "timestamp": now.isoformat(),
    "agent_id": "agent_bluebird_coffee",
    "model": model,
    "prompt_source": prompt_source,
    "transcript": transcript,
    "capability_calls": capability_calls,
    "evaluator_results": [],
}
if run_error is not None:
    result["error"] = run_error

out_path = run_dir / f"{case['id']}.result.json"
out_path.write_text(json.dumps(result, indent=2) + "\n")
print(f"wrote {out_path.relative_to(PROJECT)}")
if run_error:
    print(f"  with error: {run_error}", file=sys.stderr)
    sys.exit(1)
