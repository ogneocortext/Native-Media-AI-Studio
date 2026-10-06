#!/usr/bin/env python3
"""Rank models by advertised-free listings + observed session outcomes.

    python tools/model-reliability/score.py

Reads the latest snapshot per source in snapshots/ and observed.jsonl.
Scoring (transparent; see README.md):
    +20 per source currently listing the model as free (max 40)
    +30 if observed working within 7 days (else +15 if within 30 days)
    -50 if observed failing within 7 days
    floor 0
"""

import datetime
import glob
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SNAP_DIR = os.path.join(BASE, "snapshots")
OBSERVED = os.path.join(BASE, "observed.jsonl")


def days_ago(d):
    return (datetime.date.today() - datetime.date.fromisoformat(d)).days


def latest_snapshots():
    latest = {}
    if not os.path.isdir(SNAP_DIR):
        return latest
    for path in glob.glob(os.path.join(SNAP_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            snap = json.load(f)
        src = snap["source"]
        if src not in latest or snap["fetched_at"] > latest[src]["fetched_at"]:
            latest[src] = snap
    return latest


def load_observed():
    rows, notes = [], []
    if not os.path.exists(OBSERVED):
        return rows, notes
    # utf-8-sig, not utf-8: this file is hand-edited, and PowerShell's
    # `Set-Content -Encoding UTF8` writes a BOM. Plain utf-8 passes the BOM to
    # json.loads, which then raises "Unexpected UTF-8 BOM" on the first line and
    # takes the whole tracker down - the one file whose loss you cannot re-fetch.
    # utf-8-sig strips the BOM when present and is identical when it is not.
    with open(OBSERVED, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line:
                r = json.loads(line)
                (notes if r.get("model") == "*" else rows).append(r)
    return rows, notes


def _row_outcome(r):
    """Normalize old ({worked, date}) and new ({outcome, ts}) row shapes."""
    if "worked" in r:
        worked = bool(r["worked"])
    elif "outcome" in r:
        worked = str(r["outcome"]).lower() == "success"
    else:
        worked = True  # a logged session with no verdict is still evidence
    date = r.get("date")
    if not date and r.get("ts"):
        date = str(r["ts"])[:10]
    return worked, date


def model_observed(model, rows):
    """Return (last_worked, last_failed, notes) for one model across routes."""
    worked, failed, notes = [], [], []
    for r in rows:
        if r["model"] != model:
            continue
        ok, date = _row_outcome(r)
        if date:
            (worked if ok else failed).append(date)
        if r.get("note"):
            notes.append(f"[{r.get('route', '?')}] {r['note']}")
    return (max(worked) if worked else None,
            max(failed) if failed else None, notes)


def tier_for(score, lw, lf):
    if lf and (not lw or lf >= lw) and days_ago(lf) <= 7:
        return "AVOID"
    if lw and days_ago(lw) <= 7:
        return "RELIABLE NOW"
    if lw:
        return "worked before"
    return "listed, untested"


def score_model(sources, lw, lf):
    score = 20 * len(sources)
    if lw and days_ago(lw) <= 7:
        score += 30
    elif lw and days_ago(lw) <= 30:
        score += 15
    if lf and days_ago(lf) <= 7:
        score -= 50
    return max(0, score)


def main():
    snaps = latest_snapshots()
    rows, notes = load_observed()

    # The advertised layer is a gitignored cache: a fresh clone has no snapshots
    # until fetch_advertised.py runs. That must not hide the observed layer,
    # which is tracked and is the half that actually decides which model to use.
    advertised = {}
    for src, snap in snaps.items():
        for m in snap["models"]:
            advertised.setdefault(m["id"], set()).add(src)

    # A model can be observed-working while no snapshot currently lists it (the
    # provider dropped the listing, or the listing was never captured). It still
    # worked, so it belongs in the table rather than vanishing.
    for r in rows:
        if r["model"] not in advertised:
            advertised[r["model"]] = set()

    if not advertised:
        print("No observed sessions and no snapshots.")
        print("Run fetch_advertised.py to fetch advertised-free lists.")
        return
    table = []
    for model, sources in advertised.items():
        lw, lf, model_notes = model_observed(model, rows)
        score = score_model(sources, lw, lf)
        table.append((score, tier_for(score, lw, lf), model,
                      sorted(sources), lw, lf, model_notes))
    table.sort(key=lambda t: (-t[0], t[2]))

    print(f"{'score':>5}  {'tier':<16} model")
    print("-" * 76)
    for score, tier, model, sources, lw, lf, model_notes in table:
        # An empty source list means no snapshot listed it (a fresh clone has no
        # snapshots yet, or the provider dropped the listing). Say that rather
        # than printing a bare "()".
        prov = f" ({', '.join(sources)})" if sources else " (no snapshot)"
        print(f"{score:>5}  {tier:<16} {model}{prov}")
        if lw:
            print(f"        last worked: {lw}")
        if lf:
            print(f"        last failed: {lf}")
        for n in model_notes[:2]:
            print(f"        note: {n}")
    if notes:
        print("\nRoute-level notes:")
        for n in notes:
            print(f"  [{n.get('route')}] {n['date']}: {n['note']}")
    ages = ", ".join(f"{s} ({snaps[s]['fetched_at'][:10]})" for s in sorted(snaps))
    print(f"\nSnapshots: {ages}")


if __name__ == "__main__":
    main()
