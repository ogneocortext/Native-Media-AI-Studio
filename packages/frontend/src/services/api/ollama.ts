import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface OllamaModel {
  name: string;
  size: number;
  modified_at?: string;
  capabilities?: string[];
  supportsTools?: boolean;
  supportsVision?: boolean;
  vram_estimate_mb?: number;
  benchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
  codingBenchmark?: { score: number; latency_ms: number; success: boolean; timestamp: string };
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

export async function getOllamaModels(): Promise<OllamaModel[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/models`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get Ollama models");
  const payload = await res.json();
  const entries = Array.isArray(payload) ? payload : (payload.models || []);
  return entries.map((model: OllamaModel & { id?: string; model_name?: string; model_size?: number }) => ({
    ...model,
    name: model.name || model.id || model.model_name || "",
    size: model.size ?? model.model_size ?? 0,
  })).filter((m: OllamaModel) => {
    const name = m.name.toLowerCase();
    return name && !name.includes("embed") && !name.includes("nomic") && !name.includes("minigpt") && !name.includes("clip");
  });
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
    metrics: { lines: number; chars: number; balanced_braces: boolean; node_valid: boolean | null; node_error: string | null };
  };
  preview: string;
  error: string | null;
  timestamp: string;
}

export async function getBenchmarkResults(): Promise<{ updated_at: string | null; results: Record<string, OllamaBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/benchmark/results`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get benchmark results");
  return res.json();
}

export async function runBenchmark(models?: string[], max_models = 8): Promise<{ updated_at: string | null; results: Record<string, OllamaBenchmarkResult> }> {
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

export async function getBestBenchmarkModel(): Promise<{ best: string | null; result?: OllamaBenchmarkResult; results: { updated_at: string | null; results: Record<string, OllamaBenchmarkResult> } }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/benchmark/best`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get best benchmark model");
  return res.json();
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

export async function getCodingBenchmarkResults(): Promise<{ updated_at: string | null; results: Record<string, CodingBenchmarkResult> }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/coding-benchmark/results`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get coding benchmark results");
  return res.json();
}

export async function runCodingBenchmark(models?: string[], max_models = 12): Promise<{ updated_at: string | null; results: Record<string, CodingBenchmarkResult> }> {
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

export async function getBestCodingModel(): Promise<{ best: string | null; result?: CodingBenchmarkResult; results: { updated_at: string | null; results: Record<string, CodingBenchmarkResult> } }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/ollama/coding-benchmark/best`, { timeout: 30000 });
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
): Promise<{ response: string; model: string; toolCalls: number; toolDetails?: Array<{ name: string; arguments: Record<string, unknown>; result: string }> }> {
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
  for (const k of ["temperature", "top_p", "top_k", "num_predict", "repeat_penalty", "num_ctx", "seed", "stop"]) {
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

export async function* parseOllamaStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ type: "content" | "tool_calls" | "done" | "connected" | "error"; data: unknown }> {
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
    keyframes: Array<{ at: number; position: [number, number, number]; target: [number, number, number]; easing?: string }>;
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
