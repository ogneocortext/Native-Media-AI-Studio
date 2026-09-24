import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface MCPContext {
  updatedAt?: number;
  character?: {
    name?: string;
    notes?: string;
    seed?: number;
    prompt?: string;
    visible?: boolean;
    animation?: string;
  };
  scene?: {
    name?: string;
    objects?: string[];
    camera?: string;
  };
  audio?: {
    filename?: string;
    bpm?: number;
    energy?: number;
    beat?: boolean;
  };
  visualization?: {
    style?: string;
    mode?: "3d" | "shader" | "2d";
    preset?: string;
  };
}

export async function fetchMCPContext(): Promise<MCPContext> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/context`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to fetch MCP context");
  return res.json();
}

export async function updateMCPContext(patch: MCPContext): Promise<MCPContext> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to update MCP context");
  return res.json();
}

export interface HyperFramesStatus {
  test_project: string;
  exists: boolean;
  hyperframes_cli: string;
  cli_available: boolean;
  version: string;
}

export interface CompileStoryboardRequest {
  storyboard: {
    track?: string;
    title?: string;
    duration?: number;
    scenes: Array<{
      id?: string;
      title?: string;
      description?: string;
      start?: number;
      end?: number;
      duration_seconds?: number;
      palette?: Record<string, string>;
    }>;
  };
  name?: string;
  title?: string;
  audio_path?: string;
  audio_data?: HyperFramesAudioPayload;
}

export interface CompileStoryboardResponse {
  success: boolean;
  composition: string;
  manifest: string;
  scene_count: number;
  duration_seconds: number;
  message: string;
}

export async function compileStoryboard(params: CompileStoryboardRequest): Promise<CompileStoryboardResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/compile-storyboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to compile storyboard");
  }
  return res.json();
}

export interface HyperFramesAudioPayload {
  fps: number;
  duration: number;
  bands: number;
  totalFrames: number;
  beat_times: number[];
  downbeat_times: number[];
  frames: Array<{ time: number; rms: number; energy: number; bands: number[]; isBeat: boolean; isDownbeat: boolean }>;
  lyrics: unknown[];
}

export async function getHyperFramesAudioPayload(filename: string, fps = 30, bands = 16): Promise<HyperFramesAudioPayload> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/audio/hyperframes-payload/${encodeURIComponent(filename)}?fps=${fps}&bands=${bands}`, { timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to build HyperFrames audio payload");
  }
  return res.json();
}

export async function getHyperFramesStatus(): Promise<HyperFramesStatus> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/status`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get HyperFrames status");
  return res.json();
}

export async function getHyperFramesExamples(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/examples`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get HyperFrames examples");
  return res.json();
}

export async function launchHyperFramesPreview(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/preview`, {
    method: "POST",
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to launch HyperFrames preview");
  return res.json();
}

export async function renderHyperFramesComposition(params: {
  composition?: string;
  format?: string;
  fps?: number;
  quality?: string;
  workers?: string;
  output?: string;
}): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hyperframes/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    timeout: 300000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to render HyperFrames composition");
  }
  return res.json();
}
