"""
Worked example: drive a flowstore spec through a test case with the Gemini API.

This is one shape, not THE shape. Adapt for your provider, evaluator
framework, and result-handling needs.

Usage:
  cd examples/coffee-testing
  python scripts/run_scripted.py tests/cases/happy-path-latte.test.json

  # Compare a hand-authored prompt against the flowstore-compiled one,
  # against the same test case and tool schemas:
  python scripts/run_scripted.py tests/cases/happy-path-latte.test.json \
    --system-prompt /path/to/your-prompt.txt \
    --label nikunj-handauth

Requirements:
  GOOGLE_API_KEY (or GEMINI_API_KEY) env var
  pip install -r scripts/requirements.txt
  flowstore checked out at ../../  (so we can shell out to flowstore-compile)

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

# google-genai is imported lazily after arg parsing so --help works without
# the SDK installed.

# ----- inputs -----

parser = argparse.ArgumentParser(description="Drive a flowstore test case through the Gemini API.")
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
         "Useful for tagging comparison runs: --label flowstore vs --label handauth.",
)
args = parser.parse_args()

CASE_PATH = Path(args.case).resolve()
PROJECT = CASE_PATH.parents[2]  # tests/cases/<file>.json -> project root
FLOWSTORE_REPO = (PROJECT / ".." / "..").resolve()  # examples/coffee-testing -> flowstore

if not CASE_PATH.exists():
    sys.exit(f"test case not found: {CASE_PATH}")
if args.system_prompt is not None and not args.system_prompt.exists():
    sys.exit(f"--system-prompt file not found: {args.system_prompt}")

case = json.loads(CASE_PATH.read_text())

# Defer the SDK import until after arg parsing + path checks so --help
# (and obvious path mistakes) don't require the package to be installed.
from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

# ----- 1. compile the spec into {system_prompt, tool_schemas} -----

# In a customer's repo this would invoke a published @flowstore/cli; today we
# shell out to the local workspace. Either way, the output is the contract.
proc = subprocess.run(
    [
        "npm", "-w", "@flowstore/core", "run", "--silent", "flowstore-compile", "--",
        str(PROJECT), "--format", "prompt",
    ],
    cwd=FLOWSTORE_REPO,
    capture_output=True,
    text=True,
    check=True,
)
compiled = json.loads(proc.stdout)
tool_schemas: list[dict[str, Any]] = compiled["tool_schemas"]

# Either use the flowstore-compiled prompt (default) or a hand-authored override.
# Tool schemas always come from the spec — that's how comparison runs stay
# apples-to-apples.
if args.system_prompt is not None:
    system_prompt: str = args.system_prompt.read_text()
else:
    system_prompt: str = compiled["system_prompt"]

# Gemini's FunctionDeclaration takes `parameters` directly — same field name
# `flowstore-compile` emits, no rename needed (unlike Anthropic's input_schema).
# Strip "additionalProperties" because the Gemini schema validator rejects it.
def _gemini_clean(schema: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in schema.items() if k != "additionalProperties"}
    if "properties" in out and isinstance(out["properties"], dict):
        out["properties"] = {k: _gemini_clean(v) for k, v in out["properties"].items()}
    return out


gemini_tools = [
    types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name=t["name"],
            description=t["description"],
            parameters=_gemini_clean(t["parameters"]),
        )
        for t in tool_schemas
    ])
]

# ----- 2. load mocks, indexed by (capability_id, variant) -----

mocks: dict[tuple[str, str], dict[str, Any]] = {}
for p in (PROJECT / "capabilities").glob("*.mock.json"):
    m = json.loads(p.read_text())
    mocks[(m["capability_id"], m["variant"])] = m

# Gemini's function_call parts return the tool *name* (the spec's
# capability.name, snake_case dispatch identifier). Mocks are keyed by
# capability *id*. Build a name -> id map from the agent envelope so we can
# translate the LLM's tool call back to a binding lookup.
agent = json.loads((PROJECT / "agent.json").read_text())
NAME_TO_ID: dict[str, str] = {
    c["name"]: c["id"] for c in agent.get("capabilities", [])
}


def dispatch_mock(tool_name: str, args_in: dict[str, Any]) -> tuple[Any, str | None]:
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

api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
if not api_key:
    sys.exit("set GOOGLE_API_KEY or GEMINI_API_KEY in your environment")

client = genai.Client(api_key=api_key)
model = case.get("model", "gemini-2.5-flash")

# Conversation history as a list of Content objects. Gemini takes the system
# instruction out-of-band via the GenerateContentConfig (mirrors Anthropic's
# `system` parameter). User+model turns + function calls/responses go here.
contents: list[types.Content] = []
transcript: list[dict[str, Any]] = []
capability_calls: list[dict[str, Any]] = []
run_error: str | None = None

config = types.GenerateContentConfig(
    system_instruction=system_prompt,
    tools=gemini_tools,
    temperature=0.0,
)

try:
    for user_turn in case["user_turns"]:
        transcript.append({"role": "user", "content": user_turn})
        contents.append(
            types.Content(role="user", parts=[types.Part.from_text(text=user_turn)])
        )

        # Inner loop: the model may chain multiple function calls before
        # producing a text turn we hand to the user. Cap iterations to
        # avoid runaway loops in a broken test.
        for _ in range(8):
            resp = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            candidate = resp.candidates[0]
            parts = candidate.content.parts or []
            # Persist the model's turn verbatim so the next call has full history.
            contents.append(types.Content(role="model", parts=parts))

            text_parts = [p.text for p in parts if getattr(p, "text", None)]
            if text_parts:
                transcript.append({
                    "role": "agent",
                    "content": "\n".join(t for t in text_parts if t),
                })

            fn_calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
            if not fn_calls:
                break

            # Build a user-role Content full of function_response parts.
            response_parts: list[types.Part] = []
            for fc in fn_calls:
                fc_args = dict(fc.args) if fc.args else {}
                result, err = dispatch_mock(fc.name, fc_args)
                call_record: dict[str, Any] = {
                    # capability_calls[].capability uses the spec's capability id
                    # (not the runtime tool name) so evaluators can pivot
                    # consistently regardless of LLM-provider naming.
                    "capability": NAME_TO_ID.get(fc.name, fc.name),
                    "params": fc_args,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                if err is not None:
                    call_record["error"] = err
                    response_parts.append(types.Part.from_function_response(
                        name=fc.name,
                        response={"error": err},
                    ))
                else:
                    call_record["result"] = result
                    response_parts.append(types.Part.from_function_response(
                        name=fc.name,
                        response=result if isinstance(result, dict) else {"value": result},
                    ))
                capability_calls.append(call_record)

            contents.append(types.Content(role="user", parts=response_parts))
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
    str(args.system_prompt) if args.system_prompt is not None else "flowstore-compile"
)

result: dict[str, Any] = {
    "$schema": "flowstore://run/result/v0",
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
