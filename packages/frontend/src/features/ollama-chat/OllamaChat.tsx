import { useState, useEffect, useRef } from "react";
import { Send, Loader2, Bot, User, ChevronDown, Wrench, Shield, Eye, Cpu, AlertCircle, Wifi, WifiOff, Music, Download } from "lucide-react";
import { Card } from "../../components/common";
import { AudioTransport } from "../../components/audio";
import {
  getApiBase,
  getOllamaModels,
  ollamaChatStream,
  ollamaEngineStatus,
  parseOllamaStream,
  uploadAudioFile,
  getBenchmarkResults,
  type ChatMessage,
  type OllamaModel,
  type ToolDefinition,
  type OllamaBenchmarkResult,
} from "../../services/api";
import { getOutputUrl } from "../../utils/url";

export function OllamaChat() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [benchmarks, setBenchmarks] = useState<Record<string, OllamaBenchmarkResult>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [engineStatus, setEngineStatus] = useState<"online" | "offline" | "checking">("checking");
  const [extractRunning, setExtractRunning] = useState(false);
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

  const handleVideoUpload = async (file: File) => {
    setExtractRunning(true);
    setExtractError(null);
    setExtractResult(null);
    try {
      const res = await uploadAudioFile(file);
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

  useEffect(() => {
    async function loadModels() {
      // Detect which inference engine is running before allowing messages.
      await checkEngineStatus();
      try {
        const [data, toolsData] = await Promise.all([
          getOllamaModels(true),
          fetch(`${getApiBase()}/api/integrations/ollama/tools`, {
            signal: AbortSignal.timeout(10000),
          })
            .then((r) => r.json())
            .catch(() => ({ tools: [] })),
        ]);

        // Fetch benchmarks in parallel
        let benchMap: Record<string, OllamaBenchmarkResult> = {};
        try {
          const benchData = await getBenchmarkResults();
          benchMap = benchData.results || {};
          setBenchmarks(benchMap);
        } catch {
          /* no benchmarks yet */
        }

        // Sort by benchmark score desc, then latency asc — best first
        // Verified models first
        const sorted = [...data].sort((a, b) => {
          if (a.verified !== b.verified) return a.verified ? -1 : 1;
          const sa = a.benchmark?.score ?? benchMap[a.name]?.validation?.score ?? -1;
          const sb = b.benchmark?.score ?? benchMap[b.name]?.validation?.score ?? -1;
          if (sa !== sb) return sb - sa;
          const la = a.benchmark?.latency_ms ?? benchMap[a.name]?.latency_ms ?? 999999;
          const lb = b.benchmark?.latency_ms ?? benchMap[b.name]?.latency_ms ?? 999999;
          return la - lb;
        });
        setModels(sorted);
        setTools(toolsData.tools || []);
        const preferred = ["gemma4:e2b-it-qat", "qwen3.5:4b", "qwen3-vl:2b"];
        const preferredModel = preferred.find((name) => sorted.some((model) => model.name === name));
        if (preferredModel) setSelectedModel(preferredModel);
        else if (sorted.length > 0) setSelectedModel(sorted[0].name);
      } catch {
        // ignore
      } finally {
        setModelsLoading(false);
      }
    }
    loadModels();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildHistory = (): ChatMessage[] => {
    // Exclude the just-added user message from history; the API takes it as `message`.
    return messages.filter((m, i) => !(i === messages.length - 1 && m.role === "user"));
  };

  const handleSend = async () => {
    if (engineStatus === "offline") return;
    if (engineStatus === "checking") return;
    if (!input.trim() || !selectedModel || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

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
      let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "",
        timestamp: new Date(),
        tool_calls: [],
      };

      setMessages((prev) => [...prev, assistantMsg]);

      for await (const chunk of parseOllamaStream(stream)) {
        if (controller.signal.aborted) break;

        switch (chunk.type) {
          case "content": {
            const text = typeof chunk.data === "string" ? chunk.data : "";
            assistantContent += text;
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
                  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
                }
              )?.tool_calls || [];
            toolCalls = calls;
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
          case "done":
            break;
          case "error":
            assistantContent += `\n[error: ${typeof chunk.data === "string" ? chunk.data : JSON.stringify(chunk.data)}]`;
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

      // If the model emitted tool calls, append tool results from the stream's final message.
      // The backend streaming loop already executes tools and appends their results,
      // so we just refresh from the accumulated assistant content.
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
          content: `Error: ${err instanceof Error ? err.message : "failed to get response from Ollama."}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-0px)] max-h-screen">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Ollama Chat
            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${engineStatus === "online" ? "bg-green-900/30 text-green-400 border-green-900/50" : engineStatus === "offline" ? "bg-red-900/30 text-red-400 border-red-900/50" : "bg-muted/50 text-muted border-muted/50"}`}>
              {engineStatus === "checking" ? <Wifi size={12} className="mr-1.5 animate-pulse" /> : engineStatus === "online" ? <Wifi size={12} className="mr-1.5" /> : <WifiOff size={12} className="mr-1.5" />}
              {engineStatus === "checking" ? "Checking engine…" : engineStatus === "online" ? "Ollama online" : "Ollama offline"}
            </span>
          </h1>
          <p className="text-sm text-muted mt-1">
            Chat with local LLM models via Ollama (streaming + tools)
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
                <option>No verified models found</option>
              ) : (
                models.map((m) => {
                  const bench = benchmarks[m.name];
                  const score = bench?.validation?.score ?? m.benchmark?.score ?? null;
                  const latency = bench?.latency_ms ?? m.benchmark?.latency_ms ?? null;
                  const success = bench?.success ?? m.benchmark?.success ?? null;
                  let badge = "";
                  if (score !== null && score >= 0) {
                    const s = Math.round(score);
                    const ok = success === false ? "FAIL" : s >= 70 ? "OK" : s >= 40 ? "WARN" : "FAIL";
                    badge = ` [${ok} ${s}/100${latency ? ` ${(latency / 1000).toFixed(1)}s` : ""}]`;
                  } else if (score === null) {
                    badge = " [—]";
                  }
                  const isBest = models[0]?.name === m.name && score !== null && score >= 60;
                  return (
                    <option key={m.name} value={m.name}>
                      {m.name}{m.verified ? " [verified]" : " [unverified]"}{badge}
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
                if (m.supportsTools) badges.push(<span key="t" className="text-amber-400" title="Tools"><Wrench size={10} /></span>);
                if (m.supportsVision) badges.push(<span key="vi" className="text-blue-400" title="Vision"><Eye size={10} /></span>);
                if (m.supportsThinking) badges.push(<span key="th" className="text-purple-400" title="Thinking"><Cpu size={10} /></span>);
                const vram = m.vram_estimate_mb;
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
                badges.push(<ChevronDown key="d" size={14} className="text-muted" />);
                return <>{badges}</>;
              })()}
            </div>
          </div>
        </div>
      </div>

      {engineStatus === "offline" && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-900/30 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-300">Inference engine is offline</p>
            <p className="text-xs text-red-200/70">
              Ollama is not running, so messages cannot be sent. Start Ollama and refresh this page, or check
              the <a href="/system/health" className="text-red-300 underline">Health page</a> for service status.
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
                  if (file) handleVideoUpload(file);
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

      {/* Chat Messages */}
      <Card className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <Bot size={40} className="text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-muted">Ask anything about your music video project</p>
                <p className="text-xs text-muted mt-1">
                  Powered by {selectedModel || "Ollama"} running locally
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
                  handleSend();
                }
              }}
              placeholder={selectedModel ? `Message ${selectedModel}…` : "Select a model first…"}
              disabled={!selectedModel || loading || engineStatus !== "online"}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-muted focus:outline-none focus:border-violet-500 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !selectedModel || loading || engineStatus !== "online"}
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
