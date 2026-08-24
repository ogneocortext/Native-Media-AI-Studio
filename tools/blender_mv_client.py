#!/usr/bin/env python3
"""
Blender MCP music-video client.

Drives the blender-mcp addon socket server (port 9876) to build a
beat-synced "Take the Crown" music video scene and render 15 seconds
of frames (360 frames @ 24fps).

Usage:
    python tools/blender_mv_client.py ping
    python tools/blender_mv_client.py build
    python tools/blender_mv_client.py render [--duration 15] [--width 1280] [--height 720]
    python tools/blender_mv_client.py status
"""

import argparse
import json
import os
import socket
import sys

HOST = "127.0.0.1"
PORT = 9876

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TOOLS_DIR)
BEAT_DATA_PATH = os.path.join(TOOLS_DIR, "beat_data.json")
OUTPUT_DIR = os.path.join(PROJECT_DIR, "output", "take-the-crown-mv")
FRAMES_DIR = os.path.join(OUTPUT_DIR, "frames")
PROGRESS_PATH = os.path.join(OUTPUT_DIR, "render_progress.json")


def call_blender(cmd_type: str, params=None, timeout: float = 60.0):
    """Send a single JSON command to the Blender MCP socket server."""
    payload = json.dumps({"type": cmd_type, "params": params or {}}).encode("utf-8")
    with socket.create_connection((HOST, PORT), timeout=timeout) as sock:
        sock.sendall(payload)
        buffer = b""
        while True:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                break
            if not chunk:
                break
            buffer += chunk
            try:
                return json.loads(buffer.decode("utf-8"))
            except json.JSONDecodeError:
                continue
    raise RuntimeError(f"No response from Blender for command '{cmd_type}'")


