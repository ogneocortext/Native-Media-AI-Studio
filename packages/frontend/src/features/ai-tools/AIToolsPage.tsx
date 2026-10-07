import { useState, useEffect, useCallback, useRef } from "react";
import {
  Brain,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle,
  Zap,
  Wifi,
  WifiOff,
  Palette,
  X,
  Wrench,
  Shield,
  Eye,
  Cpu,
  Code2,
} from "lucide-react";
import {
  getOllamaModels,
  ollamaChatStream,
  parseOllamaStream,
  getBenchmarkResults,
  runBenchmark,
  type OllamaModel,
  type ToolDefinition,
  type OllamaBenchmarkResult,
} from "../../services/api";
import { DS } from "../../styles/designSystem";
import { VisualizationCanvas } from "./VisualizationCanvas";
import { Sidebar } from "./Sidebar";
import { ToolEditor } from "./ToolEditor";
import { DEFAULT_TOOLS, type Tool, type HistoryEntry } from "./types";

export function AIToolsPage() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<string>("");
  const [toolCalls, setToolCalls] = useState<
    Array<{ name: string; arguments: Record<string, unknown>; result?: string }>
  >([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [tools, setTools] = useState<Tool[]>(DEFAULT_TOOLS);
  const [showToolEditor, setShowToolEditor] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [toolJsonValid, setToolJsonValid] = useState(true);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(
    new Set(DEFAULT_TOOLS.map((t) => t.id)),
  );
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [vizConfig, setVizConfig] = useState<
    import("./VisualizationCanvas").VisualizationConfig | null
  >(null);
  const [benchmarks, setBenchmarks] = useState<Record<string, OllamaBenchmarkResult>>({});
  const [benchLoading, setBenchLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      // Load verified models by default
      const modelList = await getOllamaModels(true);
      // Trust the backend. It now asks Ollama /api/show for authoritative
      // capabilities; the name checks that used to live here were wrong in both
      // directions and only ever added false positives - a model named "qwen..." was
      // offered tools whether or not it had them. Left in, they would override the
      // server's answer for exactly the models that need it least.
      const enhanced = modelList.map((m) => ({
        ...m,
        supportsTools: m.capabilities?.includes("tools") ?? false,
        supportsVision: m.capabilities?.includes("vision") ?? false,
      }));

      // Fetch benchmarks in parallel and enrich sorting
      let benchMap: Record<string, OllamaBenchmarkResult> = {};
      try {
        const data = await getBenchmarkResults();
        benchMap = data.results || {};
        setBenchmarks(benchMap);
      } catch {
        /* no benchmarks yet */
      }

      // Sort by benchmark score desc, then latency asc — best first
      // Verified models first
      const sorted = [...enhanced].sort((a, b) => {
        // Verified models first
        if (a.verified !== b.verified) return a.verified ? -1 : 1;
        const sa = a.benchmark?.score ?? benchMap[a.name]?.validation?.score ?? -1;
        const sb = b.benchmark?.score ?? benchMap[b.name]?.validation?.score ?? -1;
        if (sa !== sb) return sb - sa;
        const la = a.benchmark?.latency_ms ?? benchMap[a.name]?.latency_ms ?? 999999;
        const lb = b.benchmark?.latency_ms ?? benchMap[b.name]?.latency_ms ?? 999999;
        return la - lb;
      });
      setModels(sorted);
      setOllamaConnected(true);
      if (sorted.length > 0 && !selectedModel) {
        // Prefer the first verified model with tools support
        const toolModel = sorted.find((m) => m.supportsTools);
        setSelectedModel(toolModel?.name || sorted[0].name);
      }
    } catch {
      setOllamaConnected(false);
    }
  };

  const convertToToolDefinitions = useCallback((): ToolDefinition[] => {
    return tools
      .filter((t) => enabledTools.has(t.id))
      .map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
  }, [tools, enabledTools]);

  const handleRunBenchmark = useCallback(async () => {
    setBenchLoading(true);
    try {
      const data = await runBenchmark(undefined, 8);
      setBenchmarks(data.results || {});
      // Re-sort models by new scores
      setModels((prev) => {
        const sorted = [...prev].sort((a, b) => {
          const sa = data.results[a.name]?.validation?.score ?? -1;
          const sb = data.results[b.name]?.validation?.score ?? -1;
          if (sa !== sb) return sb - sa;
          return (
            (data.results[a.name]?.latency_ms ?? 999999) -
            (data.results[b.name]?.latency_ms ?? 999999)
          );
        });
        return sorted;
      });
    } catch {
      // Benchmark failed - silently ignore, models stay as-is
    } finally {
      setBenchLoading(false);
    }
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModel) return;
    setGenerating(true);
    setError(null);
    setResponse("");
    setToolCalls([]);
    setVizConfig(null);

    const supportsTools = models.find((m) => m.name === selectedModel)?.supportsTools;
    const activeTools = supportsTools ? convertToToolDefinitions() : [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const stream = await ollamaChatStream(
        prompt,
        selectedModel,
        {
          tools: activeTools,
          think: true,
          maxToolCalls: 5,
        },
        controller.signal,
      );

      let fullResponse = "";
      const toolDetails: Array<{
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
      }> = [];

      for await (const event of parseOllamaStream(stream)) {
        if (controller.signal.aborted) break;
        if (event.type === "content") {
          const data = event.data as { content: string };
          fullResponse += data.content;
          setResponse(fullResponse);
        } else if (event.type === "tool_calls") {
          const data = event.data as {
            tool_calls: Array<{ name: string; arguments: Record<string, unknown> }>;
          };
          for (const tc of data.tool_calls) {
            toolDetails.push(tc);
          }
          setToolCalls([...toolDetails]);
        } else if (event.type === "error") {
          const data = event.data as { message?: string };
          throw new Error(data.message || "Ollama returned no response or tool call");
        }
      }

      if (fullResponse) {
        setHistory((prev) => [
          {
            prompt,
            response: fullResponse,
            model: selectedModel,
            toolCalls: toolDetails.length,
            timestamp: new Date(),
          },
          ...prev.slice(0, 19),
        ]);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("Generation cancelled");
      } else {
        setError(e instanceof Error ? e.message : "Failed to generate response");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${(bytes / 1e3).toFixed(0)} KB`;
  };

  const saveTool = (tool: Tool) => {
    setTools((prev) => {
      const existing = prev.find((t) => t.id === tool.id);
      if (existing) return prev.map((t) => (t.id === tool.id ? tool : t));
      return [...prev, tool];
    });
    setEnabledTools((prev) => new Set([...prev, tool.id]));
    setShowToolEditor(false);
    setEditingTool(null);
    setToolJsonValid(true);
  };

  const selectedModelData = models.find((m) => m.name === selectedModel);

  return (
    <div className={DS.page}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Brain size={20} className="text-primary" />
          </div>
          <div>
            <h1 className={DS.pageTitle}>AI Tools</h1>
            <p className={DS.pageSubtitle}>
              Generate creative ideas using local AI models with tool support.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ollamaConnected ? (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Wifi size={12} /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <WifiOff size={12} /> Disconnected
            </span>
          )}
        </div>
      </div>

      <div className={DS.gridChat}>
        {/* Main Chat Area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Model Selection */}
          <div className={DS.card}>
            <label className={DS.textSmMedium + " block mb-2"}>Model</label>
            {models.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={DS.select + " flex-1"}
                    onClick={loadModels}
                  >
                    {models.map((m) => {
                      const bench = benchmarks[m.name];
                      const score = bench?.validation?.score ?? m.benchmark?.score ?? null;
                      const latency = bench?.latency_ms ?? m.benchmark?.latency_ms ?? null;
                      const success = bench?.success ?? m.benchmark?.success ?? null;
                      let badge = "";
                      if (score !== null && score >= 0) {
                        const s = Math.round(score);
                        const ok = success === false ? "✗" : s >= 70 ? "✓" : s >= 40 ? "~" : "✗";
                        badge = ` [${ok} ${s}/100${latency ? ` ${(latency / 1000).toFixed(1)}s` : ""}]`;
                      } else if (score === null) {
                        badge = " [—]";
                      }
                      const isBest = models[0]?.name === m.name && score !== null && score >= 60;
                      return (
                        <option key={m.name} value={m.name}>
                          {m.name} ({formatSize(m.size)}){m.verified ? " ✅" : " ⚠️"}{m.supportsTools ? " 🔧" : ""}
                          {m.supportsVision ? " 👁" : ""}{badge}
                          {isBest ? " ★ Best" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    onClick={handleRunBenchmark}
                    disabled={benchLoading}
                    className="ml-2 px-2 py-1 text-xs rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/20 disabled:opacity-50 flex items-center gap-1"
                    title="Benchmark all models"
                  >
                    {benchLoading ? (
                      <span className="w-3 h-3 border border-amber-300 border-t-transparent rounded-full animate-spin inline-block" />
                    ) : (
                      "⚡"
                    )}{" "}
                    {benchLoading ? "…" : "Benchmark"}
                  </button>
                </div>
                {selectedModelData && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {selectedModelData.verified && (
                      <span className={DS.badgeGreen + " flex items-center gap-1"}>
                        <Shield size={10} /> Verified Working
                      </span>
                    )}
                    {!selectedModelData.verified && selectedModelData.broken_reason && (
                      <span className={DS.badgeRed + " flex items-center gap-1"}>
                        <AlertCircle size={10} /> {selectedModelData.broken_reason}
                      </span>
                    )}
                    {selectedModelData.supportsTools && (
                      <span className={DS.badgeGreen + " flex items-center gap-1"}>
                        <Wrench size={10} /> Tools
                      </span>
                    )}
                    {selectedModelData.supportsVision && (
                      <span className={DS.badgeBlue + " flex items-center gap-1"}>
                        <Eye size={10} /> Vision
                      </span>
                    )}
                    {selectedModelData.supportsThinking && (
                      <span className={DS.badgePurple + " flex items-center gap-1"}>
                        <Cpu size={10} /> Thinking
                      </span>
                    )}
                    {selectedModelData.verified_features?.includes("blender") && (
                      <span className="bg-amber-900/50 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                        <Code2 size={10} /> Blender Scripts
                      </span>
                    )}
                    {selectedModelData.verified_features?.includes("visualizer") && (
                      <span className="bg-purple-900/50 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                        <Palette size={10} /> Visualizer
                      </span>
                    )}
                    {selectedModelData.performance?.tokens_per_sec && (
                      <span className="bg-gray-800 border border-gray-700 px-2 py-0.5 rounded text-xs">
                        ⚡ {selectedModelData.performance.tokens_per_sec} tok/s
                      </span>
                    )}
                    {selectedModelData.performance?.vision_latency_sec && (
                      <span className="bg-gray-800 border border-gray-700 px-2 py-0.5 rounded text-xs">
                        👁 ~{selectedModelData.performance.vision_latency_sec}s vision
                      </span>
                    )}
                    {selectedModelData.verification_notes && (
                      <span className="bg-gray-800 border border-gray-700 px-2 py-0.5 rounded text-xs" title={selectedModelData.verification_notes}>
                        ℹ️
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className={DS.textXs}>
                No verified Ollama models available. Start Ollama to use this feature.
              </p>
            )}
          </div>

          {/* Prompt Input */}
          <div className={DS.card}>
            <label className={DS.textSmMedium + " block mb-2"}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className={DS.textarea}
              rows={4}
              placeholder="Ask for video concepts, scene descriptions, color palettes..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleGenerate();
                }
              }}
            />
            <div className={DS.flexBetween + " mt-2"}>
              <span className={DS.textXs}>Ctrl+Enter to send</span>
              <div className="flex gap-2">
                {generating && (
                  <button onClick={handleCancel} className={DS.btnSecondary}>
                    <X size={16} /> Cancel
                  </button>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={generating || !prompt.trim() || !selectedModel}
                  className={DS.btnPrimary + " " + DS.btnDisabled}
                >
                  {generating ? <Loader2 size={16} className={DS.loading} /> : <Send size={16} />}
                  {generating ? "Generating..." : "Generate"}
                </button>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className={DS.cardError}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Response */}
          {response && (
            <div className={DS.card}>
              <div className={DS.flexCenter + " mb-3"}>
                <CheckCircle size={16} className={DS.accentGreen} />
                <span className={DS.textBold}>Response</span>
                <span className={DS.textXs}>({selectedModel})</span>
              </div>
              <div className={DS.textSm + " whitespace-pre-wrap"}>{response}</div>
            </div>
          )}

          {/* Visualization Canvas */}
          {vizConfig && (
            <div className={DS.card}>
              <div className={DS.flexCenter + " mb-3"}>
                <Palette size={16} className="text-purple-400" />
                <span className={DS.textBold}>Visualization</span>
                <span className={DS.textXs}>({vizConfig.style})</span>
              </div>
              <VisualizationCanvas config={vizConfig} width={400} height={300} />
            </div>
          )}

          {/* Tool Calls */}
          {toolCalls.length > 0 && (
            <div className={DS.card}>
              <div className={DS.flexCenter + " mb-3"}>
                <Wrench size={16} className="text-amber-400" />
                <span className={DS.textBold}>Tool Calls</span>
                <span className={DS.textXs}>({toolCalls.length})</span>
              </div>
              <div className="space-y-2">
                {toolCalls.map((tc, i) => (
                  <div key={i} className="p-3 bg-gray-700/50 rounded-lg">
                    <div className={DS.flexCenter + " mb-1"}>
                      <Zap size={12} className="text-amber-400" />
                      <span className="text-amber-400 text-sm font-medium">{tc.name}</span>
                    </div>
                    {tc.result && <p className="text-xs text-green-400 mt-1">{tc.result}</p>}
                    <pre className={DS.mono + " overflow-auto mt-1"}>
                      {JSON.stringify(tc.arguments, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <Sidebar
          tools={tools}
          enabledTools={enabledTools}
          setEnabledTools={setEnabledTools}
          setEditingTool={setEditingTool}
          setToolJsonValid={setToolJsonValid}
          setShowToolEditor={setShowToolEditor}
          setTools={setTools}
          setPrompt={setPrompt}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          models={models}
          history={history}
          setResponse={setResponse}
        />
      </div>

      {/* Tool Editor Modal */}
      {showToolEditor && editingTool && (
        <ToolEditor
          editingTool={editingTool}
          setEditingTool={setEditingTool}
          toolJsonValid={toolJsonValid}
          setToolJsonValid={setToolJsonValid}
          onSave={saveTool}
          onClose={() => {
            setShowToolEditor(false);
            setEditingTool(null);
          }}
        />
      )}
    </div>
  );
}
