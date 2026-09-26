import { useState, useEffect, useRef } from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  Wrench,
} from "lucide-react";
import { Card } from "../../components/common";
import {
  getApiBase,
  getOllamaModels,
  ollamaChatStream,
  parseOllamaStream,
  type ChatMessage,
  type OllamaModel,
  type ToolDefinition,
} from "../../services/api";

export function OllamaChat() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    async function loadModels() {
      try {
        const [data, toolsData] = await Promise.all([
          getOllamaModels(),
          fetch(`${getApiBase()}/api/integrations/ollama/tools`, { signal: AbortSignal.timeout(10000) })
            .then((r) => r.json())
            .catch(() => ({ tools: [] })),
        ]);
        setModels(data);
        setTools(toolsData.tools || []);
        const preferred = ["gemma4:e2b-it-qat", "qwen3.5:4b", "qwen3-vl:2b"];
        const preferredModel = preferred.find((name) => data.some((model) => model.name === name));
        if (preferredModel) setSelectedModel(preferredModel);
        else if (data.length > 0) setSelectedModel(data[0].name);
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
            const calls = (chunk.data as { tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }> })?.tool_calls || [];
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
          <h1 className="text-2xl font-bold">Ollama Chat</h1>
          <p className="text-sm text-muted mt-1">Chat with local LLM models via Ollama (streaming + tools)</p>
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
                <option>No models found</option>
              ) : (
                models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))
              )}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
              {(() => {
                const m = models.find((x) => x.name === selectedModel);
                const vram = m?.vram_estimate_mb;
                if (!vram) return <ChevronDown size={14} className="text-muted" />;
                const gb = (vram / 1024).toFixed(1);
                const isHigh = vram > 7000;
                return (
                  <>
                    <span className={`text-[10px] ${isHigh ? "text-amber-400" : "text-emerald-400"}`}>{gb}GB</span>
                    <ChevronDown size={14} className="text-muted" />
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <Card className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <Bot size={40} className="text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-muted">Ask anything about your music video project</p>
                <p className="text-xs text-muted mt-1">Powered by {selectedModel || "Ollama"} running locally</p>
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
              <div className={`max-w-[70%] rounded-xl px-4 py-3 text-sm ${msg.role === "user" ? "bg-violet-600 text-white" : "bg-white/5 text-gray-200 border border-white/5"}`}>
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {msg.tool_calls.map((tc, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 rounded-md bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200">
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
                <p className="text-[10px] text-muted mt-1">{msg.timestamp?.toLocaleTimeString() ?? ""}</p>
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
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={selectedModel ? `Message ${selectedModel}…` : "Select a model first…"}
              disabled={!selectedModel || loading}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-muted focus:outline-none focus:border-violet-500 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !selectedModel || loading}
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
