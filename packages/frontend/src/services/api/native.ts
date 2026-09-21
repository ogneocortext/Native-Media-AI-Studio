import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export async function openInBlender(relativePath: string): Promise<{ success: boolean; method?: string; message?: string; path?: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/native/open/blender`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relative_path: relativePath }), timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to open in Blender" }));
    throw new Error((err as { detail?: string }).detail || "Failed to open in Blender");
  }
  return res.json();
}

export async function openInUnity(relativePath: string): Promise<{ success: boolean; unity_path?: string; message?: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/native/open/unity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relative_path: relativePath }), timeout: 30000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to open in Unity" }));
    throw new Error((err as { detail?: string }).detail || "Failed to open in Unity");
  }
  return res.json();
}

export async function getNativeOpenStatus(): Promise<{ blender: { available: boolean; path: string | null }; unity: { available: boolean; project: string } }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/native/open/status`, { timeout: 10000 });
  if (!res.ok) throw new Error("Failed to get native open status");
  return res.json();
}

export interface FFmpegProcessInfo {
  pid: number;
  cpu?: number;
  working_set_mb?: number;
}

export async function getFFmpegStatus(): Promise<{ running: boolean; count: number; processes: FFmpegProcessInfo[] }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/health/ffmpeg`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get ffmpeg status");
  return res.json();
}
