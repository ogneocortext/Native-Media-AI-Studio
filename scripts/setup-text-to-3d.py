#!/usr/bin/env python3
"""
Text-to-3D Setup Script for Native Media AI Studio
Creates workflow JSONs and updates knowledge library references.
"""

import json
import os
from pathlib import Path

WORKFLOWS_DIR = Path("docs/comfyui-workflows")
KNOWLEDGE_DIR = Path("docs/knowledge-library")

WORKFLOWS_DIR.mkdir(parents=True, exist_ok=True)
KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

# Workflow 1: Text → SDXL Turbo → Hunyuan3D-2mini (geometry only)
hunyuan_t2i_to_3d = {
    "last_node_id": 10,
    "last_link_id": 10,
    "nodes": [
        {"id": 1, "type": "UNETLoader", "pos": [100, 100], "size": [320, 60], "mode": 0,
         "outputs": [{"name": "MODEL", "type": "MODEL", "links": [1]}],
         "widgets_values": ["sdxl_turbo", "sdxl_turbo"]},
        {"id": 2, "type": "DualCLIPLoader", "pos": [100, 200], "size": [320, 60], "mode": 0,
         "inputs": [{"name": "model_name", "type": "MODEL", "link": None}],
         "outputs": [{"name": "CLIP", "type": "CLIP", "links": [2, 3]}],
         "widgets_values": ["sdxl_turbo", "sdxl_turbo"]},
        {"id": 3, "type": "CLIPTextEncode", "pos": [100, 320], "size": [400, 200], "mode": 0,
         "inputs": [{"name": "clip", "type": "CLIP", "link": 2}],
         "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": [4]}],
         "widgets_values": ["a 3D model of a ceramic mug with sunflower pattern, white background, product photo, high quality"]},
        {"id": 4, "type": "CLIPTextEncode", "pos": [100, 580], "size": [400, 200], "mode": 0,
         "inputs": [{"name": "clip", "type": "CLIP", "link": 3}],
         "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": [5]}],
         "widgets_values": ["low quality, blurry, text, watermark, shadow"]},
        {"id": 5, "type": "EmptyLatentImage", "pos": [100, 840], "size": [320, 120], "mode": 0,
         "outputs": [{"name": "LATENT", "type": "LATENT", "links": [6]}],
         "widgets_values": [1024, 1024, 1]},
        {"id": 6, "type": "KSampler", "pos": [600, 400], "size": [320, 420], "mode": 0,
         "inputs": [
             {"name": "model", "type": "MODEL", "link": 1},
             {"name": "positive", "type": "CONDITIONING", "link": 4},
             {"name": "negative", "type": "CONDITIONING", "link": 5},
             {"name": "latent_image", "type": "LATENT", "link": 6}
         ],
         "outputs": [{"name": "LATENT", "type": "LATENT", "links": [7]}],
         "widgets_values": [42, "normal", 1, 4]},
        {"id": 7, "type": "VAEDecode", "pos": [1000, 400], "size": [160, 40], "mode": 0,
         "inputs": [
             {"name": "samples", "type": "LATENT", "link": 7},
             {"name": "vae", "type": "VAE", "link": 8}
         ],
         "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [9]}]},
        {"id": 8, "type": "VAELoader", "pos": [1000, 200], "size": [320, 60], "mode": 0,
         "outputs": [{"name": "VAE", "type": "VAE", "links": [8]}],
         "widgets_values": ["sdxl_base_1.0.safetensors"]},
        {"id": 9, "type": "SaveImage", "pos": [1000, 500], "size": [320, 300], "mode": 0,
         "inputs": [{"name": "images", "type": "IMAGE", "link": 9}],
         "outputs": [],
         "widgets_values": ["t2d_reference"]},
        {"id": 10, "type": "Note", "pos": [600, 100], "size": [320, 200], "mode": 0,
         "inputs": [], "outputs": [],
         "widgets_values": ["Text-to-3D Pipeline (Stage 1: Text→Image)\n\n"
                             "1. Enter your text prompt in node 3\n"
                             "2. Run workflow to generate reference image\n"
                             "3. Save image and feed into Hunyuan3D-2mini image-to-3D workflow\n"
                             "4. For native text-to-3D, use Hunyuan3D-2GP gradio app with --enable_t23d\n\n"
                             "VRAM: ~4 GB for SDXL Turbo step\n"
                             "Total pipeline VRAM: ~9–10 GB (text→image→3D)"]}
    ],
    "links": [
        {"id": 1, "origin": 1, "target": 6, "slot": 0},
        {"id": 2, "origin": 2, "target": 3, "slot": 0},
        {"id": 3, "origin": 2, "target": 4, "slot": 0},
        {"id": 4, "origin": 3, "target": 6, "slot": 1},
        {"id": 5, "origin": 4, "target": 6, "slot": 2},
        {"id": 6, "origin": 5, "target": 6, "slot": 3},
        {"id": 7, "origin": 6, "target": 7, "slot": 0},
        {"id": 8, "origin": 8, "target": 7, "slot": 1},
        {"id": 9, "origin": 7, "target": 9, "slot": 0}
    ],
    "groups": [],
    "config": {},
    "extra": {"ds": {"scale": 0.7, "offset": [0, 0]}},
    "version": 0.4
}

