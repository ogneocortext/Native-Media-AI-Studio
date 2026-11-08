/**
 * Frontend client for /api/video/render — video rendering, export matrix, canvas loops, scene routing.
 */

import { getJson, postJson } from "./typed-fetch";
import type {
  RenderEngineInfo,
  RenderResponse,
  ExportMatrixResponse,
  CanvasLoopResponse,
  RouteSceneResponse,
  AssembleResponse,
  StemVisualizationResponse,
} from "./types";

const BASE = "/api/video";

/**
 * Get available render engines.
 */
export async function getRenderEngines(): Promise<RenderEngineInfo[]> {
  return getJson<{ engines: RenderEngineInfo[] }>(`${BASE}/render/engines`, { timeout: 30000 })
    .then((r) => r.engines);
}

/**
 * Render a video clip.
 * Long-running (up to 10 minutes).
 */
export async function renderClip(params: {
  kind: "color" | "frames" | "image";
  engine?: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  output_path?: string;
  color?: string;
  frames_dir?: string;
  frame_pattern?: string;
  image_path?: string;
  audio_path?: string;
}): Promise<RenderResponse> {
  return postJson<RenderResponse>(`${BASE}/render`, params, { timeout: 600000 });
}

/**
 * Build export matrix (vertical, loop, thumbnail variants).
 * Long-running (up to 10 minutes).
 */
export async function buildExportMatrix(params: {
  source_path: string;
  beat_times?: number[];
  sections?: { type: string; start: number; end: number; energy?: number }[];
  loop_seconds?: number;
}): Promise<ExportMatrixResponse> {
  return postJson<ExportMatrixResponse>(`${BASE}/export-matrix`, params, { timeout: 600000 });
}

/**
 * Create Spotify Canvas loop.
 * Long-running (up to 2 minutes).
 */
export async function createCanvasLoop(params: {
  source_path: string;
  start?: number | null;
  duration?: number;
  width?: number;
  height?: number;
  output_path?: string | null;
  crossfade?: number;
}): Promise<CanvasLoopResponse> {
  return postJson<CanvasLoopResponse>(`${BASE}/canvas-loop`, params, { timeout: 120000 });
}

/**
 * Route a scene to a model (per-scene model routing).
 */
export async function routeScene(params: {
  section_type: string;
  energy?: number | null;
  duration?: number | null;
  vram_available_mb?: number | null;
}): Promise<RouteSceneResponse> {
  return postJson<RouteSceneResponse>(`${BASE}/route-scene`, params, { timeout: 30000 });
}

/**
 * Assemble beat-quantized video from shots.
 * Long-running (up to 10 minutes).
 */
export async function assembleBeatQuantized(params: {
  shot_manifest: Record<string, unknown>[];
  output_path?: string | null;
  audio_path?: string | null;
  engine?: string;
  transition?: string;
  transition_duration?: number;
  beat_times?: number[] | null;
}): Promise<AssembleResponse> {
  return postJson<AssembleResponse>(`${BASE}/assemble`, params, { timeout: 600000 });
}

/**
 * Get stem visualization uniforms for shader reactivity.
 * Long-running (up to 2 minutes).
 */
export async function getStemVisualization(params: {
  filename: string;
}): Promise<StemVisualizationResponse> {
  return postJson<StemVisualizationResponse>(
    `${BASE}/stem-visualization`,
    params,
    { timeout: 120000 },
  );
}

export type * from "./types";
