import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface OllamaModel {
  name: string;
  size: number;
  modified_at?: string;
  capabilities?: string[];
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  vram_estimate_mb?: number;
  benchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
  codingBenchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
  // Verification fields
  verified?: boolean;
  verified_features?: string[];
  performance?: { tokens_per_sec?: number; vision_latency_sec?: number };
  verification_notes?: string;
  broken_reason?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: Date;
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  tool_name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

export async function getOllamaModels(verifiedOnly = false): Promise<OllamaModel[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/models?verified_only=${verifiedOnly}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get Ollama models");
  const payload = await res.json();
  const entries = Array.isArray(payload) ? payload : payload.models || [];
  // The two handlers that have served this path disagreed on field names: the one
  // actually reachable returned snake_case (`model_name`, `supports_tools`,
  // `vram_required`), while this type declared camelCase. `name` and `size` were
  // already reconciled here, but `supportsTools` / `supportsVision` /
  // `vram_estimate_mb` were not, so every consumer of them read `undefined` -
  // measured consumers: the AI Tools model list, its sidebar badges, and the VRAM
  // figure in Ollama Chat. Normalise all of them at this one boundary so the rest
  // of the frontend can trust the type.
  return entries
    .map((model: OllamaModel & Record<string, unknown>) => {
      const caps = (model.capabilities as string[] | undefined) ?? [];
      const pick = (...keys: string[]): unknown => {
        for (const k of keys) {
          if (model[k] !== undefined && model[k] !== null) return model[k];
        }
        return undefined;
      };
      return {
        ...model,
        name: (model.name as string) || (pick("model_name", "id") as string) || "",
        size: (model.size as number) ?? (pick("model_size") as number) ?? 0,
        capabilities: caps,
        // Prefer the server's explicit flags; fall back to the capability list,
        // which Ollama populates authoritatively on 0.35.x.
        supportsTools:
          (pick("supportsTools", "supports_tools") as boolean | undefined) ??
          caps.includes("tools"),
        supportsVision:
          (pick("supportsVision", "supports_vision") as boolean | undefined) ??
          caps.includes("vision"),
        supportsThinking:
          (pick("supportsThinking", "supports_thinking") as boolean | undefined) ??
          caps.includes("thinking"),
        vram_estimate_mb:
          (pick("vram_estimate_mb", "vram_required") as number | undefined) ?? 0,
        // Verification fields
        verified: pick("verified") as boolean | undefined,
        verified_features: pick("verified_features") as string[] | undefined,
        performance: pick("performance") as { tokens_per_sec?: number; vision_latency_sec?: number } | undefined,
        verification_notes: pick("verification_notes") as string | undefined,
        broken_reason: pick("broken_reason") as string | undefined,
      };
    })
    .filter((m: OllamaModel) => {
      const name = m.name.toLowerCase();
      return (
        name &&
        !name.includes("embed") &&
        !name.includes("nomic") &&
        !name.includes("minigpt") &&
        !name.includes("clip")
      );
    });
}

export async function ollamaEngineStatus(): Promise<{
  online: boolean;
  engine: string;
}> {
  const base = getApiBase();
  try {
    const res = await fetchWithTimeout(`${base}/api/health/ollama/models`, {
      timeout: 5000,
    });
    if (!res.ok) return { online: false, engine: "ollama" };
    const data = (await res.json()) as { loaded?: boolean };
    return { online: Boolean(data.loaded), engine: "ollama" };
  } catch {
    return { online: false, engine: "ollama" };
  }
}

export interface OllamaBenchmarkResult {
  model: string;
  success: boolean;
  latency_ms: number;
  chars: number;
  lines: number;
  validation: {
    score: number;
    raw_score: number;
    max_score: number;
    passed_rules: number;
    total_rules: number;
    details: Array<{ rule: string; description: string; weight: number; passed: boolean }>;
    metrics: {
      lines: number;
      chars: number;
      balanced_braces: boolean;
      node_valid: boolean | null;
      node_error: string | null;
    };
  };
  preview: string;
  error: string | null;
  timestamp: string;
}

export async function getBenchmarkResults(): Promise<{
  updated_at: string | null;
  results: Record<string, OllamaBenchmarkResult>;
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/benchmark/results`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get benchmark results");
  return res.json();
}

export async function runBenchmark(
  models?: string[],
  max_models = 8,
): Promise<{ updated_at: string | null; results: Record<string, OllamaBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/benchmark/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models: models || null, max_models }),
    timeout: 900000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Benchmark failed" }));
    throw new Error(err.detail || "Benchmark failed");
  }
  return res.json();
}

export async function getBestBenchmarkModel(): Promise<{
  best: string | null;
  result?: OllamaBenchmarkResult;
  results: { updated_at: string | null; results: Record<string, OllamaBenchmarkResult> };
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/benchmark/best`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get best benchmark model");
  return res.json();
}

export interface HardwareBenchmarkMetrics {
  median_latency_ms?: number;
  avg_latency_ms?: number;
  min_latency_ms?: number;
  max_latency_ms?: number;
  latency_q1_ms?: number;
  latency_q3_ms?: number;
  tokens_per_second?: number;
  output_tokens?: number;
  prompt_tokens?: number;
}

export interface HardwareBenchmarkRun {
  run_id: string;
  engine: string;
  model: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number;
  iterations?: number;
  successful_iterations?: number;
  error?: string | null;
  metrics?: HardwareBenchmarkMetrics;
}

// Aggregated per model from raw GET /api/hardware/benchmarks rows. Only
// completed ollama runs count toward the median: a timed-out run's
// duration_ms is the timeout budget, not a latency measurement, and a
// failed run has no meaningful latency at all.
export interface HardwareBenchmarkSummary {
  model: string;
  median_latency_ms: number;
  tokens_per_second: number | null;
  runs: number;
  last_run_at: string;
}

function medianLatency(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function getHardwareBenchmarks(): Promise<
  Record<string, HardwareBenchmarkSummary>
> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/hardware/benchmarks?limit=200`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get hardware benchmarks");
  const runs = (await res.json()) as HardwareBenchmarkRun[];
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
    const sortedRuns = [...list].sort((a, b) =>
      b.started_at.localeCompare(a.started_at),
    );
    summary[model] = {
      model,
      median_latency_ms: medianLatency(latencies) ?? 0,
      tokens_per_second: medianLatency(tokPerSec),
      runs: list.length,
      last_run_at: sortedRuns[0]?.started_at ?? "",
    };
  }
  return summary;
}

export interface CodingBenchmarkTaskResult {
  task: string;
  weight: number;
  success: boolean;
  latency_ms: number;
  validation: {
    score: number;
    raw_score: number;
    max_score: number;
    passed_rules: number;
    total_rules: number;
    details: Array<{ rule: string; passed: boolean; weight: number }>;
    metrics: Record<string, unknown>;
  };
  preview: string;
  error: string | null;
}

export interface CodingBenchmarkResult {
  model: string;
  success: boolean;
  total_score: number;
  raw_score: number;
  max_score: number;
  total_latency_ms: number;
  tasks: CodingBenchmarkTaskResult[];
  timestamp: string;
}

export async function getCodingBenchmarkResults(): Promise<{
  updated_at: string | null;
  results: Record<string, CodingBenchmarkResult>;
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/coding-benchmark/results`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get coding benchmark results");
  return res.json();
}

export async function runCodingBenchmark(
  models?: string[],
  max_models = 12,
): Promise<{ updated_at: string | null; results: Record<string, CodingBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/coding-benchmark/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models: models || null, max_models }),
    timeout: 900000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Coding benchmark failed" }));
    throw new Error(err.detail || "Coding benchmark failed");
  }
  return res.json();
}

