import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface RenderEngineInfo {
  id: string;
  label: string;
  notes: string;
  available: boolean;
  detail: string;
}

export interface RenderResponse {
  success: boolean;
  engine: string;
  output_path: string;
  relative_path: string | null;
  render_s: number;
  size_bytes: number;
  error: string | null;
  notes: string;
}

export async function getRenderEngines(): Promise<RenderEngineInfo[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/render/engines`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to list render engines");
  const data = await res.json();
  return data.engines;
}

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
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Render request failed");
  }
  return res.json();
}

export interface MatrixArtifact {
  kind: "vertical" | "loop" | "thumbnail";
  path: string;
  relative_path: string;
  width: number;
  height: number;
  duration: number;
  notes: string;
}

export interface ExportMatrixResponse {
  success: boolean;
  source: string;
  artifacts: MatrixArtifact[];
  errors: { kind: string; error: string }[];
  render_s: number;
  manifest_path: string | null;
  message: string;
}

export interface CostEstimate {
  estimated_seconds: number;
  estimated_minutes: number;
  estimated_end_time: string;
  sec_per_frame: number;
  total_frames: number;
  vram_estimate_mb: number;
  vram_estimate_gb: number;
  cloud_cost_usd: number | null;
  cloud_price_per_second: number | null;
  factors: Record<string, any> | null;
  // A2 per-shot breakdown
  total_shots?: number | null;
  total_duration_seconds?: number | null;
  vram_peak_mb?: number | null;
  vram_peak_gb?: number | null;
  shots?: Array<{
    shot_id: string;
    model: string;
    duration_seconds: number;
    estimated_seconds: number;
    estimated_minutes: number;
    total_frames: number;
    vram_estimate_mb: number;
    vram_estimate_gb: number;
    cloud_cost_usd?: number | null;
  }>;
}

export async function estimateRenderCost(params: {
  steps: number;
  width: number;
  height: number;
  fps: number;
  duration_seconds: number;
  model: string;
  cloud_price_per_second?: number | null;
  shot_manifest?: Array<Record<string, any>> | null;
  default_model?: string;
}): Promise<CostEstimate> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/estimate-cost`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Cost estimation failed");
  }
  return res.json();
}

export async function buildExportMatrix(params: {
  source_path: string;
  beat_times?: number[];
  sections?: { type: string; start: number; end: number; energy?: number }[];
  loop_seconds?: number;
}): Promise<ExportMatrixResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/export-matrix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Export matrix failed");
  }
  return res.json();
}

// A4 — Spotify Canvas loop extraction

export interface CanvasLoopResponse {
  success: boolean;
  output_path: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  message: string | null;
}

export async function createCanvasLoop(params: {
  source_path: string;
  start?: number | null;
  duration?: number;
  width?: number;
  height?: number;
  output_path?: string | null;
  crossfade?: number;
}): Promise<CanvasLoopResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/canvas-loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 120000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Canvas loop creation failed");
  }
  return res.json();
}

// A6 — Per-scene model routing

export interface RouteSceneResponse {
  model: string;
  tier: string;
  reason: string;
  vram_required_mb: number | null;
  cloud_fallback: string | null;
  routing_note: string | null;
}

export async function routeScene(params: {
  section_type: string;
  energy?: number | null;
  duration?: number | null;
  vram_available_mb?: number | null;
}): Promise<RouteSceneResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/route-scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Scene routing failed");
  }
  return res.json();
}

// A3 — Beat-quantized assembly

export interface AssembleResponse {
  success: boolean;
  output_path: string | null;
  duration: number | null;
  shots_used: number | null;
  render_s: number | null;
  error: string | null;
  message: string | null;
  engine: string | null;
}

export async function assembleBeatQuantized(params: {
  shot_manifest: Array<Record<string, any>>;
  output_path?: string | null;
  audio_path?: string | null;
  engine?: string;
  transition?: string;
  transition_duration?: number;
  beat_times?: number[] | null;
}): Promise<AssembleResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/video/assemble`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 600000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Assembly failed");
  }
  return res.json();
}

// A5 — Stem-reactive visualization uniforms

export interface StemVisualizationResponse {
  stems: Record<string, any>;
  separated: boolean;
  uniforms: Record<string, any>;
  curve_points: number;
}

export async function getStemVisualization(params: {
  filename: string;
}): Promise<StemVisualizationResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/stem-visualization`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 120000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Stem visualization failed");
  }
  return res.json();
}
