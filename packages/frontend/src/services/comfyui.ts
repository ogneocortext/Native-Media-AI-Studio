/**
 * ComfyUI service for AI image/video generation.
 * Connects to the local ComfyUI instance via dynamic URL from ports.json/env.
 */

import { getComfyuiUrl, getComfyuiWsUrl } from "./portConfig";
import { fetchWithTimeout } from "./fetchWithTimeout";

export class ComfyUIError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "ComfyUIError";
  }
}

/**
 * Shared ok-check: every ComfyUI GET in this module previously repeated
 * the same `if (!response.ok) throw ...statusText` block. Centralized here
 * so error shape can't drift between endpoints.
 */
async function checkResponse(response: Response, action: string): Promise<Response> {
  if (!response.ok) {
    throw new ComfyUIError(`ComfyUI ${action} failed: ${response.statusText}`, response.status);
  }
  return response;
}

export interface ComfyUIProgress {
  value: number;
  max: number;
}

export interface ComfyUIImage {
  filename: string;
  subfolder: string;
  type: "output" | "temp" | "input";
}

export interface ComfyUIResult {
  images: ComfyUIImage[];
  prompt_id: string;
}

export interface ComfyUITaskStatus {
  status: "queued" | "running" | "completed" | "failed";
  progress?: ComfyUIProgress;
  images?: ComfyUIImage[];
  error?: string;
}

export interface AvailableModels {
  checkpoints: string[];
  vae: string[];
  loras: string[];
  diffusion_models: string[];
  text_encoders: string[];
}

/**
 * Queue a prompt for execution on ComfyUI.
 */
export async function queuePrompt(workflow: Record<string, unknown>): Promise<{ prompt_id: string }> {
  const COMFYUI_URL = getComfyuiUrl();
  const response = await fetchWithTimeout(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
    timeout: 15000,
  });

  if (!response.ok) {
    // ComfyUI returns actionable error details (node validation errors, etc.)
    // in the response body — surface them instead of the generic statusText.
    let detail = response.statusText;
    try {
      const errBody = await response.json();
      if (errBody?.error) detail = String(errBody.error);
      const nodeErrors = errBody?.node_errors as Record<string, unknown> | undefined;
      if (nodeErrors && Object.keys(nodeErrors).length > 0) {
        const nodeSummary = Object.entries(nodeErrors)
          .map(([nodeId, nodeErr]) => {
            const errors = (nodeErr as { errors?: unknown[] })?.errors;
            return `node ${nodeId}: ${Array.isArray(errors) ? errors.length : "?"} error(s)`;
          })
          .join("; ");
        detail = `${detail} (${nodeSummary})`;
      }
    } catch {
      // Body was not JSON — keep the statusText fallback
    }
    throw new ComfyUIError(`ComfyUI queue failed: ${detail}`, response.status);
  }

  const data = await response.json();
  if (!data.prompt_id) {
    throw new ComfyUIError("ComfyUI returned no prompt_id");
  }
  return data;
}

/**
 * Get the current queue status.
 */
export async function getQueueStatus(): Promise<{
  queue_running: unknown[];
  queue_pending: unknown[];
}> {
  const COMFYUI_URL = getComfyuiUrl();
  const response = await checkResponse(
    await fetchWithTimeout(`${COMFYUI_URL}/queue`, { timeout: 8000 }),
    "queue status"
  );
  return response.json();
}

/**
 * Get system stats from ComfyUI.
 */
export async function getSystemStats(): Promise<{
  system: { os: string; ram_total: number; ram_free: number };
  devices: Array<{
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
    torch_vram_total: number;
    torch_vram_free: number;
  }>;
}> {
  const COMFYUI_URL = getComfyuiUrl();
  const response = await checkResponse(
    await fetchWithTimeout(`${COMFYUI_URL}/system_stats`, { timeout: 8000 }),
    "system stats"
  );
  return response.json();
}

/**
 * Check if ComfyUI is reachable.
 */
