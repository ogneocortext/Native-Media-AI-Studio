# Python Environment Setup

This project uses Python 3.11 for the backend and AI/ML services. Multiple virtual environments exist for different subsystems.

## Python Version

- **Required:** Python 3.11.x
- **Location:** `%LOCALAPPDATA%\Programs\Python\Python311\python.exe`

## Virtual Environments

The project maintains separate venvs under `runtime/venvs/.venvs/` for isolation:

| Venv | Purpose | Key Packages |
|------|---------|--------------|
| `venv_backend` | FastAPI backend, job queue | fastapi, uvicorn, aiohttp, sqlalchemy |
| `venv_comfyui` | ComfyUI workflow execution | comfyui-client, torch, torchvision |
| `venv_llm` | Local LLM inference | transformers, torch, accelerate |
| `venv_ollama` | Ollama API client | httpx, aiohttp |
| `venv_audio` | Audio analysis & beat detection | librosa, numpy, scipy |
| `venv_vision` | Vision models & image processing | torch, transformers, PIL |
| `venv_triposr` | 3D model generation | torch, trimesh |
| `venv_openclaw` | OpenClaw MCP integration | mcp, httpx |

## Setup (Single Env for Backend)

For most development, only `venv_backend` is needed:

```powershell
# Create
python -m venv runtime/venvs/.venvs/venv_backend

# Activate
./runtime/venvs/.venvs/venv_backend/Scripts/Activate.ps1

# Install backend deps
pip install -r packages/backend/requirements.txt
```

## Full Setup (All Subsystems)

```powershell
$venvs = @("venv_backend", "venv_comfyui", "venv_llm", "venv_ollama",
           "venv_audio", "venv_vision", "venv_triposr", "venv_openclaw")

foreach ($v in $venvs) {
    $path = "runtime/venvs/.venvs/$v"
    if (-not (Test-Path $path)) {
        python -m venv $path
    }
}
```

## Running the Backend

```powershell
# Activate backend venv
./runtime/venvs/.venvs/venv_backend/Scripts/Activate.ps1

# Start server
cd packages/backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
