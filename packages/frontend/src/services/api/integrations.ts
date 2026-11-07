/**
 * Frontend client for /api/integrations — ComfyUI, Atomic Chat, VRAM, models, upscale.
 */

import { getJson, postJson } from "./typed-fetch";
import type {
  ComfyUIStatus,
  ComfyUIStartResponse,
  ComfyUIStopResponse,
  ComfyUIUpdateResponse,
  IntegrationStatus,
  AtomicChatStatus,
  VRAMStatus,
  UpscaleResponse,
} from "./types";

const BASE = "/api/integrations";
const SERVICES_BASE = "/api/services";

/**
 * Get ComfyUI status.
 */
export async function getComfyUIStatus(): Promise<ComfyUIStatus> {
  return getJson<ComfyUIStatus>(`${SERVICES_BASE}/comfyui/status`, { timeout: 30000 });
}

/**
 * Start ComfyUI server.
 * Long-running (up to 2 minutes).
 */
export async function startComfyUI(port = 8188): Promise<ComfyUIStartResponse> {
  return postJson<ComfyUIStartResponse>(`${SERVICES_BASE}/comfyui/start?port=${port}`, {}, { timeout: 120000 });
}

/**
 * Stop ComfyUI server.
 */
export async function stopComfyUI(): Promise<ComfyUIStopResponse> {
  return postJson<ComfyUIStopResponse>(`${SERVICES_BASE}/comfyui/stop`, {}, { timeout: 30000 });
}

/**
 * Restart ComfyUI server.
 * Long-running (up to 2 minutes).
 */
export async function restartComfyUI(port = 8188): Promise<unknown> {
  return postJson<unknown>(`${SERVICES_BASE}/comfyui/restart?port=${port}`, {}, { timeout: 120000 });
}

/**
 * Update ComfyUI (git pull + dependencies).
 * Long-running.
 */
export async function updateComfyUI(): Promise<ComfyUIUpdateResponse> {
  return postJson<ComfyUIUpdateResponse>(`${SERVICES_BASE}/comfyui/update`, {}, { timeout: 30000 });
}

/**
 * Get integration status by service name.
 */
export async function getIntegrationStatus(serviceName: string): Promise<IntegrationStatus> {
  return getJson<IntegrationStatus>(`${BASE}/${serviceName}`, { timeout: 30000 });
}

/**
 * Get Atomic Chat status.
 */
export async function getAtomicChatStatus(): Promise<AtomicChatStatus> {
  return getJson<AtomicChatStatus>(`${BASE}/atomic-chat/status`, { timeout: 30000 });
}

/**
 * Get VRAM status.
 */
export async function getVRAMStatus(): Promise<VRAMStatus> {
  return getJson<VRAMStatus>(`${BASE}/vram/status`, { timeout: 30000 });
}

/**
 * Get models status.
 */
export async function getModelsStatus(): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(`${BASE}/models/status`, { timeout: 30000 });
}

/**
 * Get music video styles.
 */
export async function getMusicVideoStyles(): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(`${BASE}/music-video/styles`, { timeout: 30000 });
}

/**
 * Get workflow templates.
 */
export async function getWorkflowTemplates(): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(`${BASE}/music-video/templates`, { timeout: 30000 });
}

/**
 * Upscale an image.
 * Long-running (up to 10 minutes).
 */
export async function upscaleImage(params: {
  image: string;
  model?: string;
  scale?: 2 | 4;
  prefer_comfyui?: boolean;
}): Promise<UpscaleResponse> {
  return postJson<UpscaleResponse>(`${BASE}/upscale`, params, { timeout: 600000 });
}