def load_beats(duration: float):
    """Load beat times within [0, duration] from beat_data.json."""
    with open(BEAT_DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    beats = [t for t in data["beat_times"] if 0 <= t <= duration]
    print(f"Tempo: {data['tempo']:.1f} BPM | beats in 0-{duration}s window: {len(beats)}")
    return beats


BUILD_SCENE_CODE = r"""
import bpy, math, json, os

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block_list in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
    for block in list(block_list):
        if block.users == 0:
            block_list.remove(block)

scene = bpy.context.scene
world = bpy.data.worlds.get("MVWorld") or bpy.data.worlds.new("MVWorld")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.01, 0.008, 0.006, 1.0)
bg.inputs[1].default_value = 1.0

def make_mat(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        em_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if em_input:
            em_input.default_value = (*emission, 1.0)
        es = bsdf.inputs.get("Emission Strength")
        if es:
            es.default_value = emission_strength
    return mat

ash_mat  = make_mat("AshMat",  (0.04, 0.03, 0.02), metallic=0.1, roughness=0.9)
gold_mat = make_mat("GoldMat", (1.0, 0.78, 0.25), metallic=1.0, roughness=0.25)
orb_mat  = make_mat("OrbMat",  (1.0, 0.95, 0.77), metallic=0.5, roughness=0.2,
                    emission=(1.0, 0.85, 0.4), emission_strength=3.0)

bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
ground = bpy.context.active_object
ground.name = "Ground"
ground.data.materials.append(ash_mat)

crown_root = bpy.data.objects.new("CrownRoot", None)
scene.collection.objects.link(crown_root)

bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.22,
                                 location=(0, 0, 0.35))
band = bpy.context.active_object
band.name = "CrownBand"
band.parent = crown_root
band.data.materials.append(gold_mat)

for i in range(6):
    angle = (i / 6.0) * math.pi * 2
    bpy.ops.mesh.primitive_cone_add(radius1=0.12, radius2=0.001, depth=0.55,
                                    location=(math.cos(angle) * 0.85,
                                              math.sin(angle) * 0.85, 0.85))
    spike = bpy.context.active_object
    spike.name = f"Spike_{i}"
    spike.rotation_euler = (0, 0, -angle)
    spike.parent = crown_root
    spike.data.materials.append(gold_mat)

bpy.ops.mesh.primitive_uv_sphere_add(radius=0.28, location=(0, 0, 1.35))
orb = bpy.context.active_object
orb.name = "CrownOrb"
orb.parent = crown_root
orb.data.materials.append(orb_mat)

crown_root.location = (0, 0, 0)
crown_root.rotation_euler = (0, 0, math.radians(20))

sun_data = bpy.data.lights.new("Sun", type='SUN')
sun_data.energy = 3.0
sun_data.color = (1.0, 0.9, 0.75)
sun = bpy.data.objects.new("Sun", sun_data)
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)

key_data = bpy.data.lights.new("KeyLight", type='POINT')
key_data.energy = 300
key_data.color = (1.0, 0.55, 0.2)
key = bpy.data.objects.new("KeyLight", key_data)
key.location = (2.5, -2.5, 3.0)
scene.collection.objects.link(key)

rim_data = bpy.data.lights.new("RimLight", type='POINT')
rim_data.energy = 150
rim_data.color = (0.4, 0.6, 1.0)
rim = bpy.data.objects.new("RimLight", rim_data)
rim.location = (-3.0, 2.0, 2.0)
scene.collection.objects.link(rim)

pivot = bpy.data.objects.new("CameraPivot", None)
scene.collection.objects.link(pivot)
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 50
cam = bpy.data.objects.new("Camera", cam_data)
cam.parent = pivot
cam.location = (0, -8.0, 2.6)
scene.collection.objects.link(cam)
track = cam.constraints.new(type='TRACK_TO')
track.target = crown_root
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'

scene.camera = cam
print("MV_SCENE_BUILT")
"""

ANIMATE_CODE_HEADER = r"""
import bpy, math, json

FPS = {fps}
DURATION = {duration}
TOTAL_FRAMES = int(FPS * DURATION)
beats = json.loads({beats_json!r})

scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = TOTAL_FRAMES

crown = bpy.data.objects.get("CrownRoot")
pivot = bpy.data.objects.get("CameraPivot")

PULSE = 1.35
DECAY = max(3, int(FPS * 0.18))
prev = None
for t in beats:
    f = max(1, round(t * FPS))
    if prev is not None and f <= prev + DECAY:
        continue
    crown.scale = (1.0, 1.0, 1.0)
    crown.keyframe_insert(data_path="scale", frame=f)
    crown.scale = (PULSE, PULSE, PULSE)
    crown.keyframe_insert(data_path="scale", frame=f + DECAY // 2)
    crown.scale = (1.0, 1.0, 1.0)
    crown.keyframe_insert(data_path="scale", frame=f + DECAY)
    prev = f

crown.rotation_euler = (0, 0, math.radians(20))
crown.keyframe_insert(data_path="rotation_euler", frame=1)
crown.rotation_euler = (0, 0, math.radians(20) + math.pi * DURATION / 7.5)
crown.keyframe_insert(data_path="rotation_euler", frame=TOTAL_FRAMES)

for f in range(1, TOTAL_FRAMES + 1, 12):
    t = (f - 1) / TOTAL_FRAMES
    pivot.rotation_euler = (0, 0, t * math.pi * 2)
    pivot.keyframe_insert(data_path="rotation_euler", frame=f)
    pivot.location = (0.0, 0.0, t * 1.2)
    pivot.keyframe_insert(data_path="location", frame=f)

print("MV_ANIMATED beats=%d total_frames=%d" % (len(beats), TOTAL_FRAMES))
"""

RENDER_CODE_HEADER = r"""
import bpy, json, os

FRAMES_DIR = {frames_dir!r}
PROGRESS_PATH = {progress_path!r}
TOTAL_FRAMES = {total_frames}

scene = bpy.context.scene
scene.render.resolution_x = {width}
scene.render.resolution_y = {height}
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.use_overwrite = True

chosen = None
for eng in ['BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES']:
    try:
        scene.render.engine = eng
        chosen = eng
        break
    except TypeError:
        continue
if scene.render.engine == 'CYCLES':
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True

os.makedirs(FRAMES_DIR, exist_ok=True)
with open(PROGRESS_PATH, "w") as f:
    json.dump({{"done": 0, "total": TOTAL_FRAMES, "engine": chosen, "state": "rendering"}}, f)

for frame in range(scene.frame_start, TOTAL_FRAMES + 1):
    scene.frame_set(frame)
    scene.render.filepath = os.path.join(FRAMES_DIR, "frame_%04d.png" % frame)
    bpy.ops.render.render(write_still=True)
    with open(PROGRESS_PATH, "w") as f:
        json.dump({{"done": frame, "total": TOTAL_FRAMES, "engine": chosen, "state": "rendering"}}, f)

with open(PROGRESS_PATH, "w") as f:
    json.dump({{"done": TOTAL_FRAMES, "total": TOTAL_FRAMES, "engine": chosen, "state": "complete"}}, f)
print("MV_RENDER_COMPLETE %d frames" % TOTAL_FRAMES)
"""


def cmd_build():
    resp = call_blender("execute_code", {"code": BUILD_SCENE_CODE}, timeout=120)
    print(json.dumps(resp, indent=2)[:2000])
    if resp.get("status") != "success":
        sys.exit(1)


def cmd_render(duration: float, width: int, height: int):
    fps = 24
    total_frames = int(fps * duration)
    beats = load_beats(duration)
    os.makedirs(FRAMES_DIR, exist_ok=True)

    anim_code = ANIMATE_CODE_HEADER.format(
        fps=fps, duration=duration, beats_json=json.dumps(beats))
    resp = call_blender("execute_code", {"code": anim_code}, timeout=120)
    print(json.dumps(resp, indent=2)[:2000])
    if resp.get("status") != "success":
        sys.exit(1)

    render_code = RENDER_CODE_HEADER.format(
        frames_dir=FRAMES_DIR, progress_path=PROGRESS_PATH,
        total_frames=total_frames, width=width, height=height)
    resp = call_blender("execute_code", {"code": render_code},
                        timeout=max(600.0, total_frames * 5.0))
    print(json.dumps(resp, indent=2)[:2000])


def cmd_status():
    try:
        with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
            print(json.dumps(json.load(f), indent=2))
    except FileNotFoundError:
        print("No progress file yet.")
    count = 0
    if os.path.isdir(FRAMES_DIR):
        count = len([n for n in os.listdir(FRAMES_DIR) if n.endswith(".png")])
    print(f"Frames on disk: {count}")


def main():
    parser = argparse.ArgumentParser(description="Blender MCP music video client")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    sub.add_parser("build")
    p_render = sub.add_parser("render")
    p_render.add_argument("--duration", type=float, default=15.0)
    p_render.add_argument("--width", type=int, default=1280)
    p_render.add_argument("--height", type=int, default=720)
    sub.add_parser("status")
    args = parser.parse_args()

    if args.cmd == "ping":
        print(json.dumps(call_blender("ping"), indent=2))
    elif args.cmd == "build":
        cmd_build()
    elif args.cmd == "render":
        cmd_render(args.duration, args.width, args.height)
    elif args.cmd == "status":
        cmd_status()


if __name__ == "__main__":
    main()
