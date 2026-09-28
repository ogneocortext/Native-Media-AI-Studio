"""Quick benchmark: submit workflow, wait, record result."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "http://127.0.0.1:8188"
RESULTS_PATH = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\docs\knowledge-library\benchmarks\video-model-8gb-2026.json")

WORKFLOW = {
    "prompt": {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "ltxv-2b-0.9.8-distilled-fp8.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp16.safetensors", "type": "ltxv"}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "positive prompt here", "clip": ["2", 0]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "negative prompt here", "clip": ["2", 0]}},
        "5": {"class_type": "EmptyLTXVLatentVideo", "inputs": {"width": 512, "height": 512, "length": 24, "batch_size": 1}},
        "6": {"class_type": "KSampler", "inputs": {"seed": 0, "steps": 20, "cfg": 7.0, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0, "model": ["1", 0], "positive": ["3", 0], "negative": ["4", 0], "latent_image": ["5", 0]}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["8", 0]}},
        "8": {"class_type": "VAELoader", "inputs": {"vae_name": "LTX23_video_vae_bf16.safetensors"}},
        "9": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["7", 0], "frame_rate": 12, "loop_count": 0, "filename_prefix": "NativeMediaAI_LTX2B", "format": "image/gif", "pingpong": False, "save_output": True}},
    }
}

async def main():
    import aiohttp
    
    async with aiohttp.ClientSession() as session:
        # Submit
        async with session.post(f"{BASE_URL}/prompt", json=WORKFLOW, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status != 200:
                body = await resp.text()
                print(f"Rejected: {body}")
                return
            data = await resp.json()
            prompt_id = data["prompt_id"]
            print(f"Submitted: {prompt_id}")
        
        # Poll
        start = time.time()
        while True:
            async with session.get(f"{BASE_URL}/history/{prompt_id}", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                history = await resp.json()
                entry = history.get(prompt_id, {})
                status = entry.get("status", {}).get("status", "unknown")
                print(f"Status: {status}")
                if status in ("success", "error", "failed"):
                    break
            await asyncio.sleep(5)
        
        elapsed = time.time() - start
        
        # Record result
        result = {
            "model": "ltxv_2b",
            "resolution": "512x512",
            "frames": 24,
            "fps": 12,
            "precision": "fp8",
            "format": "safetensors",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "generation_time_s": round(elapsed, 2),
            "status": status,
        }
        
        if status == "success":
            outputs = entry.get("outputs", {})
            for node_id, node_out in outputs.items():
                if isinstance(node_out, dict) and "images" in node_out:
                    images = node_out["images"]
                    if images:
                        result["output_path"] = images[0].get("filename", "")
                        break
        else:
            result["error"] = str(entry.get("status", {}).get("exception", {}).get("message", ""))[:500]
        
        # Save
        results = json.loads(RESULTS_PATH.read_text()) if RESULTS_PATH.exists() else []
        results.append(result)
        RESULTS_PATH.write_text(json.dumps(results, indent=2))
        print(f"Saved result: {result}")

if __name__ == "__main__":
    asyncio.run(main())
