"""
Queue a Hunyuan3D workflow via ComfyUI API.
"""
import json
import urllib.request
import time
import os

COMFYUI_URL = "http://127.0.0.1:8188"
WORKFLOW_PATH = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\workflows\hunyuan3d-mesh-gen.json"
LOG_PATH = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\logs\3d-gen-queue.log"

def log(msg):
    with open(LOG_PATH, "a") as f:
        f.write(msg + "\n")
    print(msg)

def queue_prompt(prompt):
    data = json.dumps({"prompt": prompt}).encode("utf-8")
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def get_history(prompt_id):
    req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def get_queue():
    req = urllib.request.Request(f"{COMFYUI_URL}/queue")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def main():
    log("=" * 60)
    log("Hunyuan3D-2mini Mesh Generation Test")
    log("=" * 60)

    # Load workflow
    with open(WORKFLOW_PATH) as f:
        workflow = json.load(f)
    log(f"Workflow loaded from: {WORKFLOW_PATH}")

    # Check ComfyUI status
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/system_stats")
        with urllib.request.urlopen(req, timeout=5) as resp:
            stats = json.loads(resp.read())
            gpu = stats.get("devices", [{}])[0]
            log(f"GPU: {gpu.get('name', 'unknown')}")
            vram_free = gpu.get("vram_free", 0) / 1024**3
            vram_total = gpu.get("vram_total", 0) / 1024**3
            log(f"VRAM: {vram_free:.2f} GB free / {vram_total:.2f} GB total")
    except Exception as e:
        log(f"ERROR: Cannot connect to ComfyUI: {e}")
        return

    # Check queue status
    queue = get_queue()
    log(f"Queue: {len(queue.get('queue_running', []))} running, {len(queue.get('queue_pending', []))} pending")

    # Queue the prompt
    log("\nQueuing workflow...")
    try:
        result = queue_prompt(workflow)
        prompt_id = result.get("prompt_id")
        log(f"Prompt ID: {prompt_id}")
        log(f"Prompt result: {result}")
    except Exception as e:
        log(f"ERROR queuing: {e}")
        import traceback
        traceback.print_exc()
        return

    # Wait for completion
    log("\nWaiting for generation (this may take 3-10 minutes)...")
    max_wait = 600  # 10 minutes
    start = time.time()
    while time.time() - start < max_wait:
        try:
            history = get_history(prompt_id)
            if prompt_id in history:
                node_history = history[prompt_id]
                outputs = node_history.get("outputs", {})
                if outputs:
                    log(f"\nGeneration complete!")
                    log(f"Output nodes: {list(outputs.keys())}")
                    for node_id, output in outputs.items():
                        if "images" in output:
                            for img in output["images"]:
                                log(f"  Image: {img.get('filename', 'unknown')}")
                        if "meshes" in output:
                            for mesh in output["meshes"]:
                                log(f"  Mesh: {mesh.get('filename', 'unknown')}")
                    break
        except Exception as e:
            log(f"  Error checking history: {e}")
        
        # Check queue status
        queue = get_queue()
        running = len(queue.get("queue_running", []))
        pending = len(queue.get("queue_pending", []))
        
        elapsed = int(time.time() - start)
        if elapsed % 30 == 0:  # Log every 30 seconds
            log(f"  Status: {elapsed}s elapsed, {running} running, {pending} pending")
        
        time.sleep(5)
    else:
        log("TIMEOUT: Generation took too long")

    log("\nDone!")

if __name__ == "__main__":
    main()
