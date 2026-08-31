from pathlib import Path
import re

# Simulate the _get_transcript_path function
def _get_transcript_path(filename: str) -> Path:
    TRANSCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "transcriptions"
    safe_name = re.sub(r'[^\w\-.]', '_', filename)
    return TRANSCRIPT_DIR / f"{safe_name}.json"

# Test
filename = "edf93c07_85a406ef_NeoCortext - Take the Crown.mp3"
transcript_path = _get_transcript_path(filename)
print(f"Path: {transcript_path}")
print(f"Exists: {transcript_path.exists()}")

# Check if the file exists at the expected location
expected = Path("D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/transcriptions/edf93c07_85a406ef_NeoCortext_-_Take_the_Crown.mp3.json")
print(f"\nExpected: {expected}")
print(f"Exists: {expected.exists()}")
print(f"Match: {transcript_path == expected}")
