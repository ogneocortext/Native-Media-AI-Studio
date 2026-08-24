import sys
sys.path.insert(0, r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\backend")

# Demo 1: GPU availability
from app.services.cuda import cuda_available, device
print("=== GPU Status ===")
print(f"CUDA available: {cuda_available()}")
print(f"Device: {device()}")

# Demo 2: 3D generation service
from app.services.gen3d import gen3d_service
print("\n=== 3D Generation Service ===")
status = gen3d_service.get_status()
for k, v in status.items():
    print(f"  {k}: {v}")

# Demo 3: Lyrics sync mapper
from app.services.blender.lyrics_sync import LyricsSyncMapper
mapper = LyricsSyncMapper(fps=24)
lyrics = [
    {"text": "Hello world", "start": 0.5, "end": 2.0},
    {"text": "Music video", "start": 2.0, "end": 3.5},
    {"text": "Beat drops now", "start": 3.5, "end": 5.0},
]
events = mapper.map_to_events(lyrics)
print(f"\n=== Lyrics Sync ===")
print(f"Lyrics: {len(lyrics)}")
print(f"Events: {len(events)}")
for e in events:
    print(f"  Frame {e['start_frame']}-{e['end_frame']}: '{e['text']}'")

# Demo 4: Blender scene builder
from app.services.blender.builder import BlenderSceneBuilder
builder = BlenderSceneBuilder()
scripts = builder.build_full_scene({
    "stage": "space",
    "character": False,
    "beat_times": [0.5, 1.0, 1.5],
    "lyrics": lyrics,
})
print(f"\n=== Blender Scene Builder ===")
print(f"Scripts generated: {len(scripts)}")
for i, s in enumerate(scripts):
    lines = len(s.strip().split("\n"))
    first_line = s.strip().split("\n")[0][:60]
    print(f"  Script {i+1}: {lines} lines - {first_line}")
