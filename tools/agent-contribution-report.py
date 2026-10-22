# ruff: noqa: N999
"""Measure which agents contributed what to this repo, from commit trailers.

Attribution in this repo lives in `Co-authored-by:` trailers (see AGENTS.md,
"Commit attribution"); the git author field cannot be used -- most agents
commit under the owner's identity (382 of the first 465 commits are authored
`ogneocortext`). This tool reads the trailers and reports three dimensions:

  agent   the normalized trailer name (email variants collapse to one agent;
          see ALIASES -- add a row there when a new agent or spelling appears)
  area    where the commit's files live, by path prefix (see AREAS -- the
          single taxonomy every report categorizes against)
  volume  commits, files touched per area, and line churn (+/-)

Report mode (default):

  python tools/agent-contribution-report.py [--since 2026-09-29]
                                            [--format md|json]

Per-agent listing (the canonical "show me agent X's commits" query):

  python tools/agent-contribution-report.py --agent Orion [--since ...]

Why a canonical query exists: attribution lives in TWO channels that
disagree. Every local agent commits under the owner's author identity
(ogneocortext), so `git log --author` finds none of their work; and
Orion exists in both channels with different counts (88 by author vs
72 by trailer at 4e9e08d). The 16-commit gap is pre-convention Orion
work carrying no trailer at all. This tool reconciles: a commit with
no trailer whose author is Orion <orion@hatch.local> counts as
Orion's -- safe for that one identity only, because the push scripts
hardcode it and nobody else commits under it. No fallback exists for
ogneocortext (shared by the owner and every local agent). Check mode
deliberately does NOT reconcile: going forward, the trailer is the
only accepted signal.

Coverage-check mode: list the commits in scope that carry NO trailer and
fail when coverage drops below --min-coverage (default 1.0). Merge commits
are excluded -- their content arrives via branch commits, which carry
their own trailers. The default
scope is the unpushed batch (origin/main..HEAD) -- the pre-push question
"does every commit in this batch name its agent?". Pass --since/--until or
--range to audit a window of history instead (e.g. the 2026-10-01 lapse).

  python tools/agent-contribution-report.py --check [--since 2026-10-01]

Deliberately NOT a tools/check-all.py gate: history legitimately contains
pre-convention commits (the convention starts 2026-09-29), so a repo-wide
gate would be permanently red. Run the check on the batch you are about
to push, or on a window you are auditing.

Reading the numbers: churn is activity, not value -- a large deletion count
can be an agent's best work (dead-code removal). Commits and areas are the
contribution signal. A commit naming several agents credits each of them,
so agent commit counts can sum slightly past the total. The report also
footnotes the largest commits in scope (a few mega-commits dominate churn)
and warns on trailer names missing from ALIASES -- a typo'd name would
otherwise mint a phantom agent; warnings never fail the check.

Exit code: 0 = report printed / coverage check passed, 1 = check failed,
2 = git or usage error.
"""

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict

# The attribution convention's start date (AGENTS.md standing rule, 2026-09-29).
CONVENTION_START = "2026-09-29"

# Trailer name (lowercased, email stripped) -> canonical agent name.
ALIASES = {
    "orion": "Orion",
    "kilo": "Kilo",
    "cline": "Cline",
    "ling 3.1 flash": "Ling 3.1 Flash",
    "space bunny alpha": "Space Bunny Alpha",
    "opencode": "opencode",
    "devin": "Devin",
}

# Path prefix -> development area. First match wins; order matters.
AREAS = [
    ("packages/frontend/src/features/visualizer/", "Frontend: Visualizer"),
    ("packages/frontend/src/features/", "Frontend: other features"),
    ("packages/frontend/", "Frontend: core"),
    ("packages/backend/", "Backend"),
    ("docs/knowledge-library/", "Docs: knowledge library"),
    ("docs/knowledge/", "Docs: knowledge (app-served)"),
    ("docs/", "Docs: plans/arch/ux"),
    ("tools/", "Tools & gates"),
    ("unity-visualizer/", "Unity visualizer"),
    ("packages/", "Packages: other"),
    ("", "Repo root & config"),
]

