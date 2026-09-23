"""Baseline measurement of analysis payload sizes from the live backend."""
import json
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8000"
NAME = "79a47536_85a406ef_NeoCortext - Take the Crown.mp3"

with urllib.request.urlopen(f"{BASE}/api/audio/analysis/by-filename/{urllib.parse.quote(NAME)}") as r:
    raw = r.read()
d = json.loads(raw)
tc = d.get("timing_contract") or {}
print(f"response bytes: {len(raw) / 1024:.0f} KiB")
print("audio:", d.get("stored_path"))
print("duration:", d.get("duration_seconds"), "| bpm:", d.get("tempo_bpm"), "| conf:", d.get("confidence"))
print("beat_count:", d.get("beat_count"), "| beat_times len:", len(d.get("beat_times") or []))
for key in ("energy_curve", "amplitude_envelope"):
    v = d.get(key) or []
    print(f"  {key}: {len(v)} points")
for key in ("amplitudeEnvelope", "energyCurve", "beats", "sections"):
    v = tc.get(key) or []
    print(f"  timing_contract.{key}: {len(v)} items")
# where do the bytes go?
sizes = {k: len(json.dumps(v)) for k, v in d.items()}
for k, v in sorted(sizes.items(), key=lambda kv: -kv[1])[:6]:
    print(f"  bytes in {k}: {v / 1024:.0f} KiB")