export async function getBestCodingModel(): Promise<{
  best: string | null;
  result?: CodingBenchmarkResult;
  results: { updated_at: string | null; results: Record<string, CodingBenchmarkResult> };
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/coding-benchmark/best`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get best coding model");
  return res.json();
}

export async function ollamaChat(
  message: string,
  model: string = "gemma4:e2b-it-qat",
  options?: {
    history?: ChatMessage[];
    tools?: ToolDefinition[];
    think?: boolean | string;
    maxToolCalls?: number;
  },
): Promise<{
  response: string;
  model: string;
  toolCalls: number;
  toolDetails?: Array<{ name: string; arguments: Record<string, unknown>; result: string }>;
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model,
      history: options?.history || [],
      tools: options?.tools || [],
      think: options?.think,
      stream: false,
      max_tool_calls: options?.maxToolCalls || 5,
    }),
    timeout: 300000,
  });
  if (!res.ok) throw new Error("Failed to chat with Ollama");
  return res.json();
}

export async function ollamaChatStream(
  message: string,
  model: string = "gemma4:e2b-it-qat",
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
    ...(options?.ollamaOptions || {}),
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
  const res = await fetch(`${base}/api/integrations/ollama/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model,
      history: options?.history || [],
      tools: options?.tools || [],
      think: options?.think,
      stream: true,
      max_tool_calls: options?.maxToolCalls || 5,
      system: options?.system,
      ...(Object.keys(ollamaOpts).length ? { options: ollamaOpts } : {}),
    }),
    signal,
  });
  if (!res.ok) throw new Error("Failed to chat with Ollama");
  return res.body!;
}

export async function* parseOllamaStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<{
  type: "content" | "tool_calls" | "tool_result" | "done" | "connected" | "error";
  data: unknown;
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          lastEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));

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

export async function ollamaGenerate(
  prompt: string,
  model: string = "llama2",
): Promise<{ response: string; model: string; done: boolean }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(
    `${base}/api/integrations/ollama/generate?prompt=${encodeURIComponent(prompt)}&model=${model}`,
    { timeout: 120000 },
  );
  if (!res.ok) throw new Error("Failed to generate via Ollama");
  return res.json();
}

export interface AIGeneratedPreset {
  version: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    glow: string;
  };
  visualizer: {
    style: string;
    colors: string;
    intensity: number;
    particleCount: number;
    speed: number;
    scale: number;
    glow: boolean;
    rotation: boolean;
  };
  camera: {
    keyframes: Array<{
      at: number;
      position: [number, number, number];
      target: [number, number, number];
      easing?: string;
    }>;
    mode: string;
    fov: number;
  };
  postfx: Record<string, number>;
  lyrics: {
    style: string;
    glowIntensity: number;
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    beatReact: boolean;
    enterAnimation: string;
    exitAnimation: string;
  };
  audioReactivity: {
    bass: string;
    mid: string;
    treble: string;
    beat: string;
    beatDecay: number;
    smoothing: number;
  };
}

export async function generateVisualizerPreset(
  description: string,
  model: string = "gemma4:e2b-it-qat",
  temperature: number = 0.7,
  track?: { bpm?: number; energy?: number; duration_seconds?: number; genre?: string },
): Promise<{ success: boolean; preset: AIGeneratedPreset; model: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/visualizer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, model, temperature, track }),
    timeout: 120000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate visualizer preset");
  }
  return res.json();
}
