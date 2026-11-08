/**
 * Frontend client for video/image generation via ComfyUI and other backends.
 */

import { getApiBase } from "./core";
import { postJson, getJson } from "./typed-fetch";
import type {
  VideoGenerationResponse,
  GenerationResultResponse,
  GenerationProgressResponse,
  GenerationPreviewResponse,
} from "./types";

/**
 * Generate a video using ComfyUI or other backend.
 * Long-running (up to 10 minutes).
 */
export async function generateVideo(
  prompt: string,
  options: {
    negativePrompt?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    seed?: number;
    sampler?: string;
    backend?: string;
    numFrames?: number;
    fps?: number;
    motionModule?: string;
    motionLora?: string;
    motionLoraStrength?: number;
    modelVariant?: "fp16" | "gguf_q4" | "gguf_q5" | "standard";
    ckptName?: string;
  } = {},
): Promise<VideoGenerationResponse> {
  const base = getApiBase();
  const backend = options.backend ?? "comfyui";

  return postJson<VideoGenerationResponse>(
    `${base}/api/integrations/${backend}/generate-video`,
    {
      prompt,
      negative_prompt: options.negativePrompt ?? "",
      steps: options.steps ?? 15,
      cfg_scale: options.cfgScale ?? 7.0,
      width: options.width ?? 512,
      height: options.height ?? 512,
      seed: options.seed ?? -1,
      sampler: options.sampler ?? "Euler a",
      num_frames: options.numFrames ?? 16,
      fps: options.fps ?? 8,
      motion_module: options.motionModule ?? "",
      motion_lora: options.motionLora ?? "",
      motion_lora_strength: options.motionLoraStrength ?? 0.8,
      model_variant: options.modelVariant ?? "standard",
      ckpt_name: options.ckptName ?? "",
    },
    { timeout: 600000 },
  );
}

/**
 * Get generation result by service name and prompt ID.
 */
export async function getGenerationResult(
  serviceName: string,
  promptId: string,
): Promise<GenerationResultResponse> {
  const base = getApiBase();
  const encoded = encodeURIComponent(promptId);
  return getJson<GenerationResultResponse>(
    `${base}/api/integrations/${serviceName}/result/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Get generation progress for a ComfyUI prompt.
 */
export async function getGenerationProgress(promptId: string): Promise<GenerationProgressResponse> {
  const base = getApiBase();
  const encoded = encodeURIComponent(promptId);
  return getJson<GenerationProgressResponse>(
    `${base}/api/integrations/comfyui/progress/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Get generation preview for a ComfyUI prompt.
 */
export async function getGenerationPreview(promptId: string): Promise<GenerationPreviewResponse> {
  const base = getApiBase();
  const encoded = encodeURIComponent(promptId);
  return getJson<GenerationPreviewResponse>(
    `${base}/api/integrations/comfyui/preview/${encoded}`,
    { timeout: 30000 },
  );
}

/**
 * Generate an image using ComfyUI or other backend.
 */
export async function generateImage(
  prompt: string,
  options: {
    negativePrompt?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    seed?: number;
    sampler?: string;
    backend?: string;
    model?: string;
  } = {},
): Promise<{ success: boolean; output_path: string; seed: number }> {
  const base = getApiBase();
  const backend = options.backend ?? "comfyui";

  return postJson<{ success: boolean; output_path: string; seed: number }>(
    `${base}/api/integrations/${backend}/generate`,
    {
      prompt,
      negative_prompt: options.negativePrompt ?? "",
      steps: options.steps ?? 20,
      cfg_scale: options.cfgScale ?? 7.0,
      width: options.width ?? 512,
      height: options.height ?? 512,
      seed: options.seed ?? -1,
      sampler: options.sampler ?? "Euler a",
      ckpt_name: options.model ?? undefined,
    },
    { timeout: 30000 },
  );
}

/**
 * Queue an image generation job.
 */
export async function queueImageJob(
  prompt: string,
  options: Record<string, unknown> = {},
): Promise<{ job_id: string; status: string }> {
  const base = getApiBase();
  const backend = (options.backend as string | undefined) ?? "comfyui";

  return postJson<{ job_id: string; status: string }>(
    `${base}/api/integrations/${backend}/job`,
    { prompt, ...options },
    { timeout: 30000 },
  );
}

export type * from "./types";
