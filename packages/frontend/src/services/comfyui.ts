/**
 * ComfyUI service for AI image/video generation.
 * Connects to the local ComfyUI instance at http://localhost:8188.
 */

import { getBackendUrl } from "./portConfig";

const COMFYUI_URL = "http://127.0.0.1:8188";

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

/**
 * Queue a prompt for execution on ComfyUI.
 */
export async function queuePrompt(workflow: Record<string, unknown>): Promise<{ prompt_id: string }> {
  const response = await fetch(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!response.ok) {
    throw new Error(`ComfyUI queue failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get the current queue status.
 */
export async function getQueueStatus(): Promise<{
  queue_running: unknown[];
  queue_pending: unknown[];
}> {
  const response = await fetch(`${COMFYUI_URL}/queue`);
  if (!response.ok) {
    throw new Error(`ComfyUI queue status failed: ${response.statusText}`);
  }
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
  const response = await fetch(`${COMFYUI_URL}/system_stats`);
  if (!response.ok) {
    throw new Error(`ComfyUI system stats failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Check if ComfyUI is reachable.
 */
export async function isComfyUIAlive(): Promise<boolean> {
  try {
    const response = await fetch(`${COMFYUI_URL}/system_stats`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get list of available checkpoints/models.
 */
export async function getAvailableModels(): Promise<{
  checkpoints: string[];
  vae: string[];
  loras: string[];
  diffusion_models: string[];
  text_encoders: string[];
}> {
  const response = await fetch(`${COMFYUI_URL}/object_info/CheckpointLoaderSimple`);
  const data = await response.json();

  const models: {
    checkpoints: string[];
    vae: string[];
    loras: string[];
    diffusion_models: string[];
    text_encoders: string[];
  } = {
    checkpoints: [],
    vae: [],
    loras: [],
    diffusion_models: [],
    text_encoders: [],
  };

  if (data?.CheckpointLoaderSimple?.inputs?.checkpoint_name?.[0]) {
    models.checkpoints = data.CheckpointLoaderSimple.inputs.checkpoint_name[0];
  }

  // Fetch additional model types
  const modelTypes = [
    { type: "VAELoader", key: "vae" as const },
    { type: "LoraLoader", key: "loras" as const },
    { type: "UNETLoader", key: "diffusion_models" as const },
    { type: "CLIPLoader", key: "text_encoders" as const },
  ];

  for (const { type, key } of modelTypes) {
    try {
      const res = await fetch(`${COMFYUI_URL}/object_info/${type}`);
      const info = await res.json();
      if (info?.[type]?.inputs) {
        const inputKeys = Object.keys(info[type].inputs);
        for (const inputKey of inputKeys) {
          const values = info[type].inputs[inputKey];
          if (Array.isArray(values) && values.length > 0 && Array.isArray(values[0])) {
            models[key] = values[0] as string[];
            break;
          }
        }
      }
    } catch {
      // Ignore errors for unavailable model types
    }
  }

  return models;
}

/**
 * Generate a simple text-to-image using ComfyUI's default workflow.
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
    checkpoint = "v1-5-pruned-emaonly.safetensors",
  } = options;

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
      inputs: { ckpt_name: checkpoint },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
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
  const params = new URLSearchParams({ filename, subfolder, type });
  const response = await fetch(`${COMFYUI_URL}/view?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Get WebSocket URL for real-time progress updates.
 */
export function getWebSocketUrl(): string {
  return `ws://127.0.0.1:8188/ws`;
}

export default {
  queuePrompt,
  getQueueStatus,
  getSystemStats,
  isComfyUIAlive,
  getAvailableModels,
  generateText2Image,
  getImage,
  getWebSocketUrl,
};
