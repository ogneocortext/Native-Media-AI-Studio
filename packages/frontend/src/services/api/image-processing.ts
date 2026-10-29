/**
 * ACE-Step bridge client for audio remix features.
 *
 * Isolates the app from ACE-Step provider API changes. Parameter/response
 * shapes are mapped through the bridge compatibility map so provider updates
 * only require config changes, not code changes.
 *
 * Bridge config (config/ace-step/bridge.json) drives the parameter map, so a
 * provider update that renames ``cfg_scale`` to ``guidance`` only requires a
 * config entry here — no code change.
 *
 * App code uses canonical names (``cfg_scale``). If a provider update renames
 * the wire parameter, add an entry to the map and the client translates
 * automatically.
 */

import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

// ============================================================================
// Image processing types
// ============================================================================

export interface ImageProcessRequest {
  style: string;
  style_image?: string;
  output_name?: string;
}

export interface ImageProcessResponse {
  output_path: string;
  relative_path: string;
  size: [number, number];
  mode: string;
  format: string;
  applied_effects: string[];
}

export interface ImageRemixRequest {
  images: string[];
  preset?: "drums_a_vocals_b" | "blend" | "intro_swap";
  gain?: number;
  key_shift?: number;
  start_bar?: number;
}

export interface ImageRemixResponse {
  output_path: string;
  relative_path: string;
  layers: number;
  mastered: boolean;
  master_path?: string;
}

export interface ImagePreviewRequest {
  layers: ImageRemixRequest["images"];
  preset?: ImageRemixRequest["preset"];
}

export interface ImagePreviewResponse {
  output_path: string;
  relative_path: string;
  preview_url: string;
}

export interface ImageCapabilities {
  service: string;
  pillow_version: string;
  features: Record<string, boolean>;
  operations: Record<string, unknown>;
  max_image_size: { width: number; height: number };
  max_file_size_mb: number;
}

export interface ImageHealth {
  status: string;
  service: string;
  bridge_version: string;
  provider_update_detected: boolean;
  compatibility: {
    parameter_map: Record<string, string>;
    response_map: Record<string, string>;
    unsupported_features: string[];
  };
}

/**
 * Process an image with various effects using Pillow 13.0.
 */
export async function processImage(
  file: File,
  params: ImageProcessRequest,
): Promise<ImageProcessResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("style", params.style);
  if (params.style_image) {
    formData.append("style_image", params.style_image);
  }
  if (params.output_name) {
    formData.append("output_name", params.output_name);
  }

  const res = await fetchWithTimeout(
    `${getApiBase()}/api/image/process`,
    {
      method: "POST",
      body: formData,
      timeout: 300000,
    },
  );
  return unwrap<ImageProcessResponse>(res, "Failed to process image");
}

/**
 * Remix images into a mashup using ACE-Step bridge.
 */
export async function remixImage(
  recipe: ImageRemixRequest,
): Promise<ImageRemixResponse> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/image/remix`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recipe),
      timeout: 300000,
    },
  );
  return unwrap<ImageRemixResponse>(res, "Failed to build remix");
}

/**
 * Preview a remix recipe without committing.
 */
export async function previewRemixRecipe(
  recipe: ImagePreviewRequest,
): Promise<ImagePreviewResponse> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/image/preview-recipe`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers: recipe.layers }),
      timeout: 120000,
    },
  );
  return unwrap<ImagePreviewResponse>(res, "Failed to preview remix recipe");
}

/**
 * Get image processing capabilities and available features.
 */
export async function getImageCapabilities(): Promise<ImageCapabilities> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/image/capabilities`,
    { timeout: 30000 },
  );
  return unwrap<ImageCapabilities>(res, "Failed to get image capabilities");
}

/**
 * Check image processing service health.
 */
export async function checkImageProcessingHealth(): Promise<ImageHealth> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/image/health`,
    { timeout: 10000 },
  );
  return unwrap<ImageHealth>(res, "Failed to get image processing health");
}

/**
 * Generic helper to unwrap a JSON response body.
 * Throws if the response is not OK.
 */
async function unwrap<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${context}: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}
