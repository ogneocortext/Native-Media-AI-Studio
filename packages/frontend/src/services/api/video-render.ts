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
