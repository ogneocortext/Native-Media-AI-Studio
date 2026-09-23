"""Repeatable vision-prompt eval: fixed images x fixed prompts, timed + logged.

Measures what actually matters on this rig: wall time, exit status, which
model served (and why), output length, and optional content expectations.
Appends one JSON object per case per run to vision_eval_results.jsonl so
prompt/routing changes can be compared over time.

Run from the repo root:
    python tools/tests/vision_eval.py [--only ID ...]

Images are checked-in browser-test screenshots (no new captures needed).
VRAM churn between cases is intentional — it exercises task->model routing
the way real agent sessions do.
"""

import json
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "packages" / "frontend" / "tests" / "browser" / "out"
RESULTS = Path(__file__).resolve().parent / "vision_eval_results.jsonl"

DASH = OUT_DIR / "css_audit_dashboard.png"
DARK = OUT_DIR / "css2_dark.png"
LIGHT = OUT_DIR / "css2_light.png"

CASES = [
    {
        "id": "ui-brief-low",
        "images": [DASH],
        "prompt": "List the visible UI elements and any visible errors. Keep it brief.",
        "mode": "ui",
        "args": ["--low"],
        "expect_contains": ["song", "video"],
    },
    {
        "id": "ocr-sidebar-low",
        "images": [DASH],
        "prompt": "Transcribe the sidebar navigation items only.",
        "mode": "ocr",
        "args": ["--low"],
        "expect_contains": ["Dashboard", "Visualizer"],
    },
    {
        "id": "ui-brief-fullres",
        "images": [DASH],
        "prompt": "List the visible UI elements and any visible errors. Keep it brief.",
        "mode": "ui",
        "args": [],
        "expect_contains": ["song", "video"],
    },
    {
        "id": "ocr-sidebar-fullres",
        "images": [DASH],
        "prompt": "Transcribe the sidebar navigation items only.",
        "mode": "ocr",
        "args": [],
        "expect_contains": ["Dashboard", "Visualizer"],
    },
    {
        "id": "grounding-probe",
        "images": [LIGHT],
        "prompt": "Is there a visible footer on this page? If yes, transcribe it. If not, say NOT VISIBLE.",
        "mode": "ui",
        "args": ["--low"],
        "expect_contains": [],  # behavior probe only: must exit 0, must not time out
    },
    {
        "id": "compare-dark-light",
        "images": [DARK, LIGHT],
        "prompt": "What is the single biggest visual difference between these two screenshots? One sentence.",
        "mode": "compare",
        "args": ["--low"],
        "expect_contains": [],
    },
]


def run_case(case: dict) -> dict:
    cmd = ["node", "tools/vision/analyze.mjs"]
    for img in case["images"]:
        cmd.append(str(img))
    cmd.append(case["prompt"])
    cmd += ["--mode", case["mode"], *case["args"]]
    missing = [str(i) for i in case["images"] if not i.exists()]
    if missing:
        return {"id": case["id"], "status": "SKIP", "reason": f"missing images: {missing}"}
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=560)
        dt = time.time() - t0
    except subprocess.TimeoutExpired:
        return {"id": case["id"], "status": "FAIL", "reason": "timeout>560s"}
    out = p.stdout or ""
    err = p.stderr or ""
    served = ""
    m = re.search(r"Analyzing \d+ image\(s\) with (\S+) \((.*)\)", err)
    if m:
        served = f"{m.group(1)} [{m.group(2)}]"
    missing_exp = [e for e in case.get("expect_contains", [])
                   if e.lower() not in out.lower()]
    if p.returncode != 0 or not out.strip():
        status = "FAIL"
    elif missing_exp:
        status = "WEAK"
    else:
        status = "PASS"
    return {
        "id": case["id"], "status": status,
        "exit": p.returncode, "secs": round(dt),
        "out_len": len(out), "served_by": served,
        "missing_expected": missing_exp,
        "ts": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def main(argv: list[str]) -> int:
    only = [a for a in argv if not a.startswith("-")]
    cases = [c for c in CASES if not only or c["id"] in only]
    if not cases:
        print(f"unknown case filter: {only}; available: {[c['id'] for c in CASES]}")
        return 2
    results = []
    for case in cases:
        print(f"--- {case['id']} ---", flush=True)
        r = run_case(case)
        results.append(r)
        print(f"  {r['status']} exit={r.get('exit')} secs={r.get('secs')} "
              f"len={r.get('out_len')} served_by={r.get('served_by')} "
              f"{r.get('missing_expected') or ''}", flush=True)
    with open(RESULTS, "a", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    print(f"appended {len(results)} rows to {RESULTS.name}")
    fails = [r["id"] for r in results if r["status"] == "FAIL"]
    print("FAILURES:", fails if fails else "none")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
