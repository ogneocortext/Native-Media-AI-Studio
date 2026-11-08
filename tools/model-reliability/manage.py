#!/usr/bin/env python3
"""
Model Reliability Manager
Utilities for managing the model reliability tracker (roster.md, observed.jsonl, score.py)
"""

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent
ROSTER = BASE / "roster.md"
OBSERVED = BASE / "observed.jsonl"
SCORE_SCRIPT = BASE / "score.py"


def log_outcome(model: str, route: str, note: str, *,
                worked: bool,
                task_type: str = "general", agent_type: str = "unknown",
                duration_seconds: int = 0, tokens_used: int = 0):
    """Append an outcome to observed.jsonl"""
    entry = {
        "date": datetime.date.today().isoformat(),
        "model": model,
        "route": route,
        "worked": worked,
        "note": note,
        "task_type": task_type,
        "agent_type": agent_type,
        "duration_seconds": duration_seconds,
        "tokens_used": tokens_used
    }

    with open(OBSERVED, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")

    print(f"Logged: {model} @ {route} - {'WORKED' if worked else 'FAILED'} - {note}")


def run_score():
    """Run the score.py script"""
    result = subprocess.run([sys.executable, str(SCORE_SCRIPT)],
                          capture_output=True)
    stdout = result.stdout.decode("utf-8", "replace")
    stderr = result.stderr.decode("utf-8", "replace")
    print(stdout)
    if stderr:
        print(stderr, file=sys.stderr)
    return result.returncode


def update_roster():
    """Update roster.md based on latest observed data"""
    # This would be implemented to auto-update roster.md
    # For now, just run score to show current rankings
    print("Current model rankings:")
    run_score()


def main():
    parser = argparse.ArgumentParser(description="Model Reliability Manager")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Log command
    log_parser = subparsers.add_parser("log", help="Log an outcome to observed.jsonl")
    log_parser.add_argument("--model", required=True, help="Model ID (e.g., stepfun/step-5-preview-free)")
    log_parser.add_argument("--route", required=True, help="Route (kilo, cline, opencode, atomic_chat, codex, devin)")
    log_parser.add_argument("--worked", type=lambda x: x.lower() == "true", required=True, help="Whether it worked (true/false)")
    log_parser.add_argument("--note", required=True, help="Note about the outcome")
    log_parser.add_argument("--task-type", default="general", help="Task type")
    log_parser.add_argument("--agent-type", default="unknown", help="Agent type")
    log_parser.add_argument("--duration", type=int, default=0, help="Duration in seconds")
    log_parser.add_argument("--tokens", type=int, default=0, help="Tokens used")

    # Score command
    subparsers.add_parser("score", help="Run score.py to show rankings")

    # Update roster
    subparsers.add_parser("update-roster", help="Update roster.md from observed data")

    args = parser.parse_args()

    if args.command == "log":
        log_outcome(args.model, args.route, args.note,
                   worked=args.worked, task_type=args.task_type,
                   agent_type=args.agent_type,
                   duration_seconds=args.duration, tokens_used=0)
    elif args.command == "score":
        run_score()
    elif args.command == "update-roster":
        update_roster()


if __name__ == "__main__":
    main()
