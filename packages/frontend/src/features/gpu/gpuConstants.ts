// ---------------------------------------------------------------------------
// gpuConstants.ts — shared constants + types for the GPU Monitor page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Process → app-function mapping (best-effort, user-facing labels)
// ---------------------------------------------------------------------------
export const PROCESS_LABELS: Record<string, string> = {
  "Unity.exe": "Unity Editor — 3D scene / animation",
  "Unity Hub.exe": "Unity Hub — project manager",
  "Blender.exe": "Blender — 3D rendering / scene build",
  "ollama.exe": "Ollama — model server",
  "llama-server.exe": "Ollama — active model inference",
  "python.exe": "Python — backend / audio analysis",
  "node.exe": "Node.js — MCP servers / frontend",
  "chrome.exe": "Chrome — UI / BrowserOS",
  "msedge.exe": "Edge — UI / BrowserOS",
  "ComfyUI.exe": "ComfyUI — image / video generation",
  "main.py": "ComfyUI — diffusion worker",
  "uvicorn.exe": "FastAPI — backend server",
  "Remotion.exe": "Remotion — video render",
  "DaVinci Resolve.exe": "DaVinci Resolve — video editing",
} as const;

export const THROTTLE_TEMP = 83;

export const MAX_HISTORY = 17280; // 24h at 5s poll (~500KB JSON)
export const HISTORY_KEY = "gpu:history:v2";
export const POLL_OPTIONS = [5, 10, 30] as const;

export const RANGE_OPTIONS = [
  { id: "5m", label: "5m", ms: 5 * 60 * 1000 },
  { id: "15m", label: "15m", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1h", ms: 60 * 60 * 1000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60 * 1000 },
  { id: "12h", label: "12h", ms: 12 * 60 * 60 * 1000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
] as const;
export type RangeId = (typeof RANGE_OPTIONS)[number]["id"];

export interface DataPoint {
  time: number;
  label: string;
  temp?: number;
  vram?: number;
  util?: number;
}

// ---------------------------------------------------------------------------
// Chart readability helpers (constants only)
// ---------------------------------------------------------------------------
export const AXIS_TICK = { fontSize: 11, fill: "#a8b0bd" } as const;
export const TOOLTIP_STYLE = {
  background: "rgba(13,14,19,0.97)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  fontSize: 12,
  padding: "8px 10px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
} as const;
