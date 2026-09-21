import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface VideoGenerationResponse {
  success: boolean;
  output_path?: string;
  seed?: number;
  prompt_id?: string;
  message?: string;
}

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
  const res = await fetchWithTimeout(
    `${base}/api/integrations/${options.backend || "comfyui"}/generate-video`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: options.negativePrompt || "",
        steps: options.steps || 15,
        cfg_scale: options.cfgScale || 7.0,
        width: options.width || 512,
        height: options.height || 512,
        seed: options.seed || -1,
        sampler: options.sampler || "Euler a",
        num_frames: options.numFrames || 16,
        fps: options.fps || 8,
        motion_module: options.motionModule || "",
        motion_lora: options.motionLora || "",
        motion_lora_strength: options.motionLoraStrength ?? 0.8,
        model_variant: options.modelVariant || "standard",
        ckpt_name: options.ckptName || "",
      }),
      timeout: 600000,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to generate video" }));
    throw new Error(err.detail || "Failed to generate video");
  }
  return res.json();
}

export interface GenerationResultResponse {
  status: string;
  success?: boolean;
  output_path?: string;
  prompt_id: string;
  error?: string;
  kind?: string;
}

export async function getGenerationResult(
  serviceName: string,
  promptId: string,
): Promise<GenerationResultResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(
    `${base}/api/integrations/${serviceName}/result/${encodeURIComponent(promptId)}`,
    { timeout: 30000 },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to get generation result" }));
    throw new Error(err.detail || "Failed to get generation result");
  }
  return res.json();
}

export interface GenerationProgressResponse {
  status: string;
  prompt_id: string;
  step?: number;
  total_steps?: number;
  queue_position?: number;
  error?: string;
}

export async function getGenerationProgress(
  promptId: string,
): Promise<GenerationProgressResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(
    `${base}/api/integrations/comfyui/progress/${encodeURIComponent(promptId)}`,
    { timeout: 30000 },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to get generation progress" }));
    throw new Error(err.detail || "Failed to get generation progress");
  }
  return res.json();
}

export interface GenerationPreviewResponse {
  filename?: string;
  subfolder?: string;
  node_id?: string;
  error?: string;
}

export async function getGenerationPreview(
  promptId: string,
): Promise<GenerationPreviewResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(
    `${base}/api/integrations/comfyui/preview/${encodeURIComponent(promptId)}`,
    { timeout: 30000 },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to get generation preview" }));
    throw new Error(err.detail || "Failed to get generation preview");
  }
  return res.json();
}

// Image generation
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
  const res = await fetchWithTimeout(
    `${base}/api/integrations/${options.backend || "comfyui"}/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: options.negativePrompt || "",
        steps: options.steps || 20,
        cfg_scale: options.cfgScale || 7.0,
        width: options.width || 512,
        height: options.height || 512,
        seed: options.seed || -1,
        sampler: options.sampler || "Euler a",
        ckpt_name: options.model || undefined,
      }),
      timeout: 30000,
    },
  );
  if (!res.ok) throw new Error("Failed to generate image");
  return res.json();
}

export async function queueImageJob(
  prompt: string,
  options: Record<string, unknown> = {},
): Promise<{ job_id: string; status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(
    `${base}/api/integrations/${options.backend || "comfyui"}/job`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ...options,
      }),
      timeout: 30000,
    },
  );
  if (!res.ok) throw new Error("Failed to queue image job");
  return res.json();
}
