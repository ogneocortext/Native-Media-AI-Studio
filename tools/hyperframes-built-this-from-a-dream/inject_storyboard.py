"""Inject window.CONCEPT and window.STORYBOARD into both HyperFrames hosts."""
from pathlib import Path
import json

ROOT = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\tools\hyperframes-built-this-from-a-dream")

with open(ROOT / "concept.json", "r", encoding="utf-8") as f:
    concept = json.load(f)

with open(ROOT / "storyboard.built-this.json", "r", encoding="utf-8") as f:
    storyboard = json.load(f)

concept_json = json.dumps(concept, separators=(",", ":"))
storyboard_json = json.dumps(storyboard, separators=(",", ":"))

injection = f"    window.CONCEPT = {concept_json};\n    window.STORYBOARD = {storyboard_json};\n"

for rel in ["index.html", "v3/index.html"]:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    marker = "    window.DATA = "
    if marker not in text:
        raise SystemExit(f"Marker not found in {rel}")
    text = text.replace(marker, injection + marker, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Injected concept+storyboard into {rel}")
