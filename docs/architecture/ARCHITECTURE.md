# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │Dashboard │ │Music Video│ │ Media Lib│ │ Visualizer (Three)│  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────────┘  │
│         │              │           │               │            │
│         └──────────────┴───────────┴───────────────┘            │
│                              │                                   │
│                    Zustand Stores + API Client                   │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │ HTTP + WebSocket
                               │
┌──────────────────────────────┼───────────────────────────────────┐
│                    Backend (FastAPI)                              │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                      API Routers                            │  │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ /api/jobs│ │/api/audio│ │/api/outputs│ │/api/health │  │  │
│  │  └─────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                    Job Queue Manager                        │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Job Processor (Serial)                   │  │  │
│  │  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ │  │  │
│  │  │  │AudioAnalysis│ │ MusicVideo   │ │ ImageGen     │ │  │  │
│  │  │  │  Handler    │ │  Handler     │ │  Handler     │ │  │  │
│  │  │  └─────────────┘ └──────────────┘ └──────────────┘ │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                    Data Layer                               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐  │  │
│  │  │ SQLite   │ │  Output  │ │  Config (ports.json)     │  │  │
│  │  │ Database │ │  Files   │ │                          │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │               External Adapters                            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                  │  │
│  │  │ ComfyUI  │ │ Ollama   │ │ SD WebUI │                  │  │
│  │  └──────────┘ └──────────┘ └──────────┘                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Music Video Pipeline

```
Audio Upload          Analysis           Job Queue          Rendering
─────────────        ─────────          ──────────          ──────────
                       
User selects    →    File saved     →   Job created    →   Audio analysis
audio file           to output/audio    with params          (librosa)
                       
Upload via      →    Librosa         →   Job queued     →   FFmpeg renders
multipart form       extracts beats      in SQLite           frames with
                     tempo, onset                          visualization
                                                           filters
                                                        →
                                                   Frames + audio
                                                   composited into
                                                   final MP4
```

## Job Lifecycle

```
CREATED → QUEUED → RUNNING → COMPLETED
                         ↘
                          FAILED → RETRYING → QUEUED
                                   ↘
                                    CANCELLED
```

## Data Flow

1. **Frontend** uploads audio via `POST /api/audio/upload`
2. **Backend** stores file, returns `stored_path`
3. **Frontend** creates job via `POST /api/jobs` with `stored_path` in params
4. **Queue Manager** enqueues job, broadcasts `job.queued` via WebSocket
5. **Job Processor** picks up job, calls appropriate handler
6. **Handler** processes job, updates progress via WebSocket
7. **On completion**, output file is saved to `output/video/` or `output/previews/`
8. **Frontend** receives `job.completed` with output path

## Key Components

### Frontend Stores (Zustand)
- `jobStore` — Job queue state, WebSocket connection
- `healthStore` — System health, adapter status
- `outputStore` — Generated media files, filters

### Backend Services
- `AudioAnalyzer` — Librosa-based feature extraction
- `MusicVideoHandler` — FFmpeg video rendering with visualization filters
- `ImageGenerationHandler` — ComfyUI/SD WebUI integration
- `ComfyUIWorkflowHandler` — Custom workflow execution

### Database Schema (SQLite)
- `jobs` — Job records with status, progress, params, results
- `job_events` — Event log for auditing
