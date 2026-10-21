# ruff: noqa: N999
"""Audit row counts in the studio DB to detect test-suite pollution."""

import sqlite3
from pathlib import Path

DB = Path("storage/studio.db")
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
tables = [
    r[0]
    for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
]
for t in tables:
    n = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
    print(f"{t:40s} {n}")
