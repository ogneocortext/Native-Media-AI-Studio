import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import {
  Brain,
  Send,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Zap,
  Wifi,
  WifiOff,
  Palette,
  MessageCircle,
  User,
  Bot,
  StopCircle,
  Copy,
  RotateCw,
  ChevronRight,
} from "lucide-react";
import { ToolExecutionCard } from "../../components/ToolExecutionCard";
import {
  getOllamaModels,
  ollamaChatStream,
  parseOllamaStream,
  getBenchmarkResults,
  getHardwareBenchmarks,
  type OllamaModel,
  type ToolDefinition,
  type OllamaBenchmarkResult,
  type HardwareBenchmarkSummary,
} from "../../services/api";
import { DS } from "../../styles/designSystem";
import { formatSize } from "../../utils/format";
import { VisualizationCanvas } from "./VisualizationCanvas";
import type { VisualizationConfig } from "./VisualizationCanvas";
import { Sidebar } from "./Sidebar";
import { ToolEditor } from "./ToolEditor";
import { DEFAULT_TOOLS, type Tool, type HistoryEntry } from "./types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  toolCalls?: number;
  timestamp: Date;
  thinking?: string;
  showThinking?: boolean;
  toolDetails?: {
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
    status: "calling" | "done";
  }[];
  vizConfig?: VisualizationConfig;
}

