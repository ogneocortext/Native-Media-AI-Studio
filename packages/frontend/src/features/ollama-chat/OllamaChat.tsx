import { useState, useEffect, useRef } from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
} from "lucide-react";
import { Card } from "../../components/common";
import { getOllamaModels, ollamaGenerate, type OllamaModel } from "../../services/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function OllamaChat() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadModels() {
      try {
        const data = await getOllamaModels();
        setModels(data);
        if (data.length > 0) setSelectedModel(data[0].name);
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

  const handleSend = async () => {
    if (!input.trim() || !selectedModel || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await ollamaGenerate(input.trim(), selectedModel);
      setMessages((prev) => [...prev, { role: "assistant", content: res.response, timestamp: new Date() }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error: failed to get response from Ollama.", timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-0px)] max-h-screen">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Ollama Chat</h1>
          <p className="text-sm text-muted mt-1">Chat with local LLM models via Ollama</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={modelsLoading}
              className="appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-violet-500"
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
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
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
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <p className="text-[10px] text-muted mt-1">{msg.timestamp.toLocaleTimeString()}</p>
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