UNATTRIBUTED = "(unattributed)"


def normalize_agent(raw):
    """'Kilo <kilo@native-media-ai.studio>' -> 'Kilo'; unknown names pass through."""
    name = raw.split("<")[0].strip()
    return ALIASES.get(name.lower(), name)


def area_of(path):
    for prefix, label in AREAS:
        if path.startswith(prefix):
            return label
    return "Repo root & config"


def git(*args):
    proc = subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        print(f"git error: {proc.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    return proc.stdout


def collect(scope_args):
    """Return a list of commit dicts for the given git-log scope arguments."""
    meta = {}
    out = git(
        "log",
        *scope_args,
        "--format=%H%x1f%an <%ae>%x1f%ad%x1f%s%x1f%P%x1f"
        "%(trailers:key=Co-authored-by,valueonly,separator=;)",
        "--date=short",
    )
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) != 6:
            continue
        h, author, date, subject, parents, trailers = parts
        raw_names = [t.strip() for t in trailers.split(";") if t.strip()]
        agents = sorted({normalize_agent(t) for t in raw_names})
        unknown = sorted(
            {t for t in raw_names
             if t.split("<")[0].strip().lower() not in ALIASES}
        )
        meta[h] = {
            "hash": h,
            "short": h[:7],
            "author": author,
            "author_agent": (
                "Orion"
                if author == "Orion <orion@hatch.local>" and not agents
                else None
            ),
            "date": date,
            "subject": subject,
            "agents": agents,
            "unknown": unknown,
            "merge": len(parents.split()) > 1,
            "areas": set(),
            "insertions": 0,
            "deletions": 0,
        }
    out = git("log", *scope_args, "--numstat", "--format=COMMIT%x1f%H")
    current = None
    for line in out.splitlines():
        if line.startswith("COMMIT\x1f"):
            current = line.split("\x1f", 1)[1].strip()
        elif current in meta and "\t" in line:
            bits = line.split("\t")
            if len(bits) == 3:
                entry = meta[current]
                entry["areas"].add(area_of(bits[2]))
                if bits[0].isdigit():
                    entry["insertions"] += int(bits[0])
                if bits[1].isdigit():
                    entry["deletions"] += int(bits[1])
    return list(meta.values())


def effective_agents(commit):
    """Trailer agents, or the reconciled author identity when trailer-less."""
    if commit["agents"]:
        return commit["agents"]
    return [commit["author_agent"]] if commit["author_agent"] else []


def aggregate(commits):
    agents = {}
    names = sorted({a for c in commits for a in effective_agents(c)})
    for name in names:
        mine = [c for c in commits if name in effective_agents(c)]
        areas = defaultdict(int)
        for c in mine:
            for area in c["areas"]:
                areas[area] += 1
        agents[name] = {
            "commits": len(mine),
            "insertions": sum(c["insertions"] for c in mine),
            "deletions": sum(c["deletions"] for c in mine),
            "areas": dict(areas),
        }
    unattributed = [c for c in commits if not effective_agents(c)]
    return agents, unattributed


def day_bound(value, end=False):
    """Expand a bare YYYY-MM-DD to the start (or end) of that day.

    Git's own date parser fills a bare date with the *current time of
    day*, so `--since 2026-10-22` run on 2026-10-22 silently excludes
    that day's commits. Expanding explicitly makes a bare date mean
    the whole day, in the machine's local timezone.
    """
    if value and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()):
        return value.strip() + (" 23:59:59" if end else " 00:00:00")
    return value


def unknown_tally(commits):
    tally = defaultdict(int)
    for c in commits:
        for name in c["unknown"]:
            tally[name] += 1
    return dict(tally)


def largest_commits(commits, n=5):
    ranked = sorted(
        commits, key=lambda c: -(c["insertions"] + c["deletions"])
    )[:n]
    return [
        {
            "hash": c["short"],
            "subject": c["subject"],
            "agents": c["agents"],
            "insertions": c["insertions"],
            "deletions": c["deletions"],
        }
        for c in ranked
        if c["insertions"] + c["deletions"] > 0
    ]


