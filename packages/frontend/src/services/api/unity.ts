import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface UnityStatus {
  online: boolean;
  error?: string;
  status?: unknown;
}

export interface UnityCommandResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Parameters accepted by the Unity Pipeline shader/material commands. */
export interface UnityShaderPropertiesParams extends Record<string, unknown> {
  shader: string;
  material_target?: string;
}

export interface UnityMaterialPropertiesParams extends Record<string, unknown> {
  object_name: string;
  material_name?: string;
}

export interface UnityMaterialPropertyUpdateParams extends UnityMaterialPropertiesParams {
  properties: Record<string, unknown>;
}

export async function listUnityShaders(): Promise<UnityCommandResult> {
  return sendUnityCommand("list_shaders");
}

export async function getUnityShaderProperties(
  params: UnityShaderPropertiesParams,
): Promise<UnityCommandResult> {
  return sendUnityCommand("get_shader_properties", params);
}

export async function getUnityMaterialProperties(
  params: UnityMaterialPropertiesParams,
): Promise<UnityCommandResult> {
  return sendUnityCommand("get_material_properties", params);
}

export async function setUnityMaterialProperties(
  params: UnityMaterialPropertyUpdateParams,
): Promise<UnityCommandResult> {
  return sendUnityCommand("set_material_properties", params);
}

/** Metadata for one Unity Pipeline command (from GET /api/unity/commands). */
export interface UnityCommandInfo {
  name: string;
  description?: string;
  tags?: string[];
  package?: string;
}

/**
 * Extract a human-readable message from a non-OK JSON body.
 * Handles both `{error}` (custom handlers) and FastAPI's `{detail}` shape.
 */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; detail?: unknown } | null;
  const raw = body?.error ?? body?.detail;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw.map(String).join("; ");
  return fallback;
}

export async function getUnityStatus(): Promise<UnityStatus> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/unity/status`, { timeout: 15000 });
  if (!res.ok) {
    return { online: false, error: await readErrorMessage(res, `HTTP ${res.status}`) };
  }
  const data = (await res.json().catch(() => null)) as Partial<UnityStatus> | null;
  if (!data || typeof data.online !== "boolean") {
    return { online: false, error: "Malformed status response from backend" };
  }
  return data as UnityStatus;
}

function isCommandInfo(value: unknown): value is UnityCommandInfo {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

/**
 * Normalize the commands payload into a flat command list.
 * Accepts the current envelope `{commands: [...], count, total, ...}`,
 * a bare array, or a legacy `{name: description}` record.
 */
function normalizeCommands(data: unknown): UnityCommandInfo[] {
  if (Array.isArray(data)) {
    return data.filter(isCommandInfo);
  }
  if (data && typeof data === "object") {
    const envelope = data as { commands?: unknown };
    if (Array.isArray(envelope.commands)) {
      return envelope.commands.filter(isCommandInfo);
    }
    const legacy: UnityCommandInfo[] = [];
    for (const [name, description] of Object.entries(data as Record<string, unknown>)) {
      if (typeof description === "string") {
        legacy.push({ name, description });
      }
    }
    return legacy;
  }
  return [];
}

export async function listUnityCommands(): Promise<UnityCommandInfo[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/unity/commands`, { timeout: 15000 });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to list Unity commands: HTTP ${res.status}`));
  }
  const data: unknown = await res.json().catch(() => null);
  return normalizeCommands(data);
}

export async function sendUnityCommand(
  command: string,
  parameters: Record<string, unknown> = {},
): Promise<UnityCommandResult> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/unity/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, parameters }),
    timeout: 30000,
  });
  if (!res.ok) {
    return { ok: false, error: await readErrorMessage(res, `HTTP ${res.status}`) };
  }
  const data = (await res.json().catch(() => null)) as Partial<UnityCommandResult> | null;
  if (!data || typeof data.ok !== "boolean") {
    return { ok: false, error: "Malformed response from backend" };
  }
  return data as UnityCommandResult;
}

export async function captureUnityScene(
  width = 1920,
  height = 1080,
  savePath = "output/unity_capture.png",
): Promise<unknown> {
  const base = getApiBase();
  // NOTE: getApiBase() may return "" (Vite dev proxy), so build the URL with a
  // plain string — `new URL(relativePath)` without a base throws TypeError.
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    save_path: savePath,
  });
  // The backend route is @router.post("/capture") — must be POST, not GET.
  const res = await fetchWithTimeout(`${base}/api/unity/capture?${params.toString()}`, {
    method: "POST",
    timeout: 60000,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Capture failed: HTTP ${res.status}`));
  }
  return res.json();
}
