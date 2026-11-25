/**
 * Frontend client for /api/integrations/ollama — Ollama model management and chat.
 */

import { getApiBase } from "./core";
import { getJson, postJson } from "./typed-fetch";
import { fetchWithTimeout } from "../fetchWithTimeout";
import type {
  OllamaModel,
  UnifiedModel,
  TaskModelRoute,
  ChatMessage,
  ToolDefinition,
  OllamaBenchmarkResult,
  HardwareBenchmarkRun,
  HardwareBenchmarkSummary,
  CodingBenchmarkResult,
  OllamaChatResponse,
  AIGeneratedPreset,
} from "./types";

const BASE = "/api/integrations/ollama";

/**
 * Get Ollama models with normalized fields.
 */
export async function getOllamaModels(verifiedOnly = false): Promise<OllamaModel[]> {
  const payload = await getJson<OllamaModel[] | { models?: OllamaModel[] }>(
    `${BASE}/models?verified_only=${verifiedOnly}`,
    { timeout: 30000 },
  );
  const entries = Array.isArray(payload) ? payload : (payload.models ?? []);
  // The endpoint returns snake_case (`model_name`, `supports_tools`,
  // `vram_required`), while this type declares camelCase. Normalise at this
  // one boundary so the rest of the frontend can trust the type.
  return entries
    .map((model) => {
      const raw = model as OllamaModel & Record<string, unknown>;
      const caps = raw.capabilities ?? [];
      const pick = (...keys: string[]): unknown => {
        for (const k of keys) {
          if (raw[k] !== undefined && raw[k] !== null) return raw[k];
        }
        return undefined;
      };
      return {
        ...raw,
        name: (pick("name", "model_name", "id") as string | undefined) ?? "",
        size: (pick("size", "model_size") as number | undefined) ?? 0,
        capabilities: caps,
        // Prefer the server's explicit flags; fall back to the capability list.
        supportsTools:
          (pick("supportsTools", "supports_tools") as boolean | undefined) ??
          caps.includes("tools"),
        supportsVision:
          (pick("supportsVision", "supports_vision") as boolean | undefined) ??
          caps.includes("vision"),
        supportsThinking:
          (pick("supportsThinking", "supports_thinking") as boolean | undefined) ??
          caps.includes("thinking"),
        vram_estimate_mb: (pick("vram_estimate_mb", "vram_required") as number | undefined) ?? 0,
        // Verification fields
        verified: pick("verified") as boolean | undefined,
        verified_features: pick("verified_features") as string[] | undefined,
        performance: pick("performance") as
          | { tokens_per_sec?: number; vision_latency_sec?: number }
          | undefined,
        verification_notes: pick("verification_notes") as string | undefined,
        broken_reason: pick("broken_reason") as string | undefined,
      };
    })
    .filter((m) => {
      const name = m.name.toLowerCase();
      return (
        name && !name.includes("embed") && !name.includes("nomic") && !name.includes("minigpt")
      );
    });
}

/**
 * Get unified models (Ollama + Atomic Chat).
 */