export async function isComfyUIAlive(): Promise<boolean> {
  try {
    const COMFYUI_URL = getComfyuiUrl();
    const response = await fetchWithTimeout(`${COMFYUI_URL}/system_stats`, {
      timeout: 3000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get list of available checkpoints/models.
 *
 * Consolidated: one `GET /object_info` round-trip instead of five
 * sequential per-node fetches. Each loader's file list is extracted
 * with the same helper, so `ckpt_name` vs `model_name` drift can't
 * recur (CheckpointLoaderSimple uses `ckpt_name`).
 */
export async function getAvailableModels(): Promise<AvailableModels> {
  const COMFYUI_URL = getComfyuiUrl();

  const models: AvailableModels = {
    checkpoints: [],
    vae: [],
    loras: [],
    diffusion_models: [],
    text_encoders: [],
  };

  function extractFileList(nodeInfo: unknown): string[] {
    if (!nodeInfo || typeof nodeInfo !== "object") return [];
    // object_info nests inputs under input.required / input.optional (new)
    // or inputs (legacy) — scan every section for the first string array.
    // Two widget shapes exist: [[opt, ...], {...}] and
    // ["COMBO", { options: [opt, ...] }] (AnimateDiff-style loaders).
    const sections: unknown[] = [];
    const asRecord = nodeInfo as Record<string, unknown>;
    const input = asRecord.input as Record<string, unknown> | undefined;
    if (input) {
      if (input.required) sections.push(input.required);
      if (input.optional) sections.push(input.optional);
    }
    if (asRecord.inputs) sections.push(asRecord.inputs);
    for (const section of sections) {
      if (!section || typeof section !== "object") continue;
      for (const value of Object.values(section as Record<string, unknown>)) {
        if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) {
          const list = value[0] as unknown[];
          if (list.every((v) => typeof v === "string")) return list as string[];
        }
        if (
          Array.isArray(value) &&
          value.length > 1 &&
          typeof value[0] === "string" &&
          value[1] !== null &&
          typeof value[1] === "object"
        ) {
          const opts = (value[1] as Record<string, unknown>).options;
          if (Array.isArray(opts) && opts.every((v) => typeof v === "string")) {
            return opts as string[];
          }
        }
      }
    }
    return [];
  }

  try {
    const response = await checkResponse(
      await fetchWithTimeout(`${COMFYUI_URL}/object_info`, { timeout: 15000 }),
      "object_info"
    );
    const data = (await response.json()) as Record<string, unknown>;

    models.checkpoints = extractFileList(data.CheckpointLoaderSimple);
    models.vae = extractFileList(data.VAELoader);
    models.loras = extractFileList(data.LoraLoader);
    models.diffusion_models = extractFileList(
      data.UNETLoader ?? data.DiffusionModelLoader ?? data.UnetLoaderGGUF
    );
    models.text_encoders = extractFileList(data.CLIPLoader);
  } catch (e) {
    console.warn("Failed to fetch ComfyUI models:", e);
  }

  return models;
}

/**
 * Generate a simple text-to-image using ComfyUI's default workflow.
 *
 * 8GB note (GTX 1070 Ti, see docs/knowledge-library/comfyui-workflows.md):
 * 512x512 is always safe (~4GB); 768x768 needs optimization; 1024x1024
 * risks OOM when anything else holds VRAM. Warn above 768px so callers
 * can clamp before queueing.
 */
export async function generateText2Image(options: {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  checkpoint?: string;
}): Promise<{ prompt_id: string }> {
  const {
    prompt,
    negativePrompt = "",
    width = 512,
    height = 512,
    steps = 20,
    cfg = 7,
    sampler = "euler",
    scheduler = "normal",
    seed = Math.floor(Math.random() * 2 ** 32),
    checkpoint,
  } = options;

  // Validate dimensions are divisible by 8 (ComfyUI requirement)
  const validWidth = Math.floor(width / 8) * 8;
  const validHeight = Math.floor(height / 8) * 8;

  if (validWidth > 768 || validHeight > 768) {
    console.warn(
      `[ComfyUI] ${validWidth}x${validHeight} exceeds the 8GB-safe 768px ceiling ` +
        `(GTX 1070 Ti). Expect ~6-8GB+ VRAM; close other GPU apps or reduce to 512px.`
    );
  }

  // Build a simple text-to-image workflow
  const workflow: Record<string, unknown> = {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpoint || "v1-5-pruned-emaonly.safetensors" },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: validWidth, height: validHeight, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: "ai_visual" },
    },
  };

  return queuePrompt(workflow);
}

/**
 * Fetch a generated image from ComfyUI.
 */
export async function getImage(
  filename: string,
  subfolder = "",
  type = "output"
): Promise<string> {
  const COMFYUI_URL = getComfyuiUrl();
  const params = new URLSearchParams({ filename, subfolder, type });
  const response = await checkResponse(
    await fetchWithTimeout(`${COMFYUI_URL}/view?${params}`, { timeout: 30000 }),
    "fetch image"
  );
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Release an object URL created by getImage(). Call this when the image
 * is no longer displayed to avoid leaking memory (e.g. in useEffect cleanup).
 */
export function revokeImage(objectUrl: string): void {
  URL.revokeObjectURL(objectUrl);
}

/**
 * Get ComfyUI's native WebSocket URL (for ComfyUI's own /ws progress).
 * Note: Backend realtime is SSE at GET /api/events (getEventsUrl) — this is only for direct ComfyUI WS.
 */
export function getWebSocketUrl(): string {
  return getComfyuiWsUrl();
}

export default {
  queuePrompt,
  getQueueStatus,
  getSystemStats,
  isComfyUIAlive,
  getAvailableModels,
  generateText2Image,
  getImage,
  revokeImage,
  getWebSocketUrl,
  ComfyUIError,
};
