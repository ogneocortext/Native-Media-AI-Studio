# README.md - ComfyUI Bridge Layer
#
# This directory contains custom ComfyUI nodes, workflows, and configurations
# that bridge the Native Media AI Studio app with the standalone ComfyUI core.
#
# Architecture:
#   /ComfyUI/                    - ComfyUI core (standalone, updatable via git pull)
#   config/comfyui/              - This bridge directory (custom nodes, workflows, config)
#
# On ComfyUI startup, custom nodes from config/comfyui/custom_nodes/ are
# symlinked into ComfyUI's custom_nodes/ directory. This keeps ComfyUI core
# pristine while allowing custom modifications to live in version control.
#
# Directory layout:
#   config/comfyui/
#   ├── bridge.json              - Bridge configuration (nodes, workflows, models)
#   ├── custom_nodes/            - Custom ComfyUI node Python files
#   │   ├── audio_sync_node.py
#   │   ├── stem_router_node.py
#   │   └── remix_controller_node.py
#   ├── workflows/               - Workflow JSON templates
#   │   ├── audio_reactive_visualizer.json
#   │   ├── music_video_scene.json
#   │   └── stem_mixer_preview.json
#   └── models/                  - Custom model configurations
#       └── model_configs.json
