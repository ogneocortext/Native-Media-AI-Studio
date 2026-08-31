"""
Test Hunyuan3D-2mini generation directly using hy3dgen library.
This script runs in the comfyui-cuda conda environment.
"""
import os
import sys
import torch

# Low VRAM settings
os.environ["CUDA_VISIBLE_DEVICES"] = "0"

model_path = r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI\models\diffusion_models\hunyuan3d-2mini"
output_path = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\generated_3d\test_shrimp.glb"

print(f"Model path: {model_path}")
print(f"Output path: {output_path}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    free = torch.cuda.mem_get_info()[0] / (1024**3)
    total = torch.cuda.mem_get_info()[1] / (1024**3)
    print(f"VRAM: {free:.2f} GB free / {total:.2f} GB total")

try:
    print("\nImporting hy3dgen...")
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    
    print("Loading pipeline...")
    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        model_path,
        torch_dtype=torch.float16,
    )
    print("Pipeline loaded successfully!")
    
    print("\nGenerating 3D model...")
    result = pipeline(
        prompt="a happy shrimp character, cute, cartoon style",
        num_inference_steps=15,
        guidance_scale=5.0,
        generator=torch.manual_seed(42),
    )
    
    print(f"Result type: {type(result)}")
    print(f"Result attributes: {dir(result)}")
    
    if hasattr(result, 'meshes'):
            mesh = result.meshes[0]
            mesh.export(output_path)
            print(f"\n3D model saved to: {output_path}")
            print("SUCCESS!")
    elif hasattr(result, 'images'):
            # It's an image result, save it
            img = result.images[0]
            img_path = output_path.replace('.glb', '.png')
            img.save(img_path)
            print(f"\nImage saved to: {img_path}")
            print("Note: Got image output instead of 3D mesh")
    else:
            print(f"Unexpected result: {result}")
            
except Exception as e:
    print(f"\nERROR: {e}")
    import traceback
    traceback.print_exc()