export function AIToolsPage() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_response, setResponse] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [tools, setTools] = useState<Tool[]>(DEFAULT_TOOLS);
  const [showToolEditor, setShowToolEditor] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [toolJsonValid, setToolJsonValid] = useState(true);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(
    new Set(DEFAULT_TOOLS.map((t) => t.id)),
  );
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const [benchmarks, setBenchmarks] = useState<Record<string, OllamaBenchmarkResult>>({});
  const [hwSummary, setHwSummary] = useState<Record<string, HardwareBenchmarkSummary>>({});
  const abortRef = useRef<AbortController | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadModels(true);
  }, []);

  // Keep `response` in sync with the last assistant message for Sidebar compatibility
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    setResponse(lastAssistant?.content ?? "");
  }, [messages]);

  const loadModels = async (verifiedOnly: boolean) => {
    try {
      const modelList = await getOllamaModels(verifiedOnly);
      const enhanced = modelList.map((m) => ({
        ...m,
        supportsTools: m.capabilities?.includes("tools") ?? false,
        supportsVision: m.capabilities?.includes("vision") ?? false,
        supportsThinking: m.capabilities?.includes("thinking") ?? false,
      }));

      let benchMap: Record<string, OllamaBenchmarkResult> = {};
      let hwMap: Record<string, HardwareBenchmarkSummary> = {};
      const [sceneRes, hwRes] = await Promise.allSettled([
        getBenchmarkResults(),
        getHardwareBenchmarks(),
      ]);
      if (sceneRes.status === "fulfilled") {
        benchMap = sceneRes.value.results || {};
        setBenchmarks(benchMap);
      }
      if (hwRes.status === "fulfilled") {
        hwMap = hwRes.value;
        setHwSummary(hwMap);
      }

      const sorted = [...enhanced].sort((a, b) => {
        if (a.verified !== b.verified) return a.verified ? -1 : 1;
        const sa = a.benchmark?.score ?? benchMap[a.name]?.validation?.score ?? -1;
        const sb = b.benchmark?.score ?? benchMap[b.name]?.validation?.score ?? -1;
        if (sa !== sb) return sb - sa;
        const la =
          hwMap[a.name]?.median_latency_ms ||
          a.benchmark?.latency_ms ||
          benchMap[a.name]?.latency_ms ||
          999999;
        const lb =
          hwMap[b.name]?.median_latency_ms ||
          b.benchmark?.latency_ms ||
          benchMap[b.name]?.latency_ms ||
          999999;
        return la - lb;
      });
      setModels(sorted);
      setOllamaConnected(true);
      if (sorted.length > 0 && !selectedModel) {
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

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!selectedModel) return;
    setGenerating(true);
    setError(null);

    const supportsTools = models.find((m) => m.name === selectedModel)?.supportsTools;
    const activeTools = supportsTools ? convertToToolDefinitions() : [];

    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setPrompt("");

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      model: selectedModel,
      timestamp: new Date(),
      showThinking: false,
      toolDetails: [],
    };
    setMessages((prev) => [...prev, assistantMessage]);
    const assistantId = assistantMessage.id;

    try {
      const stream = await ollamaChatStream(
        prompt.trim(),
        selectedModel,
        {
          tools: activeTools,
          think: true,
          maxToolCalls: 5,
        },
        controller.signal,
      );

      let fullResponse = "";
      let fullThinking = "";
      const toolDetails: {
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
        status: "calling" | "done";
      }[] = [];

      for await (const event of parseOllamaStream(stream)) {
        if (controller.signal.aborted) break;
        if (event.type === "content") {
          const data = event.data as { content: string; thinking?: string };
          fullResponse += data.content;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: fullResponse } : m,
            ),
          );
          if (data.thinking) {
            fullThinking += data.thinking;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, thinking: fullThinking } : m,
              ),
            );
          }
        } else if (event.type === "tool_calls") {
          const data = event.data as {
            tool_calls: { name: string; arguments: Record<string, unknown> }[];
          };
          for (const tc of data.tool_calls) {
            toolDetails.push({ ...tc, status: "calling" });
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, toolDetails: [...toolDetails] } : m,
            ),
          );
        } else if (event.type === "tool_result") {
          const data = event.data as { name: string; result: string };
          const target = toolDetails.find(
            (t) => t.name === data.name && t.status === "calling",
          );
          if (target) {
            target.result = data.result;
            target.status = "done";
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, toolDetails: [...toolDetails] } : m,
            ),
          );
          if (data.name === "generate_visualization") {
            try {
              const cfg = JSON.parse(data.result) as VisualizationConfig;
              if (cfg?.style && cfg.colors) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, vizConfig: cfg } : m,
                  ),
                );
              }
            } catch {
              /* result was not a visualization config */
            }
          }
        } else if (event.type === "error") {
          const data = event.data as { message?: string };
          throw new Error(data.message || "Ollama returned no response");
        }
      }

      if (fullResponse) {
        setHistory((prev) => [
          {
            prompt: userMessage.content,
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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleRegenerate = (message: Message) => {
    if (message.role !== "assistant") return;
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx === -1) return;
    const userMsg = messages[idx - 1];
    if (!userMsg || userMsg.role !== "user") return;
    setMessages((prev) => prev.slice(0, idx));
    setGenerating(true);
    const modelToUse = message.model || selectedModel || "";
    setSelectedModel(modelToUse);
    setPrompt(userMsg.content);
    handleGenerate();
  };

  const getModelCaps = (m: OllamaModel) =>
    [
      m.supportsTools ? "tools" : "",
      m.supportsVision ? "vision" : "",
      m.supportsThinking ? "thinking" : "",
    ].filter(Boolean);

  const getModelLatency = (m: OllamaModel) => {
    const latency =
      hwSummary[m.name]?.median_latency_ms ||
      benchmarks[m.name]?.latency_ms ||
      m.benchmark?.latency_ms ||
      null;
    return latency ? `${(latency / 1000).toFixed(1)}s` : null;
  };

  const getModelScore = (m: OllamaModel) => {
    const score =
      benchmarks[m.name]?.validation?.score ?? m.benchmark?.score ?? null;
    return score !== null && score >= 0 ? Math.round(score) : null;
  };

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
            <span className={"flex items-center gap-1 text-xs " + DS.accentGreen}>
              <Wifi size={12} /> Connected
            </span>
          ) : (
            <span className={"flex items-center gap-1 text-xs " + DS.accentRed}>
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
            <div className={DS.flexBetween + " mb-2"}>
              <label className={DS.textSmMedium}>Model</label>
              <button
                onClick={() => {
                  const next = !showAllModels;
                  setShowAllModels(next);
                  loadModels(!next);
                }}
                className="px-2 py-1 text-xs rounded bg-gray-700/50 hover:bg-gray-700 text-muted border border-gray-600 flex items-center gap-1"
                title={
                  showAllModels
                    ? "Show only verified models"
                    : "Show all models, including unverified ones"
                }
              >
                {showAllModels ? "Verified only" : "Show all"}
              </button>
            </div>
            {models.length > 0 ? (
              <div className="space-y-1">
                {models.map((m) => {
                  const score = getModelScore(m);
                  const latency = getModelLatency(m);
                  const caps = getModelCaps(m);
                  const isSelected = m.name === selectedModel;
                  const isBest =
                    models[0]?.name === m.name && score !== null && score >= 60;
                  const brokenReason = m.verified ? null : m.broken_reason;
                  return (
                    <button
                      key={m.name}
                      onClick={() => setSelectedModel(m.name)}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        isSelected
                          ? "bg-violet-500/10 border-violet-500/30"
                          : "bg-gray-700/30 border-gray-600/50 hover:bg-gray-700 hover:border-gray-500"
                      } transition-colors`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-foreground truncate">
                              {m.name}
                            </span>
                            {isSelected && (
                              <CheckCircle size={12} className="text-violet-400 shrink-0" />
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {m.verified && (
                              <span className={DS.badgeGreen + " flex items-center gap-1"}>
                                Verified
                              </span>
                            )}
                            {brokenReason && (
                              <span className={DS.badgeRed + " flex items-center gap-1"}>
                                {brokenReason === "not_tested" ? "not tested" : brokenReason}
                              </span>
                            )}
                            {caps.map((cap) => (
                              <span key={cap} className="text-[10px] bg-gray-600/50 text-gray-300 px-1.5 py-0.5 rounded">
                                {cap}
                              </span>
                            ))}
                            {score !== null && (
                              <span className="text-[10px] bg-gray-600/50 text-gray-300 px-1.5 py-0.5 rounded">
                                {score}/100
                              </span>
                            )}
                            {latency && (
                              <span className="text-[10px] bg-gray-600/50 text-gray-300 px-1.5 py-0.5 rounded">
                                {latency}
                              </span>
                            )}
                            {isBest && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                                Best
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={DS.textXs}>
                          {m.size > 0 ? formatSize(m.size) : "unknown"}
                        </span>
                      </div>
                      <ChevronRight size={14} className="text-muted shrink-0" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <p className={DS.textXs}>
                  No verified Ollama models available. Start Ollama to use this feature.
                </p>
                {!ollamaConnected && (
                  <p className={DS.textXs + " opacity-70"}>
                    Ollama is unreachable right now — check that it is running, then retry.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={async () => loadModels(true)}
                    className={DS.btnSecondary + " flex items-center gap-1"}
                  >
                    <RefreshCw size={14} /> Retry
                  </button>
                  <button
                    onClick={() => {
                      const next = !showAllModels;
                      setShowAllModels(next);
                      loadModels(!next);
                    }}
                    className="px-2 py-1 text-xs rounded bg-gray-700/50 hover:bg-gray-700 text-muted border border-gray-600 flex items-center gap-1"
                  >
                    {showAllModels ? "Verified only" : "Show all"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Conversation */}
          <div className="flex-1 min-h-[300px] max-h-[600px] overflow-y-auto space-y-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700/50">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted">
                <MessageCircle size={32} className="mb-3 opacity-30" />
                <p>Start a conversation with your AI model</p>
                <p className="text-xs mt-1 opacity-50">
                  Select a model and type a message above
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                  {msg.role === "user" ? (
                    <User size={14} className="text-gray-400" />
                  ) : (
                    <Bot size={14} className="text-violet-400" />
                  )}
                </div>
                <div className={`flex-1 max-w-[85%] ${msg.role === "user" ? "text-right" : "text-left"}`}>
                  <div className={`inline-block p-3 rounded-lg ${
                    msg.role === "user"
                      ? "bg-violet-600 text-white"
                      : "bg-gray-700 border border-gray-600 text-foreground"
                  }`}>
                    {msg.role === "assistant" && msg.model && (
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-[10px] text-violet-300 font-medium">
                          {msg.model}
                        </span>
                        <button
                          onClick={() => handleRegenerate(msg)}
                          disabled={generating}
                          className="text-[10px] text-gray-400 hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-600"
                          title="Regenerate"
                        >
                          <RotateCw size={10} />
                        </button>
                        <button
                          onClick={() => handleCopy(msg.content)}
                          className="text-[10px] text-gray-400 hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-600"
                          title="Copy"
                        >
                          <Copy size={10} />
                        </button>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words text-sm">
                      {msg.content}
                    </div>
                    {msg.role === "assistant" && msg.thinking && !generating && (
                      <div className="mt-2 pt-2 border-t border-gray-600/50">
                        <button
                          onClick={() => {
                            setMessages((prev) =>
                              prev.map((m) =>
                                m.id === msg.id
                                  ? { ...m, showThinking: !m.showThinking }
                                  : m,
                              ),
                            );
                          }}
                          className="text-[10px] text-purple-300 hover:text-purple-200 flex items-center gap-1"
                        >
                          {msg.showThinking ? "Hide thinking" : "Show thinking"}
                          <Brain size={10} />
                        </button>
                        {msg.showThinking && (
                          <div className="mt-1 p-2 bg-gray-800/50 rounded text-[11px] text-purple-200 italic whitespace-pre-wrap">
                            {msg.thinking}
                          </div>
                        )}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.toolDetails && msg.toolDetails.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {msg.toolDetails.map((tc, i) => (
                          <div
                            key={i}
                            className="p-2 bg-gray-800/50 rounded border border-gray-600/30"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Zap size={12} className="text-amber-400 shrink-0" />
                              <span className="text-xs text-amber-300 font-medium">
                                {tc.name}
                              </span>
                              <span
                                className={`ml-auto text-[10px] ${
                                  tc.status === "calling"
                                    ? "text-violet-300 animate-pulse"
                                    : "text-green-400"
                                }`}
                              >
                                {tc.status === "calling" ? "calling…" : "done"}
                              </span>
                            </div>
                            <pre className={DS.mono + " overflow-auto"}>
                              {JSON.stringify(tc.arguments, null, 2)}
                            </pre>
                            {tc.result && (
                              <div className="mt-1 p-1.5 bg-green-900/10 border border-green-900/20 rounded text-[11px] text-green-300">
                                {tc.result}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {generating && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                  <Bot size={14} className="text-violet-400 animate-pulse" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] text-violet-300 font-medium">
                      {selectedModel}
                    </span>
                    <span className="text-[10px] text-purple-300 animate-pulse">
                      Thinking…
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="w-3 h-3 bg-gray-600 rounded-full animate-pulse"
                        style={{ animationDelay: `${i * 0.1}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Follow-up suggestions */}
          {messages.length > 0 && !generating && (
            <div className="space-y-2">
              <p className={DS.textXs + " text-muted"}>Suggested follow-ups</p>
              <div className="flex flex-wrap gap-2">
                {[
                  "Can you elaborate on that?",
                  "Give me a concrete example",
                  "Make it more concise",
                  "What are the alternatives?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setPrompt(suggestion)}
                    className="px-3 py-1.5 text-xs rounded bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center gap-1 whitespace-nowrap"
                  >
                    <Zap size={10} className="text-amber-400 shrink-0" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt Input */}
          <div className={DS.card}>
            <div className="relative">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className={DS.textarea + " pr-12"}
                rows={3}
                placeholder="Ask for video concepts, scene descriptions, color palettes…"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !e.shiftKey
                  ) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />
            </div>
            <div className={DS.flexBetween + " mt-2"}>
              <span className={DS.textXs}>
                {prompt.length} / 4000 characters · Ctrl+Enter to send
              </span>
              <div className="flex gap-2">
                {generating && (
                  <button
                    onClick={handleCancel}
                    className={DS.btnSecondary + " flex items-center gap-1"}
                  >
                    <StopCircle size={16} className="text-red-400" />
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={
                    generating ||
                    (!prompt.trim()) ||
                    !selectedModel
                  }
                  className={DS.btnPrimary + " " + DS.btnDisabled}
                >
                  {generating ? (
                    <>
                      <Loader2 size={16} className={DS.loading} />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      Send
                    </>
                  )}
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

          {/* Visualization Canvas */}
          {messages.some((m) => m.vizConfig) && (
            <div className={DS.card}>
              <div className={DS.flexCenter + " mb-3"}>
                <Palette size={16} className="text-purple-400" />
                <span className={DS.textBold}>Visualization</span>
              </div>
              <Suspense
                fallback={
                  <div className="viz-canvas-placeholder" style={{ width: 400, height: 300 }}>
                    <p>Rendering visualization…</p>
                  </div>
                }
              >
                <VisualizationCanvas
                  config={messages.find((m) => m.vizConfig)!.vizConfig!}
                  width={400}
                  height={300}
                />
              </Suspense>
            </div>
          )}

          {/* Tool Execution Metrics */}
          <ToolExecutionCard />
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
          promptRef={promptRef}
          selectedModel={selectedModel || ""}
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
          onSave={(tool: Tool) => {
            setTools((prev) => {
              const existing = prev.find((t) => t.id === tool.id);
              if (existing) return prev.map((t) => (t.id === tool.id ? tool : t));
              return [...prev, tool];
            });
            setEnabledTools((prev) => new Set([...prev, tool.id]));
            setShowToolEditor(false);
            setEditingTool(null);
            setToolJsonValid(true);
          }}
          onClose={() => {
            setShowToolEditor(false);
            setEditingTool(null);
          }}
        />
      )}
    </div>
  );
}
