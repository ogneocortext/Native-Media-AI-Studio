import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface ComfyUIStatus {
  installed: boolean;
  running: boolean;
  port: number;
  url: string;
  pid?: number;
  uptime_seconds?: number;
  version: {
    installed: boolean;
    path?: string;
    version?: string;
    commit?: string;
    branch?: string;
    behind_remote?: number;
    up_to_date?: boolean;
    error?: string;
  };
}

export async function getComfyUIStatus(): Promise<ComfyUIStatus> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/status`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get ComfyUI status");
  return res.json();
}

export interface ComfyUIStartResponse {
  success: boolean;
  message: string;
  suggestion?: string;
}

export interface ComfyUIStopResponse {
  success: boolean;
  message: string;
  suggestion?: string;
}

export async function startComfyUI(port: number = 8188): Promise<ComfyUIStartResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/start?port=${port}`, {
    method: "POST",
    timeout: 120_000,
  });
  if (!res.ok) throw new Error("Failed to start ComfyUI");
  return res.json() as Promise<ComfyUIStartResponse>;
}

export async function stopComfyUI(): Promise<ComfyUIStopResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/stop`, {
    method: "POST",
    timeout: 30_000,
  });
  if (!res.ok) throw new Error("Failed to stop ComfyUI");
  return res.json() as Promise<ComfyUIStopResponse>;
}

export async function restartComfyUI(port: number = 8188): Promise<unknown> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/restart?port=${port}`, {
    method: "POST",
    timeout: 120_000,
  });
  if (!res.ok) throw new Error("Failed to restart ComfyUI");
  return res.json();
}

export interface ComfyUIUpdateResponse {
  success: boolean;
  message: string;
  output?: string;
  was_running?: boolean;
  restarted?: { success: boolean; message?: string };
  errors?: string[];
  hint?: string;
}

export async function updateComfyUI(): Promise<ComfyUIUpdateResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/services/comfyui/update`, {
    method: "POST",
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to update ComfyUI");
  return res.json();
}

export interface IntegrationStatus {
  name: string;
  status: string;
  url: string;
  mock_mode: boolean;
}

export async function getIntegrationStatus(serviceName: string): Promise<IntegrationStatus> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/${serviceName}`, { timeout: 30000 });
  if (!res.ok) throw new Error(`Failed to get integration status: ${serviceName}`);
  return res.json();
}

export interface VRAMStatus {
  vram?: {
    available: boolean;
    total_mb: number;
    used_mb: number;
    free_mb: number;
    percent: number;
    gpu_utilization: number;
    temperature: number;
    state: string;
    fallback: string;
    name: string;
  };
  manager: Record<string, unknown>;
}

export async function getVRAMStatus(): Promise<VRAMStatus> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/vram/status`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get VRAM status");
  return res.json();
}

export async function getModelsStatus(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/models/status`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get models status");
  return res.json();
}

export async function getMusicVideoStyles(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/music-video/styles`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get music video styles");
  return res.json();
}

export async function getWorkflowTemplates(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/music-video/templates`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get workflow templates");
  return res.json();
}

export interface UpscaleResponse {
  success: boolean;
  engine: "comfyui" | "ffmpeg";
  model: string;
  scale: number;
  source: string;
  output_path: string;
  relative_path: string | null;
  elapsed_s: number;
  warnings: string[];
  error: string | null;
}

export async function upscaleImage(params: {
  image: string;
  model?: string;
  scale?: 2 | 4;
  prefer_comfyui?: boolean;
}): Promise<UpscaleResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/upscale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Upscale failed");
  }
  return res.json();
}