def scope_label(args):
    if args.range:
        return f"range {args.range}"
    bits = []
    if args.since:
        bits.append(f"since {args.since}")
    if args.until:
        bits.append(f"until {args.until}")
    return " ".join(bits) if bits else "all history"


def report_md(commits, args):
    agents, unattributed = aggregate(commits)
    total = len(commits)
    attributed = total - len(unattributed)
    coverage = (100.0 * attributed / total) if total else 0.0
    head = git("rev-parse", "--short", "HEAD").strip()
    lines = [
        "# Agent contribution report",
        "",
        f"Scope: {scope_label(args)} · HEAD {head} · "
        f"{total} commits · {attributed} attributed ({coverage:.1f}%) · "
        f"{len(unattributed)} unattributed",
        "",
        "| Agent | Commits | Share | +Lines | -Lines | Top areas |",
        "|---|---:|---:|---:|---:|---|",
    ]
    rows = sorted(agents.items(), key=lambda kv: -kv[1]["commits"])
    for name, a in rows:
        share = 100.0 * a["commits"] / total if total else 0.0
        tops = sorted(a["areas"].items(), key=lambda kv: -kv[1])[:3]
        top_s = "; ".join(f"{k} {v}" for k, v in tops)
        lines.append(
            f"| {name} | {a['commits']} | {share:.1f}% | "
            f"{a['insertions']:,} | {a['deletions']:,} | {top_s} |"
        )
    if unattributed:
        unattr_areas = defaultdict(int)
        for c in unattributed:
            for area in c["areas"]:
                unattr_areas[area] += 1
        tops = sorted(unattr_areas.items(), key=lambda kv: -kv[1])[:3]
        ins = sum(c["insertions"] for c in unattributed)
        dele = sum(c["deletions"] for c in unattributed)
        top_s = "; ".join(f"{k} {v}" for k, v in tops)
        lines.append(
            f"| {UNATTRIBUTED} | {len(unattributed)} | "
            f"{100.0 * len(unattributed) / total:.1f}% | {ins:,} | {dele:,} | {top_s} |"
        )
    lines += [
        "",
        "Area matrix (commits touching each area):",
        "",
    ]
    area_names = [label for _, label in AREAS]
    present = [a for a in area_names
               if any(a in ag["areas"] for ag in agents.values())
               or any(a in c["areas"] for c in unattributed)]
    header = "| Area | " + " | ".join([n for n, _ in rows] +
                                      ([UNATTRIBUTED] if unattributed else [])) + " |"
    lines.append(header)
    lines.append("|---|" + "---:|" * (len(rows) + (1 if unattributed else 0)))
    for area in present:
        cells = [str(agents[n]["areas"].get(area, 0)) for n, _ in rows]
        if unattributed:
            cells.append(str(sum(1 for c in unattributed if area in c["areas"])))
        lines.append(f"| {area} | " + " | ".join(cells) + " |")
    fallback = sum(1 for c in commits if c["author_agent"])
    if fallback:
        lines += ["", f"Reconciled: {fallback} trailer-less commit(s) are "
                      "attributed to Orion by author identity alone "
                      "(pre-convention work; see this tool's docstring)."]
    tally = unknown_tally(commits)
    if tally:
        lines += ["", "Warnings (trailer names outside the known roster):"]
        for name, n in sorted(tally.items(), key=lambda kv: -kv[1]):
            lines.append(f"- `{name}` on {n} commit(s) -- a typo mints a "
                         "phantom agent; add the name to ALIASES in this "
                         "tool and to the AGENTS.md attribution table.")
    biggest = largest_commits(commits)
    if biggest:
        lines += ["", "Largest commits in scope (churn concentrates here -- "
                      "discount the line counts accordingly):"]
        for b in biggest:
            who = ", ".join(b["agents"]) or UNATTRIBUTED
            lines.append(f"- `{b['hash']}` +{b['insertions']:,}/"
                         f"-{b['deletions']:,} -- {who} -- {b['subject']}")
    lines += [
        "",
        "Notes: churn is activity, not value (deletions can be the best work in "
        "a row). A commit naming several agents credits each. Commits before "
        f"{CONVENTION_START} predate the trailer convention and land in "
        f"{UNATTRIBUTED} alongside the owner's own commits and any lapses.",
    ]
    return "\n".join(lines)


