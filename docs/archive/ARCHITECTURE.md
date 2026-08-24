# Native Media AI Studio - Architecture

## Overview

Native Media AI Studio is a local-first AI media generation platform designed for creative professionals.

## System Architecture

### Backend Layers

`
app/
+-- main.py            # FastAPI application entry point
+-- api/              # REST API routes
¦   +-- jobs.py       # Job queue endpoints
¦   +-- health.py    # Health check endpoints
¦   +-- integrations.py  # External service integration
+-- core/            # Core utilities
¦   +-- config.py    # Configuration management
¦   +-- port_manager.py  # Dynamic port assignment
+-- models/          # Pydantic data models
+-- queue/          # Job queue system
¦   +-- manager.py  # Queue management
¦   +-- processor.py # Job execution
+-- adapters/       # External service adapters
¦   +-- base.py    # Base adapter interface
¦   +-- sd_webui.py # Stable Diffusion WebUI
¦   +-- comfyui.py # ComfyUI
¦   +-- ollama.py  # Ollama LLM
+-- diagnostics/    # Health monitoring
+-- websocket/      # Real-time updates
`

### Frontend Structure

`
frontend/src/
+-- main.tsx        # Entry point
+-- App.tsx        # Router setup
+-- components/     # Reusable components
¦   +-- common/   # StatusBadge, Card, ProgressBar
¦   +-- layout/   # Sidebar, Layout
+-- features/     # Page components
¦   +-- dashboard/
¦   +-- queue/
¦   +-- music-video/
¦   +-- image-generation/
¦   +-- visualizer/
¦   +-- settings/
¦   +-- docs/
¦   +-- health/
+-- hooks/         # Custom React hooks
+-- services/      # API client
+-- styles/       # Global CSS
`

## Job Lifecycle

`
PENDING ? QUEUED ? RUNNING ? COMPLETED
              ?        ?
            CANCELLED  FAILED (then RETRYING)
`

## Dynamic Port Management

The port manager:
1. Checks if default ports are available
2. On conflict, automatically finds an available port
3. Updates configuration
4. Cleans up orphaned processes when needed

## Communication

- REST API for commands/queries
- WebSocket for real-time job updates
- Vite proxy for development

## Hardware Optimization

- Serial job execution by default
- Max 1 queue worker
- Conservative memory usage
- No background indexing

## Extensibility

To add new integrations:
1. Create adapter in dapters/
2. Extend BaseAdapter
3. Register in AdapterRegistry
4. Add API routes if needed

To add new job types:
1. Add to JobType enum
2. Register handler in JobProcessor
3. Add UI workspace if needed

