/**
 * Frontend client for /api/native — Blender/Unity integration and FFmpeg status.
 */

import { getApiBase } from "./core";
import { postJson, getJson } from "./typed-fetch";
import type { FFmpegProcessInfo, NativeOpenStatus } from "./types";

const BASE = "/api/native";

/**
 * Open a file in Blender.
 */
export async function openInBlender(relativePath: string): Promise<{
  success: boolean;
  method?: string;
  message?: string;
  path?: string;
}> {
  return postJson<{
    success: boolean;
    method?: string;
    message?: string;
    path?: string;
  }>(`${BASE}/open/blender`, { relative_path: relativePath }, { timeout: 30000 });
}

/**
 * Open a file in Unity.
 */
export async function openInUnity(relativePath: string): Promise<{
  success: boolean;
  unity_path?: string;
  message?: string;
}> {
  return postJson<{
    success: boolean;
    unity_path?: string;
    message?: string;
  }>(`${BASE}/open/unity`, { relative_path: relativePath }, { timeout: 30000 });
}

/**
 * Get native open status (Blender/Unity availability).
 */
export async function getNativeOpenStatus(): Promise<NativeOpenStatus> {
  const base = getApiBase();
  return getJson<NativeOpenStatus>(`${base}${BASE}/open/status`, { timeout: 10000 });
}

/**
 * Get FFmpeg process status.
 */
export async function getFFmpegStatus(): Promise<{
  running: boolean;
  count: number;
  processes: FFmpegProcessInfo[];
}> {
  const base = getApiBase();
  return getJson<{
    running: boolean;
    count: number;
    processes: FFmpegProcessInfo[];
  }>(`${base}/api/health/ffmpeg`, { timeout: 30000 });
}