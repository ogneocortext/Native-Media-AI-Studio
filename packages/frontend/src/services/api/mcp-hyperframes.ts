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
