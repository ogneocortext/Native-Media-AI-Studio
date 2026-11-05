import { useState, useEffect, useRef } from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  Wrench,
  Shield,
  Eye,
  Brain,
  AlertCircle,
  Wifi,
  WifiOff,
  Music,
  Download,
  Zap,
  GitBranch,
  Activity,
} from "lucide-react";
import { Card } from "../../components/common";
import { AudioTransport } from "../../components/audio";
import {
  getApiBase,
  getUnifiedModels,
  getTaskModelRoutes,
  ollamaChatStream,
  ollamaEngineStatus,
  parseOllamaStream,
  uploadAudioFile,
  getBenchmarkResults,
  getAtomicChatStatus,
  runBenchmark,
  runCodingBenchmark,
  type ChatMessage,
  type ToolDefinition,
  type OllamaBenchmarkResult,
  type UnifiedModel,
} from "../../services/api";
import { getOutputUrl } from "../../utils/url";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { selectModel } from "../../services/api/agent-loop";

/** Source badge configs keyed by engine source. */
const SOURCE_BADGES: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  ollama: { label: "Ollama", icon: Activity, color: "text-emerald-400" },
  "atomic-chat": { label: "Atomic Chat", icon: Zap, color: "text-pink-400" },
};

export function OllamaChat() {
  const { refresh: refreshLibrary } = useAudioLibrary();
  const [models, setModels] = useState<UnifiedModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [benchmarks, setBenchmarks] = useState<Record<string, OllamaBenchmarkResult>>({});
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [codingBenchmarkRunning, setCodingBenchmarkRunning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [engineStatus, setEngineStatus] = useState<"online" | "offline" | "checking">("checking");
  const [atomicStatus, setAtomicStatus] = useState<"online" | "offline" | "checking">("checking");
  const [taskRoutes, setTaskRoutes] = useState<{ routes: Record<string, { engine: string; model: string; reason: string }>; excluded_from_chat: string[] } | null>(null);
  const [extractRunning, setExtractRunning] = useState(false);
  /** Real-time stream progress tracking */
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "thinking" | "executing_tool" | "streaming_response" | "done">("idle");
  const [toolStep, setToolStep] = useState(0);
  const [totalToolSteps, setTotalToolSteps] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<{ time: string; event: string; detail: string }[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<{
    filename: string;
    relative_path: string;
    stored_path: string;
    size_bytes: number;
    message: string;
    converted: boolean | undefined;
    source_filename: string | null | undefined;
    lossless: boolean | undefined;
  } | null>(null);

  async function checkEngineStatus() {
    try {
      const status = await ollamaEngineStatus();
      setEngineStatus(status.online ? "online" : "offline");
    } catch {
      setEngineStatus("offline");
    }
  }

  async function checkAtomicStatus() {
    try {
      const status = await getAtomicChatStatus();
      setAtomicStatus(status.reachable ? "online" : "offline");
    } catch {
      setAtomicStatus("offline");
    }
  }

  const handleVideoUpload = async (file: File) => {
    setExtractRunning(true);
    setExtractError(null);
    setExtractResult(null);
    try {
      const res = await uploadAudioFile(file);
      void refreshLibrary();
      setExtractResult({
        filename: res.filename,
        relative_path: res.relative_path,
        stored_path: res.stored_path,
        size_bytes: res.size_bytes,
        message: res.message,
        converted: res.converted,
        source_filename: res.source_filename,
        lossless: res.lossless,
      });
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtractRunning(false);
    }
  };

  const logStreamEvent = (event: string, detail: string) => {
    const time = new Date().toLocaleTimeString();
    setStreamEvents((prev) => [...prev, { time, event, detail }]);
  };

  const handleRunBenchmarks = async () => {
    setBenchmarkRunning(true);
    try {
      await runBenchmark();
      const res = await getBenchmarkResults();
      setBenchmarks(res.results);
      logStreamEvent("benchmark", "Ollama benchmarks completed and refreshed");
    } catch (e) {
      logStreamEvent("benchmark-error", e instanceof Error ? e.message : String(e));
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const handleRunCodingBenchmarks = async () => {
    setCodingBenchmarkRunning(true);
    try {
      await runCodingBenchmark();
      const res = await getBenchmarkResults();
      setBenchmarks(res.results);
      logStreamEvent("benchmark", "Coding benchmarks completed and refreshed");
    } catch (e) {
      logStreamEvent("benchmark-error", e instanceof Error ? e.message : String(e));
    } finally {
      setCodingBenchmarkRunning(false);
    }
  };

  const handleAutoSelectModel = async (taskType: "coding" | "vision" | "chat" | "default") => {
    try {
      const model = await selectModel(taskType);
      setSelectedModel(model);
      logStreamEvent("auto-select", `Selected ${model} for task "${taskType}"`);
    } catch (e) {
      logStreamEvent("auto-select-error", e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    async function loadModels() {
      // Detect which inference engines are running before allowing messages.
      await Promise.all([checkEngineStatus(), checkAtomicStatus()]);
      try {
        const [data, toolsData, routes] = await Promise.all([
          getUnifiedModels(true),
          fetch(`${getApiBase()}/api/integrations/ollama/tools`, {
            signal: AbortSignal.timeout(10000),
          })
            .then(async (r) => r.json())
            .catch(() => ({ tools: [] })),
          getTaskModelRoutes().catch(() => null),
        ]);

        if (routes) setTaskRoutes(routes);

        // Fetch benchmarks in parallel
        let benchMap: Record<string, OllamaBenchmarkResult> = {};
        try {
          const benchData = await getBenchmarkResults();
          benchMap = benchData.results || {};
          setBenchmarks(benchMap);
        } catch {
          /* no benchmarks yet */
        }

        // Filter: show chat-eligible models for chat
        const chatEligible = data.filter((m) => m.chat_eligible);

        // Sort chat-eligible by benchmark score desc, then latency asc
        const sorted = [...chatEligible].sort((a, b) => {
          if (a.verified !== b.verified) return a.verified ? -1 : 1;
          const sa = a.benchmark?.score ?? benchMap[a.name].validation.score ?? -1;
          const sb = b.benchmark?.score ?? benchMap[b.name].validation.score ?? -1;
          if (sa !== sb) return sb - sa;
          const la = a.benchmark?.latency_ms ?? benchMap[a.name].latency_ms ?? 999999;
          const lb = b.benchmark?.latency_ms ?? benchMap[b.name].latency_ms ?? 999999;
          return la - lb;
        });

        setModels(sorted);
        setTools(toolsData.tools ?? []);
        const preferred = ["llama3.1:8b", "gemma4:e2b-it-qat", "qwen3.5:4b", "qwen3-vl:2b"];
        const preferredModel = preferred.find((name) => sorted.some((model) => model.name === name));
        if (preferredModel) setSelectedModel(preferredModel);
        else if (sorted.length > 0) setSelectedModel(sorted[0].name);
      } catch {
        // ignore
      } finally {
        setModelsLoading(false);
      }
    }
    void loadModels();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildHistory = (): ChatMessage[] => {
    return messages.filter((m, i) => !(i === messages.length - 1 && m.role === "user"));
  };

  const handleSend = async () => {
    const anyEngineOnline = engineStatus === "online" || atomicStatus === "online";
    if (!anyEngineOnline) return;
    if (engineStatus === "checking" || atomicStatus === "checking") return;
    if (!input.trim() || !selectedModel || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreamStatus("idle");
    setToolStep(0);
    setTotalToolSteps(0);
    setCurrentTool(null);
    setStreamEvents([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const history = buildHistory();
      const apiMessages = history.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_name ? { tool_call_id: m.tool_name } : {}),
      }));

      const stream = await ollamaChatStream(input.trim(), selectedModel, {
        history: apiMessages,
        tools: toolsEnabled ? tools : [],
        think: false,
        maxToolCalls: 5,
      });

      let assistantContent = "";
      let toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "",
        timestamp: new Date(),
        tool_calls: [],
      };

      setMessages((prev) => [...prev, assistantMsg]);

      logStreamEvent("connecting", "Opening stream to model…");
      setStreamStatus("connecting");

      for await (const chunk of parseOllamaStream(stream)) {
        if (controller.signal.aborted) break;

        switch (chunk.type) {
          case "connected": {
            setStreamStatus("thinking");
            logStreamEvent("connected", "Stream connected, model is thinking…");
            break;
          }
          case "content": {
            const text = typeof chunk.data === "string" ? chunk.data : "";
            assistantContent += text;
            if (streamStatus !== "streaming_response") {
              setStreamStatus("streaming_response");
              logStreamEvent("streaming", "Model is generating response…");
            }
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant") {
                last.content = assistantContent;
              }
              return next;
            });
            break;
          }
          case "tool_calls": {
            const calls =
              (
                chunk.data as {
                  tool_calls?: { name: string; arguments: Record<string, unknown> }[];
                }
              ).tool_calls ?? [];
            toolCalls = calls;
            if (calls.length > 0) {
              setStreamStatus("executing_tool");
              setTotalToolSteps(calls.length);
              setToolStep(0);
              setCurrentTool(calls[0].name);
              logStreamEvent("tool_calls", `${calls.length} tool call(s) scheduled: ${calls.map((c) => c.name).join(", ")}`);
            }
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant") {
                last.tool_calls = calls;
              }
              return next;
            });
            break;
          }
          case "tool_result": {
            setToolStep((prev) => prev + 1);
            setCurrentTool((prev) => (prev ? null : prev));
            logStreamEvent("tool_result", "Tool executed, continuing…");
            if (toolStep + 1 < totalToolSteps) {
              const nextCalls = toolCalls.slice(toolStep + 1);
              if (nextCalls.length > 0) {
                setCurrentTool(nextCalls[0].name);
                logStreamEvent("executing_tool", `Running tool: ${nextCalls[0].name}`);
              }
            }
            break;
          }
          case "done":
            setStreamStatus("done");
            logStreamEvent("done", "Stream complete.");
            break;
          case "error":
            assistantContent += `\n[error: ${typeof chunk.data === "string" ? chunk.data : JSON.stringify(chunk.data)}]`;
            setStreamStatus("done");
            logStreamEvent("error", typeof chunk.data === "string" ? chunk.data : JSON.stringify(chunk.data));
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant") {
                last.content = assistantContent;
              }
              return next;
            });
            break;
        }
      }

      if (!assistantContent && toolCalls.length === 0) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.role === "assistant") {
            last.content = assistantContent || "(empty response)";
          }
          return next;
        });
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "failed to get response."}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      setStreamStatus("idle");
      abortRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const selectedModelMeta = models.find((m) => m.name === selectedModel);
  const selectedSource = selectedModelMeta?.source;
  const sourceCfg = SOURCE_BADGES[selectedSource ?? "ollama"];

  function anyEngineOnline(): boolean {
    return engineStatus === "online" || atomicStatus === "online";
  }

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-0px)] max-h-screen">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            AI Chat
            <span className="flex items-center gap-2">
              {engineStatus === "checking" || atomicStatus === "checking" ? (
                <Wifi size={12} className="mr-1.5 animate-pulse" />
              ) : engineStatus === "online" ? (
                <Wifi size={12} className="mr-1.5" />
              ) : (
                <WifiOff size={12} className="mr-1.5" />
              )}
              {engineStatus === "checking" ? "Checking engine…" : engineStatus === "online" ? "Ollama online" : "Ollama offline"}
              {atomicStatus === "online" ? (
                <span className="ml-1 inline-flex items-center gap-1 bg-pink-900/30 text-pink-400 border border-pink-900/50 px-2 py-0.5 rounded text-xs font-medium">
                  <Zap size={10} className="mr-0.5" /> Atomic Chat online
                </span>
              ) : atomicStatus === "offline" ? (
                <span className="ml-1 inline-flex items-center gap-1 bg-red-900/30 text-red-400 border border-red-900/50 px-2 py-0.5 rounded text-xs font-medium">
                  <WifiOff size={10} className="mr-0.5" /> Atomic Chat offline
                </span>
              ) : null}
            </span>
          </h1>
          <p className="text-sm text-muted mt-1">
            Chat with local LLM models via Ollama + Atomic Chat (streaming + tools)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={toolsEnabled}
              onChange={(e) => setToolsEnabled(e.target.checked)}
              className="rounded border-white/20 bg-white/5"
            />
            <Wrench size={14} />
            Tools ({tools.length})
          </label>
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={modelsLoading}
              className="appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-16 text-sm text-white focus:outline-none focus:border-violet-500"
            >
              {modelsLoading ? (
                <option>Loading models…</option>
              ) : models.length === 0 ? (
                <option>No chat-eligible models found</option>
              ) : (
                models.map((m) => {
                  const bench = benchmarks[m.name];
                  const score = bench.validation.score ?? m.benchmark?.score ?? null;
                  const latency = bench.latency_ms ?? m.benchmark?.latency_ms ?? null;
                  const success = bench.success ?? m.benchmark?.success ?? null;
                  let badge = "";
                  if (score !== null && score >= 0) {
                    const s = Math.round(score);
                    const ok = success === false ? "FAIL" : s >= 70 ? "OK" : s >= 40 ? "WARN" : "FAIL";
                    badge = ` [${ok} ${s}/100${latency ? ` ${(latency / 1000).toFixed(1)}s` : ""}]`;
                  } else if (score === null) {
                    badge = " [—]";
                  }
                  const isBest = models[0]?.name === m.name && score !== null && score >= 60;
                  const sourceCfg = SOURCE_BADGES[m.source];
                  return (
                    <option key={m.name} value={m.name}>
                      {m.name} [{sourceCfg.label}]{m.verified ? " [verified]" : " [unverified]"}{badge}
                      {isBest ? " [best]" : ""}
                    </option>
                  );
                })
              )}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
              {(() => {
                const m = models.find((x) => x.name === selectedModel);
                if (!m) return <ChevronDown size={14} className="text-muted" />;
                const badges: React.ReactNode[] = [];
                if (m.verified) badges.push(<span key="v" className="text-green-400" title="Verified Working"><Shield size={10} /></span>);
                if (!m.verified && m.broken_reason) badges.push(<span key="b" className="text-red-400" title={m.broken_reason}><AlertCircle size={10} /></span>);
                if (m.supports_tools) badges.push(<span key="t" className="text-amber-400" title="Tools"><Wrench size={10} /></span>);
                if (m.supports_vision) badges.push(<span key="vi" className="text-blue-400" title="Vision"><Eye size={10} /></span>);
                if (m.supports_thinking) badges.push(<span key="th" className="text-purple-400" title="Thinking"><Brain size={10} /></span>);
                if (m.supports_embedding) badges.push(<span key="em" className="text-cyan-400 flex items-center gap-1" title="Embeddings"><Activity size={10} /> Embeddings</span>);
                if (m.supports_rerank) badges.push(<span key="rr" className="text-violet-400 flex items-center gap-1" title="Reranker"><GitBranch size={10} /> Reranker</span>);
                const vram = m.vram_required;
                if (vram) {
                  const gb = (vram / 1024).toFixed(1);
                  const isHigh = vram > 7000;
                  badges.push(
                    <span
                      key="vram"
                      className={`text-[10px] ${isHigh ? "text-amber-400" : "text-emerald-400"}`}
                    >
                      {gb}GB
                    </span>
                  );
                }
                badges.push(
                  <span key="src" className={`text-[10px] ${sourceCfg.color}`} title={SOURCE_BADGES[m.source || "ollama"].label}>
                    {m.source === "atomic-chat" ? <Zap size={10} /> : <Activity size={10} />}
                  </span>
                );
                badges.push(<ChevronDown key="d" size={14} className="text-muted" />);
                return <>{badges}</>;
              })()}
            </div>
          </div>
        </div>

        {/* Benchmark actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunBenchmarks}
            disabled={benchmarkRunning || modelsLoading}
            className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50"
            title={benchmarkRunning ? "Running benchmarks…" : "Run Ollama benchmarks"}
          >
            {benchmarkRunning ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          </button>
          <button
            onClick={handleRunCodingBenchmarks}
            disabled={codingBenchmarkRunning || modelsLoading}
            className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50"
            title={codingBenchmarkRunning ? "Running coding benchmarks…" : "Run coding benchmarks"}
          >
            {codingBenchmarkRunning ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          </button>
        </div>

        {/* Task-specific model quick-switch */}
        {taskRoutes && (
          <div className="flex items-center gap-1 flex-wrap">
            {Object.entries(taskRoutes.routes).map(([task, route]) => (
              <button
                key={task}
                onClick={() => handleAutoSelectModel(task)}
                disabled={modelsLoading}
                className="px-2 py-1 text-xs rounded bg-purple-900/20 border border-purple-900/50 hover:bg-purple-900/40 disabled:opacity-50 text-purple-300"
                title={`Switch to ${route.model} for ${task} (${route.reason})`}
              >
                {task}: {route.model.split(":")[0]}
              </button>
            ))}
          </div>
        )}

        {/* Auto-select for coding/vision/chat */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => handleAutoSelectModel("coding")}
            disabled={modelsLoading}
            className="px-2 py-1 text-xs rounded bg-blue-900/20 border border-blue-900/50 hover:bg-blue-900/40 disabled:opacity-50 text-blue-300"
            title="Auto-select best coding model"
          >
            Code
          </button>
          <button
            onClick={() => handleAutoSelectModel("vision")}
            disabled={modelsLoading}
            className="px-2 py-1 text-xs rounded bg-emerald-900/20 border border-emerald-900/50 hover:bg-emerald-900/40 disabled:opacity-50 text-emerald-300"
            title="Auto-select best vision model"
          >
            Vision
          </button>
          <button
            onClick={() => handleAutoSelectModel("chat")}
            disabled={modelsLoading}
            className="px-2 py-1 text-xs rounded bg-amber-900/20 border border-amber-900/50 hover:bg-amber-900/40 disabled:opacity-50 text-amber-300"
            title="Auto-select best chat model"
          >
            Chat
          </button>
        </div>
      </div>

      {/* Model routing info */}
      {taskRoutes && (
        <div className="mb-4 p-3 rounded-lg bg-white/5 border border-white/10 flex items-start gap-3">
          <Brain size={16} className="text-purple-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-purple-300">Task-specific model routing</p>
            <div className="text-xs text-muted flex flex-wrap gap-2">
              {Object.entries(taskRoutes.routes).map(([task, route]) => (
                <span key={task} className="bg-purple-900/20 px-2 py-1 rounded border border-purple-900/50 text-xs text-purple-300">
                  {task}: {route.model}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {engineStatus === "offline" && atomicStatus === "offline" && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-900/30 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-300">No inference engine online</p>
            <p className="text-xs text-red-200/70">
              Neither Ollama nor Atomic Chat is running, so messages cannot be sent. Start an engine and
              refresh this page, or check the <a href="/system/health" className="text-red-300 underline">Health page</a> for service status.
            </p>
          </div>
        </div>
      )}
      {engineStatus === "offline" && atomicStatus === "online" && (
        <div className="mb-4 p-3 rounded-lg bg-amber-900/20 border border-amber-900/30 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Ollama offline — Atomic Chat available</p>
            <p className="text-xs text-amber-200/70">
              Ollama is not running but Atomic Chat is online. Select an Atomic Chat model from the dropdown above.
            </p>
          </div>
        </div>
      )}
      {engineStatus === "online" && atomicStatus === "offline" && (
        <div className="mb-4 p-3 rounded-lg bg-amber-900/20 border border-amber-900/30 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Atomic Chat offline — Ollama available</p>
            <p className="text-xs text-amber-200/70">
              Atomic Chat is not running but Ollama is online. Ollama models are available for chat.
            </p>
          </div>
        </div>
      )}

      {/* Video → Audio upload */}
      <Card className="mb-4 shrink-0">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Music size={16} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Video → Audio</h3>
          </div>
          <p className="text-xs text-muted mb-3">
            Upload a video file to extract its audio track. The result is saved to your audio library
            and can be played below or analyzed on the Audio Analysis page.
          </p>

          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white hover:bg-white/10 transition-colors">
              <span>Choose video…</span>
              <input
                type="file"
                accept=".mp4,.mov,.mkv,.webm,.m4v,.avi"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleVideoUpload(file);
                  e.target.value = "";
                }}
                className="sr-only"
                aria-label="Select a video file to extract audio"
              />
            </label>

            {extractRunning && (
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-muted" />
                <span className="text-xs text-muted">Extracting audio…</span>
              </div>
            )}

            {extractError && (
              <p className="text-xs text-red-400 flex items-center gap-1" role="alert">
                <AlertCircle size={12} /> {extractError}
              </p>
            )}

            {extractResult && (
              <div className="space-y-2 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
                  {extractResult.converted ? "Converted" : "Uploaded"} · {extractResult.message}
                </div>
                <div className="flex items-center justify-between gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/5">
                  <p className="text-xs text-white font-mono truncate" title={extractResult.filename}>
                    {extractResult.filename}
                  </p>
                  <a
                    href={getOutputUrl(extractResult.relative_path)}
                    download
                    className="p-1.5 hover:bg-white/10 rounded-lg text-muted hover:text-white shrink-0"
                    title="Download audio file"
                  >
                    <Download size={13} />
                  </a>
                </div>
                <AudioTransport
                  src={getOutputUrl(extractResult.relative_path)}
                  className="w-full"
                  ariaLabel={`Play ${extractResult.filename}`}
                />
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Real-time stream progress banner */}
      {streamStatus !== "idle" && (
        <Card className="mb-4 shrink-0">
          <div className="p-3">
            <div className="flex items-center gap-2 mb-2">
              {streamStatus === "connecting" && (
                <Loader2 size={14} className="animate-spin text-emerald-400" />
              )}
              {streamStatus === "thinking" && (
                <Brain size={14} className="text-purple-400 animate-pulse" />
              )}
              {streamStatus === "executing_tool" && (
                <Wrench size={14} className="text-amber-400 animate-pulse" />
              )}
              {streamStatus === "streaming_response" && (
                <Activity size={14} className="text-blue-400 animate-pulse" />
              )}
              {streamStatus === "done" && (
                <Shield size={14} className="text-emerald-400" />
              )}
              <span className="text-xs font-semibold text-white uppercase tracking-wider">
                {streamStatus === "connecting" ? "Connecting…"
                : streamStatus === "thinking" ? "Model is thinking…"
                : streamStatus === "executing_tool" ? `Executing tool${currentTool ? `: ${currentTool}` : ""}${totalToolSteps > 0 ? ` (step ${toolStep + 1}/${totalToolSteps})` : ""}`
                : streamStatus === "streaming_response" ? "Streaming response…"
                : "Complete"}
              </span>
            </div>
            {streamEvents.length > 0 && (
              <details className="mt-2 text-xs" open>
                <summary className="cursor-pointer text-muted hover:text-white mb-1">Processing details</summary>
                <div className="bg-black/20 rounded-lg p-2 font-mono text-xs overflow-x-auto border border-white/5">
                  {streamEvents.map((e, i) => (
                    <div key={i} className="flex gap-2 mb-1">
                      <span className="text-muted/60 w-12">{e.time}</span>
                      <span className="text-purple-300">{e.event}</span>
                      <span className="text-gray-300/80">{e.detail}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </Card>
      )}

      {/* Chat Messages */}
      <Card className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <Bot size={40} className="text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-muted">Ask anything about your music video project</p>
                <p className="text-xs text-muted mt-1">
                  Powered by {selectedModel || "local model"} ({selectedSource ?? "ollama"}) running locally
                </p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
                  <Bot size={16} className="text-white" />
                </div>
              )}
              <div
                className={`max-w-[70%] rounded-xl px-4 py-3 text-sm ${msg.role === "user" ? "bg-violet-600 text-white" : "bg-white/5 text-gray-200 border border-white/5"}`}
              >
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {msg.tool_calls.map((tc, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-md bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200"
                      >
                        <Wrench size={12} />
                        {tc.name}
                      </span>
                    ))}
                  </div>
                )}
                {msg.tool_name && (
                  <div className="mb-1 text-xs text-muted">tool result: {msg.tool_name}</div>
                )}
                {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                <p className="text-[10px] text-muted mt-1">
                  {msg.timestamp?.toLocaleTimeString() ?? ""}
                </p>
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                  <User size={16} className="text-white" />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
                <Bot size={16} className="text-white" />
              </div>
              <div className="bg-white/5 border border-white/5 rounded-xl px-4 py-3">
                <Loader2 size={16} className="animate-spin text-muted" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={selectedModel ? `Message ${selectedModel}…` : "Select a model first…"}
              disabled={!selectedModel || loading || !anyEngineOnline()}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-muted focus:outline-none focus:border-violet-500 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !selectedModel || loading || !anyEngineOnline()}
              className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