# Workflow 2: Point-E text-to-3D (simplified)
point_e_workflow = {
    "last_node_id": 5,
    "last_link_id": 5,
    "nodes": [
        {"id": 1, "type": "TextInput", "pos": [100, 100], "size": [400, 200], "mode": 0,
         "outputs": [{"name": "TEXT", "type": "STRING", "links": [1]}],
         "widgets_values": ["a red cube with rounded edges"]},
        {"id": 2, "type": "PointE", "pos": [100, 400], "size": [320, 120], "mode": 0,
         "inputs": [{"name": "text", "type": "STRING", "link": 1}],
         "outputs": [{"name": "POINT_CLOUD", "type": "POINT_CLOUD", "links": [2]}],
         "widgets_values": ["base-40M", "cpu"]},
        {"id": 3, "type": "PointECloudToMesh", "pos": [500, 400], "size": [320, 80], "mode": 0,
         "inputs": [{"name": "point_cloud", "type": "POINT_CLOUD", "link": 2}],
         "outputs": [{"name": "MESH", "type": "MESH", "links": [3]}],
         "widgets_values": []},
        {"id": 4, "type": "SaveMesh", "pos": [900, 400], "size": [320, 80], "mode": 0,
         "inputs": [{"name": "mesh", "type": "MESH", "link": 3}],
         "outputs": [],
         "widgets_values": ["point_e_output.obj"]},
        {"id": 5, "type": "Note", "pos": [100, 600], "size": [320, 200], "mode": 0,
         "inputs": [], "outputs": [],
         "widgets_values": ["Point-E Text-to-3D\n\n"
                             "Requires: openai/point-e ComfyUI custom node\n"
                             "VRAM: ~4–6 GB\n"
                             "Output: OBJ point cloud mesh\n"
                             "Quality: Prototype / educational\n\n"
                             "Install: ComfyUI Manager → search 'Point-E'"]}
    ],
    "links": [
        {"id": 1, "origin": 1, "target": 2, "slot": 0},
        {"id": 2, "origin": 2, "target": 3, "slot": 0},
        {"id": 3, "origin": 3, "target": 4, "slot": 0}
    ],
    "groups": [],
    "config": {},
    "extra": {"ds": {"scale": 0.7, "offset": [0, 0]}},
    "version": 0.4
}

# Workflow 3: Shap-E text-to-3D
shap_e_workflow = {
    "last_node_id": 5,
    "last_link_id": 5,
    "nodes": [
        {"id": 1, "type": "TextInput", "pos": [100, 100], "size": [400, 200], "mode": 0,
         "outputs": [{"name": "TEXT", "type": "STRING", "links": [1]}],
         "widgets_values": ["a vintage typewriter, black and silver, studio lighting"]},
        {"id": 2, "type": "ShapE", "pos": [100, 400], "size": [320, 120], "mode": 0,
         "inputs": [{"name": "text", "type": "STRING", "link": 1}],
         "outputs": [{"name": "MESH", "type": "MESH", "links": [2]}],
         "widgets_values": ["cpu"]},
        {"id": 3, "type": "SaveMesh", "pos": [500, 400], "size": [320, 80], "mode": 0,
         "inputs": [{"name": "mesh", "type": "MESH", "link": 2}],
         "outputs": [],
         "widgets_values": ["shap_e_output.obj"]},
        {"id": 4, "type": "Note", "pos": [100, 600], "size": [320, 200], "mode": 0,
         "inputs": [], "outputs": [],
         "widgets_values": ["Shap-E Text-to-3D\n\n"
                             "Requires: openai/shap-e ComfyUI custom node\n"
                             "VRAM: ~6–8 GB\n"
                             "Output: OBJ textured mesh\n"
                             "Quality: Better than Point-E but still research-grade\n\n"
                             "Install: ComfyUI Manager → search 'Shap-E'"]},
        {"id": 5, "type": "Note", "pos": [500, 100], "size": [320, 200], "mode": 0,
         "inputs": [], "outputs": [],
         "widgets_values": ["Recommended: Hunyuan3D-2mini\n\n"
                             "For best quality on 8 GB VRAM,\n"
                             "use Hunyuan3D-2mini image-to-3D\n"
                             "with a reference image generated\n"
                             "by SDXL Turbo (see sibling workflow).\n\n"
                             "See text-to-3d-options-2026.md\n"
                             "for the full decision matrix."]}
    ],
    "links": [
        {"id": 1, "origin": 1, "target": 2, "slot": 0},
        {"id": 2, "origin": 2, "target": 3, "slot": 0}
    ],
    "groups": [],
    "config": {},
    "extra": {"ds": {"scale": 0.7, "offset": [0, 0]}},
    "version": 0.4
}

# Save workflows
workflows = {
    "text-to-3d-sdxl-reference.json": hunyuan_t2i_to_3d,
    "point-e-text-to-3d.json": point_e_workflow,
    "shap-e-text-to-3d.json": shap_e_workflow
}

for name, wf in workflows.items():
    path = WORKFLOWS_DIR / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2)
    print(f"Created: {path}")

print("\nDone. Workflows created in docs/comfyui-workflows/")
