/**
 * Frontend client for /api/unity — Unity Editor control via MCP pipeline.
 */

import { getApiBase } from "./core";
import { getJson, postJson, fetchJson } from "./typed-fetch";
import type {
  UnityStatus,
  UnityCommandResult,
  UnityCommandInfo,
} from "./types";

const BASE = "/api/unity";

/**
 * Get Unity Editor status.
 */
export async function getUnityStatus(): Promise<UnityStatus> {
  const base = getApiBase();
  try {
    return getJson<UnityStatus>(`${base}${BASE}/status`, { timeout: 15000 });
  } catch (err) {
    return { online: false, error: err instanceof Error ? err.message : `HTTP error` };
  }
}

/**
 * List all Unity Pipeline commands.
 */
export async function listUnityCommands(): Promise<UnityCommandInfo[]> {
  return getJson<UnityCommandInfo[]>(`${BASE}/commands`, { timeout: 15000 });
}

/**
 * Send a Unity Pipeline command.
 */
export async function sendUnityCommand(
  command: string,
  parameters: Record<string, unknown> = {},
): Promise<UnityCommandResult> {
  return postJson<UnityCommandResult>(`${BASE}/command`, { command, parameters }, { timeout: 30000 });
}

/**
 * Capture Unity Scene view to PNG.
 * Long-running (up to 1 minute).
 */
export async function captureUnityScene(
  width = 1920,
  height = 1080,
  savePath = "output/unity_capture.png",
): Promise<unknown> {
  const base = getApiBase();
  // Validate save path
  if (
    !savePath.trim() ||
    savePath.includes("..") ||
    savePath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(savePath)
  ) {
    throw new Error("Capture save path must be relative and cannot contain '..'");
  }
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    save_path: savePath,
  });
  // The backend route is @router.post("/capture") — must be POST, not GET.
  return fetchJson<unknown>(`${base}${BASE}/capture?${params.toString()}`, {
    method: "POST",
    timeout: 60000,
  });
}

/* -------------------------------------------------------------------------- */
/* Shader & Material Helpers                                                  */
/* -------------------------------------------------------------------------- */

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Build Unity material properties from audio frame data.
 * Used for syncing visualizer shaders to audio.
 */
export function buildUnityAudioFrameProperties(frame: {
  audioData: {
    bass: number;
    mid: number;
    treble: number;
    beat: boolean;
    energy: number;
    peak: number;
    beatPhase: number;
    analyzedEnergy?: number;
  };
  audioTime: number;
  progress?: number;
  intensity?: number;
}): Record<string, number> {
  const { audioData, audioTime, progress = 0, intensity = 1 } = frame;
  return {
    _Bass: clampFinite(audioData.bass, 0, 1, 0),
    _Mid: clampFinite(audioData.mid, 0, 1, 0),
    _Treble: clampFinite(audioData.treble, 0, 1, 0),
    _Beat: clampFinite(audioData.beat ? 1 : 0, 0, 1, 0),
    _Energy: clampFinite(audioData.analyzedEnergy ?? audioData.energy, 0, 1, 0),
    _AudioTime: Math.max(0, Number.isFinite(audioTime) ? audioTime : 0),
    _Progress: clampFinite(progress, 0, 1, 0),
    _Intensity: clampFinite(intensity, 0, 4, 1),
  };
}

/**
 * Sync Unity material with audio frame data.
 * Shortcut for the common pattern of updating a material with audio-reactive properties.
 */
export async function syncUnityAudioFrame(params: {
  material: string;
  frame: {
    audioData: {
      bass: number;
      mid: number;
      treble: number;
      beat: boolean;
      energy: number;
      peak: number;
      beatPhase: number;
      analyzedEnergy?: number;
    };
    audioTime: number;
    progress?: number;
    intensity?: number;
  };
}): Promise<UnityCommandResult> {
  if (!params.material.trim()) {
    return { ok: false, error: "Unity material path is required" };
  }
  return setUnityMaterialProperties({
    material: params.material,
    properties: buildUnityAudioFrameProperties(params.frame),
  });
}

/**
 * List available shaders.
 */
export async function listUnityShaders(): Promise<UnityCommandResult> {
  return sendUnityCommand("list_shaders");
}

/**
 * Get shader properties.
 */
export async function getUnityShaderProperties(params: {
  shader: string;
  material_target?: string;
}): Promise<UnityCommandResult> {
  return sendUnityCommand("get_shader_properties", params);
}

/**
 * Get material properties.
 */
export async function getUnityMaterialProperties(params: {
  object_name: string;
  material_name?: string;
}): Promise<UnityCommandResult> {
  return sendUnityCommand("get_material_properties", params);
}

/**
 * Set material properties.
 */
export async function setUnityMaterialProperties(params: {
  object_name?: string;
  material?: string;
  material_name?: string;
  properties: Record<string, unknown>;
}): Promise<UnityCommandResult> {
  return sendUnityCommand("set_material_properties", params);
}

export type * from "./types";