export async function getUnifiedModels(verifiedOnly = false): Promise<UnifiedModel[]> {
  const payload = await getJson<UnifiedModel[] | { models?: UnifiedModel[] }>(
    `/api/integrations/models/unified?verified_only=${verifiedOnly}`,
    { timeout: 30000 },
  );
  const entries = Array.isArray(payload) ? payload : (payload.models ?? []);
  return entries.map((m) => {
    const raw = m as UnifiedModel & Record<string, unknown>;
    const caps = (raw.capabilities as string[] | undefined) ?? [];
    const pick = (...keys: string[]): unknown => {
      for (const k of keys) {
        if (raw[k] !== undefined && raw[k] !== null) return raw[k];
      }
      return undefined;
    };
    return {
      ...raw,
      source: (pick("source") as UnifiedModel["source"] | undefined) ?? "ollama",
      name: (pick("name", "id") as string | undefined) ?? "",
      size: (pick("size", "model_size") as number | undefined) ?? 0,
      capabilities: caps,
      supports_tools: (pick("supports_tools") as boolean | undefined) ?? caps.includes("tools"),
      supports_vision: (pick("supports_vision") as boolean | undefined) ?? caps.includes("vision"),
      supports_thinking:
        (pick("supports_thinking") as boolean | undefined) ?? caps.includes("thinking"),
      supports_embedding:
        (pick("supports_embedding") as boolean | undefined) ?? caps.includes("embed"),
      supports_rerank: (pick("supports_rerank") as boolean | undefined) ?? caps.includes("rerank"),
      vram_required: (pick("vram_required") as number | undefined) ?? 0,
      verified: (pick("verified") as boolean | undefined) ?? false,
      verified_features: (pick("verified_features") as string[] | undefined) ?? [],
      performance:
        (pick("performance") as
          | { tokens_per_sec?: number; vision_latency_sec?: number }
          | undefined) ?? {},
      verification_notes: (pick("verification_notes") as string | undefined) ?? "",
      broken_reason: (pick("broken_reason") as string | undefined) ?? "",
      chat_eligible: (pick("chat_eligible") as boolean | undefined) ?? true,
      task_routes: (pick("task_routes") as string[] | undefined) ?? [],
    };
  });
}

/**
 * Get task model routes (which model for which task).
 */
export async function getTaskModelRoutes(): Promise<{
  routes: Record<string, TaskModelRoute>;
  excluded_from_chat: string[];
}> {
  return getJson<{
    routes: Record<string, TaskModelRoute>;
    excluded_from_chat: string[];
  }>(`/api/integrations/models/task-routes`, { timeout: 10000 });
}

/**
 * Check Ollama engine status.
 */
export async function ollamaEngineStatus(): Promise<{
  online: boolean;
  engine: string;
}> {
  const base = getApiBase();
  try {
    const res = await getJson<{ loaded?: boolean; server_online?: boolean }>(
      `${base}/api/health/ollama/models`,
      { timeout: 5000 },
    );
    return { online: Boolean(res.server_online ?? res.loaded), engine: "ollama" };
  } catch {
    return { online: false, engine: "ollama" };
  }
}

/**
 * Get benchmark results.
 */
export async function getBenchmarkResults(): Promise<{
  updated_at: string | null;
  results: Record<string, OllamaBenchmarkResult>;
}> {
  return getJson<{
    updated_at: string | null;
    results: Record<string, OllamaBenchmarkResult>;
  }>(`${BASE}/benchmark/results`, { timeout: 30000 });
}

/**
 * Run benchmark for specified models.
 * Long-running (up to 15 minutes).
 */
export async function runBenchmark(
  models?: string[],
  max_models = 8,
): Promise<{ updated_at: string | null; results: Record<string, OllamaBenchmarkResult> }> {
  return postJson<{
    updated_at: string | null;
    results: Record<string, OllamaBenchmarkResult>;
  }>(`${BASE}/benchmark/run`, { models: models ?? null, max_models }, { timeout: 900000 });
}

/**
 * Get best benchmark model.
 */
