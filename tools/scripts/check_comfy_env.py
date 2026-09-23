"""Diagnose comfy_aimdo install state in whichever env runs this."""
import importlib.metadata as md
import os
import sys

print("python:", sys.executable)
try:
    import comfy_aimdo
    print("comfy_aimdo file:", comfy_aimdo.__file__)
    d = os.path.dirname(comfy_aimdo.__file__)
    print("dir contents:", sorted(os.listdir(d)))
except Exception as e:
    print("comfy_aimdo import FAILED:", e)
    sys.exit(1)

try:
    import comfy_aimdo.storage  # noqa: F401
    print("comfy_aimdo.storage OK")
except Exception as e:
    print("comfy_aimdo.storage FAILED:", e)

for pkg in ("comfy-aimdo", "comfy-kitchen"):
    try:
        print(pkg, "metadata version:", md.version(pkg))
    except Exception as e:
        print(pkg, "metadata MISSING:", e)
