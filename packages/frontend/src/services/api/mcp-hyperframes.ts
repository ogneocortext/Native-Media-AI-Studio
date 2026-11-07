/**
 * Frontend client for MCP context and HyperFrames integration.
 */

import { getApiBase } from "./core";
import { getJson, postJson } from "./typed-fetch";
import type {
  MCPContext,
  CompileStoryboardRequest,
  CompileStoryboardResponse,
  HyperFramesAudioPayload,
  HyperFramesStatus,
  HyperFramesExample,
  RenderHyperFramesResponse,
} from "./types";

const BASE = "/api/health";
const HF_BASE = "/api/hyperframes";

/**
 * Fetch current MCP context (character, scene, audio, visualization).
 */
export async function fetchMCPContext(): Promise<MCPContext> {
  return getJson<MCPContext>(`${BASE}/context`, { timeout: 30000 });
}

/**
 * Update MCP context (merge patch).
 */
export async function updateMCPContext(patch: MCPContext): Promise<MCPContext> {
  return postJson<MCPContext>(`${BASE}/context`, patch, { timeout: 30000 });
}

/**
 * Compile a storyboard into a HyperFrames composition.
 */
export async function compileStoryboard(
  params: CompileStoryboardRequest,
): Promise<CompileStoryboardResponse> {
  const base = getApiBase();
  return postJson<CompileStoryboardResponse>(`${base}${HF_BASE}/compile-storyboard`, params, {
    timeout: 30000,
  });
}

/**
 * Get HyperFrames audio payload for a track.
 */
export async function getHyperFramesAudioPayload(
  filename: string,
  fps = 30,
  bands = 16,
): Promise<HyperFramesAudioPayload> {
  return getJson<HyperFramesAudioPayload>(
    `${base}/api/audio/hyperframes-payload/${encodeURIComponent(filename)}?fps=${fps}&bands=${bands}`,
    { timeout: 30000 },
  );
}

/**
 * Get HyperFrames CLI status.
 */
export async function getHyperFramesStatus(): Promise<HyperFramesStatus> {
  const base = getApiBase();
  return getJson<HyperFramesStatus>(`${base}${HF_BASE}/status`, { timeout: 30000 });
}

/**
 * Get HyperFrames example compositions.
 */
export async function getHyperFramesExamples(): Promise<HyperFramesExample[]> {
  const base = getApiBase();
  return getJson<HyperFramesExample[]>(`${base}${HF_BASE}/examples`, { timeout: 30000 });
}

/**
 * Launch HyperFrames preview server.
 */
export async function launchHyperFramesPreview(): Promise<{ url: string }> {
  const base = getApiBase();
  return getJson<{ url: string }>(`${base}${HF_BASE}/preview`, { method: "POST", timeout: 30000 });
}

/**
 * Render a HyperFrames composition to video.
 * Long-running (up to 5 minutes).
 */
export async function renderHyperFramesComposition(params: {
  composition?: string;
  format?: string;
  fps?: number;
  quality?: string;
  workers?: string;
  output?: string;
}): Promise<RenderHyperFramesResponse> {
  const base = getApiBase();
  return postJson<RenderHyperFramesResponse>(`${base}${HF_BASE}/render`, params, { timeout: 300000 });
}