export async function getBestBenchmarkModel(): Promise<{
  best: string | null;
  result?: OllamaBenchmarkResult;
  results: { updated_at: string | null; results: Record<string, OllamaBenchmarkResult> };
}> {
  return getJson<{
    best: string | null;
    result?: OllamaBenchmarkResult;
    results: { updated_at: string | null; results: Record<string, OllamaBenchmarkResult> };
  }>(`${BASE}/benchmark/best`, { timeout: 30000 });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Get hardware benchmarks (aggregated per model from raw runs).
 * Only completed ollama runs count: a timed-out run's duration_ms is the
 * timeout budget, not a latency measurement.
 */
export async function getHardwareBenchmarks(): Promise<Record<string, HardwareBenchmarkSummary>> {
  const runs = await getJson<HardwareBenchmarkRun[]>(`/api/hardware/benchmarks?limit=200`, {
    timeout: 30000,
  });
  const byModel = new Map<string, HardwareBenchmarkRun[]>();
  for (const run of runs) {
    if (run.engine !== "ollama" || run.status !== "completed") continue;
    const list = byModel.get(run.model) ?? [];
    list.push(run);
    byModel.set(run.model, list);
  }
  const summary: Record<string, HardwareBenchmarkSummary> = {};
  for (const [model, list] of byModel) {
    const latencies = list
      .map((r) => r.metrics?.median_latency_ms ?? r.duration_ms)
      .filter((v): v is number => typeof v === "number" && v > 0);
    const tokPerSec = list
      .map((r) => r.metrics?.tokens_per_second)
      .filter((v): v is number => typeof v === "number" && v > 0);
    const sortedRuns = [...list].sort((a, b) => b.started_at.localeCompare(a.started_at));
    summary[model] = {
      model,
      median_latency_ms: median(latencies) ?? 0,
      tokens_per_second: median(tokPerSec),
      runs: list.length,
      last_run_at: sortedRuns[0]?.started_at ?? "",
    };
  }
  return summary;
}

/**
 * Get coding benchmark results.
 */
export async function getCodingBenchmarkResults(): Promise<{
  updated_at: string | null;
  results: Record<string, CodingBenchmarkResult>;
}> {
  return getJson<{
    updated_at: string | null;
    results: Record<string, CodingBenchmarkResult>;
  }>(`${BASE}/coding-benchmark/results`, { timeout: 30000 });
}

/**
 * Run coding benchmark for specified models.
 * Long-running (up to 15 minutes).
 */
export async function runCodingBenchmark(
  models?: string[],
  max_models = 12,
): Promise<{ updated_at: string | null; results: Record<string, CodingBenchmarkResult> }> {
  return postJson<{
    updated_at: string | null;
    results: Record<string, CodingBenchmarkResult>;
  }>(`${BASE}/coding-benchmark/run`, { models: models ?? null, max_models }, { timeout: 900000 });
}

/**
 * Get best coding model.
 */
export async function getBestCodingModel(): Promise<{
  best: string | null;
  result?: CodingBenchmarkResult;
  results: { updated_at: string | null; results: Record<string, CodingBenchmarkResult> };
}> {
  return getJson<{
    best: string | null;
    result?: CodingBenchmarkResult;
    results: { updated_at: string | null; results: Record<string, CodingBenchmarkResult> };
  }>(`${BASE}/coding-benchmark/best`, { timeout: 30000 });
}

/**
 * Chat with Ollama (non-streaming).
 * Long-running (up to 5 minutes).
 */
export async function ollamaChat(
  message: string,
  model = "gemma4:e2b-it-qat",
  options?: {
    history?: ChatMessage[];
    tools?: ToolDefinition[];
    think?: boolean | string;
    maxToolCalls?: number;
  },
): Promise<OllamaChatResponse> {
  const base = getApiBase();
  return postJson<OllamaChatResponse>(
    `${base}${BASE}/chat`,
    {
      message,
      model,
      history: options?.history ?? [],
      tools: options?.tools ?? [],
      think: options?.think,
      stream: false,
      max_tool_calls: options?.maxToolCalls ?? 5,
    },
    { timeout: 300000 },
  );
}

/**
 * Chat with Ollama (streaming).
 * Returns ReadableStream for SSE parsing.
 * Long-running (up to 5 minutes).
 */
export async function ollamaChatStream(
  message: string,
  model = "gemma4:e2b-it-qat",
  options?: {
    history?: ChatMessage[];
    tools?: ToolDefinition[] | boolean;
    think?: boolean | string;
    maxToolCalls?: number;
    system?: string;
    ollamaOptions?: Record<string, unknown>;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    repeat_penalty?: number;
    num_ctx?: number;
  },
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const base = getApiBase();
  const ollamaOpts: Record<string, unknown> = {
    ...(options?.ollamaOptions ?? {}),
  };
  const optionsRecord = options as Record<string, unknown> | undefined;
  for (const k of [
    "temperature",
    "top_p",
    "top_k",
    "num_predict",
    "repeat_penalty",
    "num_ctx",
    "seed",
    "stop",
  ]) {
    if (optionsRecord?.[k] !== undefined) ollamaOpts[k] = optionsRecord[k];
  }
  // Raw fetch, not postJson: the response is an SSE stream, not JSON.
  const response = await fetchWithTimeout(`${base}${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model,
      history: options?.history ?? [],
      tools: options?.tools ?? [],
      think: options?.think,
      stream: true,
      max_tool_calls: options?.maxToolCalls ?? 5,
      system: options?.system,
      ...(Object.keys(ollamaOpts).length ? { options: ollamaOpts } : {}),
    }),
    signal,
    timeout: 300000,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const err = (await response.json()) as { detail?: unknown };
      if (typeof err.detail === "string") detail = err.detail;
      else if (err.detail != null) detail = JSON.stringify(err.detail);
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new Error(`Ollama chat failed (${response.status}): ${detail}`);
  }
  const body = response.body;
  if (!body) throw new Error("Ollama chat response had no body");
  return body;
}

/**
 * Parse Ollama SSE stream into typed events.
 */
export async function* parseOllamaStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<{
  type: "content" | "tool_calls" | "tool_result" | "done" | "connected" | "error";
  data: unknown;
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEvent = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          lastEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6)) as unknown;

            if (lastEvent === "content") {
              yield { type: "content", data };
            } else if (lastEvent === "tool_calls") {
              yield { type: "tool_calls", data };
            } else if (lastEvent === "tool_result") {
              yield { type: "tool_result", data };
            } else if (lastEvent === "done") {
              yield { type: "done", data };
            } else if (lastEvent === "connected") {
              yield { type: "connected", data };
            } else if (lastEvent === "error") {
              yield { type: "error", data };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Generate with Ollama (non-chat).
 */
export async function ollamaGenerate(
  prompt: string,
  model = "gemma4:e2b-it-qat",
): Promise<{ response: string; model: string; done: boolean }> {
  const base = getApiBase();
  return postJson<{ response: string; model: string; done: boolean }>(
    `${base}${BASE}/generate`,
    { prompt, model },
    { timeout: 120000 },
  );
}

/**
 * Generate visualizer preset using AI.
 * Long-running (up to 2 minutes).
 */
export async function generateVisualizerPreset(
  description: string,
  model = "gemma4:e2b-it-qat",
  temperature = 0.7,
  track?: { bpm?: number; energy?: number; duration_seconds?: number; genre?: string },
): Promise<{ success: boolean; preset: AIGeneratedPreset; model: string }> {
  const base = getApiBase();
  return postJson<{ success: boolean; preset: AIGeneratedPreset; model: string }>(
    `${base}${BASE}/visualizer`,
    { description, model, temperature, track },
    { timeout: 120000 },
  );
}

/**
 * Generate visualizer preset using Atomic Chat (local Qwen).
 * Long-running (up to 2 minutes).
 */
export async function generateVisualizerPresetAtomic(
  description: string,
  model = "qwen3.5:4b",
  temperature = 0.7,
  track?: { bpm?: number; energy?: number; duration_seconds?: number; genre?: string },
): Promise<{ success: boolean; preset: AIGeneratedPreset; model: string }> {
  const base = getApiBase();
  return postJson<{ success: boolean; preset: AIGeneratedPreset; model: string }>(
    `${base}/api/integrations/atomic-chat/visualizer`,
    { description, model, temperature, track },
    { timeout: 120000 },
  );
}

export type * from "./types";