def report_json(commits, args):
    agents, unattributed = aggregate(commits)
    total = len(commits)
    payload = {
        "scope": scope_label(args),
        "total_commits": total,
        "attributed_commits": total - len(unattributed),
        "unattributed_commits": len(unattributed),
        "agents": agents,
        "unknown_trailer_names": unknown_tally(commits),
        "author_fallback_commits": sum(
            1 for c in commits if c["author_agent"]
        ),
        "largest_commits": largest_commits(commits),
        "unattributed_areas": dict(
            sorted(
                ((area, sum(1 for c in unattributed if area in c["areas"]))
                 for area in {a for c in unattributed for a in c["areas"]}),
                key=lambda kv: -kv[1],
            )
        ),
    }
    return json.dumps(payload, indent=2)


def list_agent(commits, query):
    wanted = ALIASES.get(query.strip().lower(), query.strip())
    mine = [c for c in commits if wanted in effective_agents(c)]
    print(f"{wanted}: {len(mine)} commit(s) in scope")
    for c in mine:
        areas = ", ".join(sorted(c["areas"]))
        suffix = f"  [{areas}]" if areas else ""
        print(f"  {c['date']} {c['short']} {c['subject']}{suffix}")
    return 0


def check_coverage(commits, args):
    merges = sum(1 for c in commits if c["merge"])
    commits = [c for c in commits if not c["merge"]]
    total = len(commits)
    missing = [c for c in commits if not c["agents"]]
    coverage = (100.0 * (total - len(missing)) / total) if total else 100.0
    print(f"Coverage check · scope: {scope_label(args)} · "
          f"{total} commits · {coverage:.1f}% carry a Co-authored-by trailer "
          f"(threshold {args.min_coverage * 100:.0f}%)"
          + (f" · {merges} merge(s) excluded" if merges else ""))
    if total == 0:
        print("No commits in scope; nothing to check.")
        return 0
    for c in missing:
        print(f"  missing trailer: {c['short']} {c['date']} "
              f"{c['author']}: {c['subject']}")
    tally = unknown_tally(commits)
    for name, n in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  warning: unknown trailer name {name!r} on {n} commit(s) -- "
              "not in the AGENTS.md attribution table; add it to ALIASES in "
              "tools/agent-contribution-report.py and to that table.")
    if coverage / 100.0 < args.min_coverage:
        print(f"FAIL: {len(missing)} of {total} commits name no agent.")
        return 1
    print("PASS: every commit in scope names its agent."
          if not missing else "PASS: coverage is above the threshold.")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Per-agent contribution report from Co-authored-by trailers."
    )
    parser.add_argument("--since", help="git date spec, e.g. 2026-09-29")
    parser.add_argument("--until", help="git date spec")
    parser.add_argument("--range", help="revision range, e.g. origin/main..HEAD")
    parser.add_argument("--format", choices=["md", "json"], default="md")
    parser.add_argument("--agent",
                        help="list this agent's commits instead of the report")
    parser.add_argument("--check", action="store_true",
                        help="coverage-check mode (default scope: origin/main..HEAD)")
    parser.add_argument("--min-coverage", type=float, default=1.0,
                        help="check-mode threshold, 0..1 (default 1.0)")
    args = parser.parse_args()

    if args.range:
        scope = [args.range]
    elif args.since or args.until:
        scope = []
        if args.since:
            scope.append(f"--since={day_bound(args.since)}")
        if args.until:
            scope.append(f"--until={day_bound(args.until, end=True)}")
    elif args.check:
        args.range = "origin/main..HEAD"
        scope = [args.range]
    else:
        scope = []

    commits = collect(scope)
    if args.agent:
        return list_agent(commits, args.agent)
    if args.check:
        return check_coverage(commits, args)
    print(report_json(commits, args) if args.format == "json"
          else report_md(commits, args))
    return 0


if __name__ == "__main__":
    sys.exit(main())
