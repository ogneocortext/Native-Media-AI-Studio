"""
Test Hunyuan3D-2mini generation via ComfyUI API.
Uses the Hy3D custom nodes to generate a 3D mesh from a text prompt.
"""
import json
import urllib.request
import urllib.parse
import time
import os
import random

COMFYUI_URL = "http://127.0.0.1:8188"

def queue_prompt(prompt):
    """Queue a prompt for execution."""
    data = json.dumps({"prompt": prompt}).encode("utf-8")
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def get_history(prompt_id):
    """Get execution history for a prompt."""
    req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def upload_image(image_path):
    """Upload an image to ComfyUI."""
    with open(image_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/upload/image",
        data=data,
        headers={"Content-Type": "application/octet-stream"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def generate_test_image():
    """Generate a simple test image using ComfyUI."""
    # Create a simple colored image using PIL
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (512, 512), (100, 150, 200))
    draw = ImageDraw.Draw(img)
    draw.ellipse([156, 156, 356, 356], fill=(255, 200, 100))
    img_path = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\test_input.png"
    img.save(img_path)
    return img_path

def create_hunyuan3d_workflow():
    """Create a workflow for Hunyuan3D mesh generation."""
    workflow = {
        "1": {
            "inputs": {
                "model_path": "hunyuan3d-2mini"
            },
            "class_type": "Hy3DModelLoader"
        },
        "2": {
            "inputs": {
                "image": ["3", 0],
                "pipeline": ["1", 0],
                "guidance_scale": 5.5,
                "steps": 15,
                "seed": 42
            },
            "class_type": "Hy3DGenerateMesh"
        },
        "3": {
            "inputs": {
                "width": 512,
                "height": 512,
                "batch_size": 1,
                "color": 16777215
            },
            "class_type": "EmptyImage"
        },
        "4": {
            "inputs": {
                "latents": ["2", 0],
                "vae": ["1", 1],
                "num_chunks": 1000,
                "octree_resolution": 256
            },
            "class_type": "Hy3DVAEDecode"
        },
        "5": {
            "inputs": {
                "mesh": ["4", 0],
                "filename_prefix": "output/3d/hunyuan_test"
            },
            "class_type": "Hy3DExportMesh"
        }
    }
    return workflow

def main():
    print("=" * 60)
    print("Hunyuan3D-2mini Test via ComfyUI API")
    print("=" * 60)

    # Check ComfyUI is running
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/system_stats")
        with urllib.request.urlopen(req, timeout=5) as resp:
            stats = json.loads(resp.read())
            gpu = stats.get("devices", [{}])[0]
            print(f"GPU: {gpu.get('name', 'unknown')}")
            print(f"VRAM: {gpu.get('vram_free', 0) / 1024**3:.2f} GB free")
    except Exception as e:
        print(f"ERROR: Cannot connect to ComfyUI: {e}")
        return

    # Create and queue workflow
    print("\nCreating workflow...")
    workflow = create_hunyuan3d_workflow()

    print("Queueing prompt...")
    try:
        result = queue_prompt(workflow)
        prompt_id = result.get("prompt_id")
        print(f"Prompt ID: {prompt_id}")

        # Wait for completion
        print("Waiting for generation (this may take 2-5 minutes)...")
        max_wait = 300  # 5 minutes
        start = time.time()
        while time.time() - start < max_wait:
            history = get_history(prompt_id)
            if prompt_id in history:
                node_history = history[prompt_id]
                if "outputs" in node_history:
                    print("\nGeneration complete!")
                    print(f"Outputs: {list(node_history['outputs'].keys())}")
                    break
            time.sleep(5)
            print(f"  Waiting... {int(time.time() - start)}s")
        else:
            print("TIMEOUT: Generation took too long")

    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
