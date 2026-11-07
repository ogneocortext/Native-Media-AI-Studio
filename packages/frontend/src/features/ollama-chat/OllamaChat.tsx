/**
 * OllamaChat — AI chat interface for the Native Media AI Studio.
 *
 * Route: /analyze/chat
 *
 * Dual-engine chat (Ollama + Atomic Chat) with streaming, tool calling,
 * benchmark-aware model selection, task-specific auto-selection, and a
 * video→audio extraction helper.
 *
 * Structure:
 *   OllamaChat          — state, effects, send/abort orchestration
 *   ChatHeader          — title + engine status badges
 *   ModelSelector       — model dropdown with benchmark/verification badges
 *   EngineStatusAlerts  — offline/degraded engine warnings
 *   BenchmarkControls   — benchmark runners + task routing + auto-select
 *   VideoUploadPanel    — video → audio extraction
 *   StreamStatusBanner  — real-time stream progress + event log
 *   EmptyState          — suggested prompts when no messages
 *   MessageList         — scrollable message container
 *   MessageItem         — single message (user / assistant / tool)
 *   SimpleMarkdown      — lightweight markdown → React renderer
 *   ChatInput           — input field + send button + shortcuts
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  Wrench,
  Shield,
  Eye,
  AlertCircle,
  Wifi,
  WifiOff,
  Download,
  Zap,
  GitBranch,
  Activity,
  Brain,
  Copy,
  Trash2,
  Plus,
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

const PREFERRED_MODELS = ["llama3.1:8b", "gemma4:e2b-it-qat", "qwen3.5:4b", "qwen3-vl:2b"] as const;

const SUGGESTED_PROMPTS = [
  "Summarize my current project structure",
  "Help me plan a beat-synced music video",
  "Analyze the latest audio track",
  "Generate a visualizer preset for this track",
  "Explain the remix mashup workflow",
];

// ---------------------------------------------------------------------------
// Safe benchmark access — fixes crash when a model has no benchmark results
// ---------------------------------------------------------------------------

function getBenchmarkScore(
  benchmarks: Record<string, OllamaBenchmarkResult>,
  modelName: string,
): { score: number | null; latency: number | null; success: boolean | null } {
  const mBench = benchmarks[modelName];
  const modelBench = (mBench?.validation ?? {}) as
    | {
        score?: number;
        latency_ms?: number;
        success?: boolean;
      }
    | undefined;
  return {
    score: modelBench?.score ?? null,
    latency: modelBench?.latency_ms ?? null,
    success: modelBench?.success ?? null,
  };
}

// ---------------------------------------------------------------------------
// SimpleMarkdown — lightweight markdown → React (no extra dependency)
// ---------------------------------------------------------------------------

type MDNode =
  | { type: "text"; content: string }
  | { type: "bold"; children: MDNode[] }
  | { type: "italic"; children: MDNode[] }
  | { type: "code"; content: string }
  | { type: "link"; href: string; children: MDNode[] }
  | { type: "br" };

function parseInline(md: string): MDNode[] {
  const nodes: MDNode[] = [];
  let i = 0;
  const len = md.length;
  while (i < len) {
    const ch = md[i];
    if (ch === "`") {
      const end = md.indexOf("`", i + 1);
      if (end !== -1) {
        nodes.push({ type: "code", content: md.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      nodes.push({ type: "text", content: ch });
      i += 1;
      continue;
    }
    if (md.startsWith("**", i)) {
      const end = md.indexOf("**", i + 2);
      if (end !== -1) {
        nodes.push({ type: "bold", children: parseInline(md.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
      nodes.push({ type: "text", content: "**" });
      i += 2;
      continue;
    }
    if (ch === "*") {
      const end = md.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1) {
        nodes.push({ type: "italic", children: parseInline(md.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
      nodes.push({ type: "text", content: ch });
      i += 1;
      continue;
    }
    if (ch === "[") {
      const close = md.indexOf("]", i + 1);
      if (close !== -1 && md[close + 1] === "(") {
        const parenClose = md.indexOf(")", close + 2);
        if (parenClose !== -1) {
          nodes.push({
            type: "link",
            href: md.slice(close + 2, parenClose),
            children: parseInline(md.slice(i + 1, close)),
          });
          i = parenClose + 1;
          continue;
        }
      }
      nodes.push({ type: "text", content: ch });
      i += 1;
      continue;
    }
    if (ch === "\n") {
      nodes.push({ type: "br" });
      i += 1;
      continue;
    }
    nodes.push({ type: "text", content: ch });
    i += 1;
  }
  return nodes;
}

function renderInline(nodes: MDNode[]): React.ReactNode {
  return nodes.map((node, idx) => {
    switch (node.type) {
      case "text":
        return node.content;
      case "bold":
        return <strong key={idx}>{renderInline(node.children)}</strong>;
      case "italic":
        return <em key={idx}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code
            key={idx}
            className="text-xs bg-white/10 px-1.5 py-0.5 rounded border border-white/5 text-cyan-300 font-mono"
          >
            {node.content}
          </code>
        );
      case "link":
        return (
          <a
            key={idx}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 underline underline-offset-4 hover:text-emerald-300"
          >
            {renderInline(node.children)}
          </a>
        );
      case "br":
        return <br key={idx} />;
      default:
        return null;
    }
  });
}

function SimpleMarkdown({ content }: { content: string }): React.ReactNode {
  if (!content) return null;
  const blocks = content.split("\n\n");
  return blocks.map((block, bi) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("```")) {
      const fenceEnd = trimmed.indexOf("```", 3);
      const langLine = trimmed.slice(3, fenceEnd !== -1 ? fenceEnd : trimmed.length).trim();
      const codeBody = fenceEnd !== -1 ? trimmed.slice(fenceEnd + 3).trim() : "";
      return (
        <div
          key={bi}
          className="my-2 rounded-lg border border-white/5 bg-black/30 p-3 overflow-x-auto"
        >
          <div className="flex items-center gap-2 mb-1 text-[10px] text-muted font-mono">
            <span>{langLine || "text"}</span>
          </div>
          <pre className="text-sm text-gray-200 font-mono leading-relaxed whitespace-pre break-all">
            {codeBody}
          </pre>
        </div>
      );
    }
    const headingMatch = /^(#{1,3})\s(.+)/s.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      return (
        <Tag key={bi} className="mt-3 mb-1 text-white font-semibold">
          {renderInline(parseInline(text))}
        </Tag>
      );
    }
    if (trimmed.startsWith(">")) {
      const text = trimmed.slice(1).trim();
      return (
        <div key={bi} className="my-2 border-l-2 border-emerald-500 pl-3 italic text-gray-300">
          {renderInline(parseInline(text))}
        </div>
      );
    }
    if (/^[-*]\s/m.test(trimmed)) {
      const items = trimmed.split(/\n(?=[-*]\s)/);
      return (
        <ul key={bi} className="my-2 list-disc pl-5 space-y-1 text-gray-200">
          {items.map((item, ii) => (
            <li key={ii} className="whitespace-pre-wrap">
              {renderInline(parseInline(item.replace(/^[-*]\s/, "")))}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className="my-2 text-gray-200 whitespace-pre-wrap break-words">
        {renderInline(parseInline(trimmed))}
      </p>
    );
  });
}

// ---------------------------------------------------------------------------
// MessageItem
// ---------------------------------------------------------------------------

interface MessageItemProps {
  msg: ChatMessage;
  onCopy: (text: string) => void;
}

function MessageItem({ msg, onCopy }: MessageItemProps) {
  const isUser = msg.role === "user";
  const time = msg.timestamp
    ? msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const hasContent = Boolean(msg.content?.trim());
  const isError = hasContent && msg.content.startsWith("Error:");

  return (
    <div
      key={String(msg.timestamp?.getTime() ?? Math.random())}
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <Bot size={16} className="text-white" />
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-xl px-4 py-3 text-sm ${isUser ? "bg-violet-600 text-white" : "bg-white/5 text-gray-200 border border-white/5"}`}
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
          <div className="mb-1 text-xs text-muted uppercase tracking-wider">
            tool result: {msg.tool_name}
          </div>
        )}
        {hasContent && (
          <div className="relative group">
            <SimpleMarkdown content={msg.content} />
            {isError ? (
              <div className="mt-1 px-2 py-1 rounded bg-red-900/20 border border-red-900/50 text-xs text-red-300">
                ⚠ Request could not be completed
              </div>
            ) : null}
            {!isUser && hasContent && !isError && (
              <button
                onClick={() => onCopy(msg.content)}
                className="absolute -top-6 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                title="Copy"
                aria-label="Copy message"
              >
                <Copy size={12} />
              </button>
            )}
          </div>
        )}
        <p className="text-[10px] text-muted mt-1 flex items-center gap-1">{time}</p>
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          <User size={16} className="text-white" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageList
// ---------------------------------------------------------------------------

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
  onCopy: (text: string) => void;
  atBottom: boolean;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
}

function MessageList({ messages, loading, onCopy, atBottom, setAtBottom }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!atBottom) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, atBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAtBottom(nearBottom);
  }, [setAtBottom]);

  return (
    <Card className="flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <Bot size={48} className="text-muted/30 mx-auto mb-4" />
              <p className="text-sm font-medium text-white">Start a conversation</p>
              <p className="text-xs text-muted mt-1">
                Powered by a local LLM — nothing leaves your machine
              </p>
              <div className="flex flex-col gap-2 mt-6 w-full max-w-xs mx-auto">
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    className="text-left w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageItem
            key={String(msg.timestamp?.getTime() ?? Math.random())}
            msg={msg}
            onCopy={onCopy}
          />
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
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ChatHeader
// ---------------------------------------------------------------------------

interface ChatHeaderProps {
  engineStatus: "online" | "offline" | "checking";
  atomicStatus: "online" | "offline" | "checking";
}

function ChatHeader({ engineStatus, atomicStatus }: ChatHeaderProps) {
  const checking = engineStatus === "checking" || atomicStatus === "checking";
  return (
    <div className="flex items-center justify-between mb-4 shrink-0">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          AI Chat
          <span className="flex items-center gap-2">
            {checking ? (
              <Wifi size={12} className="mr-1.5 animate-pulse" />
            ) : engineStatus === "online" ? (
              <Wifi size={12} className="mr-1.5" />
            ) : (
              <WifiOff size={12} className="mr-1.5" />
            )}
            {checking
              ? "Checking engines…"
              : engineStatus === "online"
                ? "Ollama online"
                : "Ollama offline"}
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
      <div className="flex items-center gap-2">
        {engineStatus === "checking" || atomicStatus === "checking" ? (
          <Loader2 size={14} className="animate-spin text-muted" />
        ) : engineStatus === "online" || atomicStatus === "online" ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Online
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Offline
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EngineStatusAlerts
// ---------------------------------------------------------------------------

interface EngineStatusAlertsProps {
  engineStatus: "online" | "offline" | "checking";
  atomicStatus: "online" | "offline" | "checking";
}

function EngineStatusAlerts({ engineStatus, atomicStatus }: EngineStatusAlertsProps) {
  if (engineStatus === "offline" && atomicStatus === "offline") {
    return (
      <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-900/30 flex items-center gap-3">
        <AlertCircle size={18} className="text-red-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-red-300">No inference engine online</p>
          <p className="text-xs text-red-200/70">
            Neither Ollama nor Atomic Chat is running, so messages cannot be sent. Start an engine
            and refresh this page, or check the{" "}
            <a href="/system/health" className="text-red-300 underline">
              Health page
            </a>
            for service status.
          </p>
        </div>
      </div>
    );
  }
  if (engineStatus === "offline" && atomicStatus === "online") {
    return (
      <div className="mb-4 p-3 rounded-lg bg-amber-900/20 border border-amber-900/30 flex items-center gap-3">
        <AlertCircle size={18} className="text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-300">
            Ollama offline — Atomic Chat available
          </p>
          <p className="text-xs text-amber-200/70">
            Ollama is not running but Atomic Chat is online. Select an Atomic Chat model from the
            dropdown above.
          </p>
        </div>
      </div>
    );
  }
  if (engineStatus === "online" && atomicStatus === "offline") {
    return (
      <div className="mb-4 p-3 rounded-lg bg-amber-900/20 border border-amber-900/30 flex items-center gap-3">
        <AlertCircle size={18} className="text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-300">
            Atomic Chat offline — Ollama available
          </p>
          <p className="text-xs text-amber-200/70">
            Atomic Chat is not running but Ollama is online. Ollama models are available for chat.
          </p>
        </div>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// ModelSelector
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  models: UnifiedModel[];
  modelsLoading: boolean;
  selectedModel: string;
  benchmarks: Record<string, OllamaBenchmarkResult>;
  onModelChange: (value: string) => void;
  toolRoutes: {
    routes: Record<string, { engine: string; model: string; reason: string }>;
    excluded_from_chat: string[];
  } | null;
  onAutoSelect: (task: "coding" | "vision" | "chat" | "default") => void;
}

function ModelSelector({
  models,
  modelsLoading,
  selectedModel,
  benchmarks,
  onModelChange,
  toolRoutes,
  onAutoSelect,
}: ModelSelectorProps) {
  const selectedModelMeta = models.find((m) => m.name === selectedModel);
  const sourceCfg = SOURCE_BADGES[selectedModelMeta?.source ?? "ollama"];

  const chatEligible = models.filter((m) => m.chat_eligible);
  const sorted = [...chatEligible].sort((a, b) => {
    const sa = getBenchmarkScore(benchmarks, a.name).score ?? -1;
    const sb = getBenchmarkScore(benchmarks, b.name).score ?? -1;
    if (sa !== sb) return sb - sa;
    const la = getBenchmarkScore(benchmarks, a.name).latency ?? 999999;
    const lb = getBenchmarkScore(benchmarks, b.name).latency ?? 999999;
    return la - lb;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={modelsLoading || sorted.length === 0}
          className="appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-16 text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
        >
          {modelsLoading ? (
            <option>Loading models…</option>
          ) : sorted.length === 0 ? (
            <option>No chat-eligible models found</option>
          ) : (
            sorted.map((m) => {
              const { score, latency, success } = getBenchmarkScore(benchmarks, m.name);
              let badge = "";
              if (score !== null) {
                const s = Math.round(score);
                const ok = success === false ? "FAIL" : s >= 70 ? "OK" : s >= 40 ? "WARN" : "FAIL";
                badge = ` [${ok} ${s}/100${latency ? ` ${(latency / 1000).toFixed(1)}s` : ""}]`;
              } else if (score === null) {
                badge = " [—]";
              }
              const isBest = sorted[0]?.name === m.name && score !== null && score >= 60;
              const sCfg = SOURCE_BADGES[m.source];
              return (
                <option key={m.name} value={m.name}>
                  {m.name} [{sCfg.label}]{m.verified ? " [verified]" : " [unverified]"}
                  {badge}
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
            if (m.verified)
              badges.push(
                <span key="v" className="text-green-400" title="Verified Working">
                  <Shield size={10} />
                </span>,
              );
            if (!m.verified && m.broken_reason)
              badges.push(
                <span key="b" className="text-red-400" title={m.broken_reason}>
                  <AlertCircle size={10} />
                </span>,
              );
            if (m.supports_tools)
              badges.push(
                <span key="t" className="text-amber-400" title="Tools">
                  <Wrench size={10} />
                </span>,
              );
            if (m.supports_vision)
              badges.push(
                <span key="vi" className="text-blue-400" title="Vision">
                  <Eye size={10} />
                </span>,
              );
            if (m.supports_thinking)
              badges.push(
                <span key="th" className="text-purple-400" title="Thinking">
                  <Brain size={10} />
                </span>,
              );
            if (m.supports_embedding)
              badges.push(
                <span key="em" className="text-cyan-400 flex items-center gap-1" title="Embeddings">
                  <Activity size={10} /> Embeddings
                </span>,
              );
            if (m.supports_rerank)
              badges.push(
                <span key="rr" className="text-violet-400 flex items-center gap-1" title="Reranker">
                  <GitBranch size={10} /> Reranker
                </span>,
              );
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
                </span>,
              );
            }
            badges.push(
              <span
                key="src"
                className={`text-[10px] ${sourceCfg.color}`}
                title={SOURCE_BADGES[m.source || "ollama"].label}
              >
                {m.source === "atomic-chat" ? <Zap size={10} /> : <Activity size={10} />}
              </span>,
            );
            badges.push(<ChevronDown key="d" size={14} className="text-muted" />);
            return <>{badges}</>;
          })()}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          disabled={modelsLoading}
          className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50"
          title="Run Ollama benchmarks"
          onClick={() => {
            // wired by parent
          }}
        >
          <Download size={12} />
        </button>
      </div>

      {toolRoutes && (
        <div className="flex items-center gap-1 flex-wrap">
          {Object.entries(toolRoutes.routes).map(([task, route]) => (
            <button
              key={task}
              onClick={() => onAutoSelect(task as "coding" | "vision" | "chat" | "default")}
              disabled={modelsLoading}
              className="px-2 py-1 text-xs rounded bg-purple-900/20 border border-purple-900/50 hover:bg-purple-900/40 disabled:opacity-50 text-purple-300"
              title={`Switch to ${route.model} for ${task} (${route.reason})`}
            >
              {task}: {route.model.split(":")[0]}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => onAutoSelect("coding")}
          disabled={modelsLoading}
          className="px-2 py-1 text-xs rounded bg-blue-900/20 border border-blue-900/50 hover:bg-blue-900/40 disabled:opacity-50 text-blue-300"
          title="Auto-select best coding model"
        >
          Code
        </button>
        <button
          onClick={() => onAutoSelect("vision")}
          disabled={modelsLoading}
          className="px-2 py-1 text-xs rounded bg-emerald-900/20 border border-emerald-900/50 hover:bg-emerald-900/40 disabled:opacity-50 text-emerald-300"
          title="Auto-select best vision model"
        >
          Vision
        </button>
        <button
          onClick={() => onAutoSelect("chat")}
          disabled={modelsLoading}
          className="px-2 py-1 text-xs rounded bg-amber-900/20 border border-amber-900/50 hover:bg-amber-900/40 disabled:opacity-50 text-amber-300"
          title="Auto-select best chat model"
        >
          Chat
        </button>
      </div>

      {toolRoutes && (
        <div className="mb-4 p-3 rounded-lg bg-white/5 border border-white/10 flex items-start gap-3">
          <Brain size={16} className="text-purple-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-purple-300">Task-specific model routing</p>
            <div className="text-xs text-muted flex flex-wrap gap-2">
              {Object.entries(toolRoutes.routes).map(([task, route]) => (
                <span
                  key={task}
                  className="bg-purple-900/20 px-2 py-1 rounded border border-purple-900/50 text-xs text-purple-300"
                >
                  {task}: {route.model}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamStatusBanner
// ---------------------------------------------------------------------------

interface StreamStatusBannerProps {
  streamStatus:
    "idle" | "connecting" | "thinking" | "executing_tool" | "streaming_response" | "done";
  toolStep: number;
  totalToolSteps: number;
  currentTool: string | null;
  streamEvents: { time: string; event: string; detail: string }[];
  showDetails: boolean;
  setShowDetails: Dispatch<SetStateAction<boolean>>;
}

function StreamStatusBanner({
  streamStatus,
  toolStep,
  totalToolSteps,
  currentTool,
  streamEvents,
  showDetails,
  setShowDetails,
}: StreamStatusBannerProps) {
  if (streamStatus === "idle") return null;

  const label =
    streamStatus === "connecting"
      ? "Connecting…"
      : streamStatus === "thinking"
        ? "Model is thinking…"
        : streamStatus === "executing_tool"
          ? `Executing tool${currentTool ? `: ${currentTool}` : ""}${totalToolSteps > 0 ? ` (step ${toolStep + 1}/${totalToolSteps})` : ""}`
          : streamStatus === "streaming_response"
            ? "Streaming response…"
            : "Complete";

  const icon =
    streamStatus === "connecting" ? (
      <Loader2 size={14} className="animate-spin text-emerald-400" />
    ) : streamStatus === "thinking" ? (
      <Brain size={14} className="text-purple-400 animate-pulse" />
    ) : streamStatus === "executing_tool" ? (
      <Wrench size={14} className="text-amber-400 animate-pulse" />
    ) : streamStatus === "streaming_response" ? (
      <Activity size={14} className="text-blue-400 animate-pulse" />
    ) : (
      <Shield size={14} className="text-emerald-400" />
    );

  return (
    <Card className="mb-4 shrink-0">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs font-semibold text-white uppercase tracking-wider">{label}</span>
        </div>
        {streamEvents.length > 0 && (
          <details
            className="mt-2 text-xs"
            open={showDetails}
            onToggle={() => setShowDetails((v) => !v)}
          >
            <summary className="cursor-pointer text-muted hover:text-white mb-1">
              Processing details
            </summary>
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
  );
}

// ---------------------------------------------------------------------------
// BenchmarkControls
// ---------------------------------------------------------------------------

interface BenchmarkControlsProps {
  benchmarks: Record<string, OllamaBenchmarkResult>;
  benchmarkRunning: boolean;
  codingBenchmarkRunning: boolean;
  modelsLoading: boolean;
  onRunBenchmarks: () => void;
  onRunCodingBenchmarks: () => void;
}

function BenchmarkControls({
  benchmarks,
  benchmarkRunning,
  codingBenchmarkRunning,
  modelsLoading,
  onRunBenchmarks,
  onRunCodingBenchmarks,
}: BenchmarkControlsProps) {
  return (
    <div className="mb-4 shrink-0">
      <Card title="Model benchmarks">
        <div className="p-4 flex flex-col gap-3">
          <p className="text-xs text-muted">
            Benchmarks measure chat quality and latency per model. Run them to surface the best
            model for each task.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onRunBenchmarks}
              disabled={benchmarkRunning || modelsLoading}
              className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50"
              title={benchmarkRunning ? "Running benchmarks…" : "Run Ollama benchmarks"}
            >
              {benchmarkRunning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Download size={12} />
              )}
            </button>
            <button
              onClick={onRunCodingBenchmarks}
              disabled={codingBenchmarkRunning || modelsLoading}
              className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50"
              title={
                codingBenchmarkRunning ? "Running coding benchmarks…" : "Run coding benchmarks"
              }
            >
              {codingBenchmarkRunning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Zap size={12} />
              )}
            </button>
          </div>
          {Object.entries(benchmarks).length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              {Object.entries(benchmarks).map(([name]) => {
                const { score } = getBenchmarkScore(benchmarks, name);
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between text-xs p-2 rounded bg-white/5 border border-white/5"
                  >
                    <span className="font-mono text-gray-300 truncate">{name}</span>
                    <span
                      className={`font-mono ${score !== null && score >= 70 ? "text-emerald-400" : score !== null && score >= 40 ? "text-amber-400" : "text-red-400"}`}
                    >
                      {score !== null ? `${Math.round(score)}/100` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VideoUploadPanel
// ---------------------------------------------------------------------------

interface VideoUploadPanelProps {
  extractRunning: boolean;
  extractError: string | null;
  extractResult: {
    filename: string;
    relative_path: string;
    stored_path: string;
    size_bytes: number;
    message: string;
    converted: boolean | undefined;
    source_filename: string | null | undefined;
    lossless: boolean | undefined;
  } | null;
  onUpload: (file: File) => void;
}

function VideoUploadPanel({
  extractRunning,
  extractError,
  extractResult,
  onUpload,
}: VideoUploadPanelProps) {
  return (
    <Card className="mb-4 shrink-0" title="Video → Audio">
      <div className="p-4">
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
                if (file) void onUpload(file);
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
  );
}

// ---------------------------------------------------------------------------
// ChatInput
// ---------------------------------------------------------------------------

interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  disabled: boolean;
  loading: boolean;
  onSend: () => void;
  placeholder: string;
}

function ChatInput({ input, setInput, disabled, loading, onSend, placeholder }: ChatInputProps) {
  return (
    <div className="p-4 border-t border-white/5 shrink-0">
      <div className="flex items-center gap-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-muted focus:outline-none focus:border-violet-500 disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={!input.trim() || disabled}
          className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
      <p className="text-[10px] text-muted mt-2">
        Enter to send • Shift+Enter for newline • Ctrl+Enter to send • Escape to abort
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OllamaChat (main) — state, effects, send/abort orchestration
// ---------------------------------------------------------------------------

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
  const abortRef = useRef<AbortController | null>(null);
  const [engineStatus, setEngineStatus] = useState<"online" | "offline" | "checking">("checking");
  const [atomicStatus, setAtomicStatus] = useState<"online" | "offline" | "checking">("checking");
  const [taskRoutes, setTaskRoutes] = useState<{
    routes: Record<string, { engine: string; model: string; reason: string }>;
    excluded_from_chat: string[];
  } | null>(null);
  const [streamStatus, setStreamStatus] = useState<
    "idle" | "connecting" | "thinking" | "executing_tool" | "streaming_response" | "done"
  >("idle");
  const [toolStep, setToolStep] = useState(0);
  const [totalToolSteps, setTotalToolSteps] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<
    { time: string; event: string; detail: string }[]
  >([]);
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
  const [atBottom, setAtBottom] = useState(true);
  const [showStreamDetails, setShowStreamDetails] = useState(false);

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

        let benchMap: Record<string, OllamaBenchmarkResult> = {};
        try {
          const benchData = await getBenchmarkResults();
          benchMap = benchData.results || {};
          setBenchmarks(benchMap);
        } catch {
          /* no benchmarks yet */
        }

        const chatEligible = data.filter((m) => m.chat_eligible);
        const sorted = [...chatEligible].sort((a, b) => {
          const sa = getBenchmarkScore(benchMap, a.name).score ?? -1;
          const sb = getBenchmarkScore(benchMap, b.name).score ?? -1;
          if (sa !== sb) return sb - sa;
          const la = getBenchmarkScore(benchMap, a.name).latency ?? 999999;
          const lb = getBenchmarkScore(benchMap, b.name).latency ?? 999999;
          return la - lb;
        });

        setModels(sorted);
        setTools(toolsData.tools ?? []);
        const preferredModel = PREFERRED_MODELS.find((name) =>
          sorted.some((model) => model.name === name),
        );
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
    setAtBottom(true);
  }, [messages]);

  const buildHistory = useCallback((): ChatMessage[] => {
    return messages.filter((m, i) => !(i === messages.length - 1 && m.role === "user"));
  }, [messages]);

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
    setAtBottom(true);

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
      const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];
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
            const contentData = chunk.data as string;
            assistantContent += contentData;
            setStreamStatus("streaming_response");
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
            const tcData = chunk.data as { name: string; arguments: Record<string, unknown> };
            setStreamStatus("executing_tool");
            setCurrentTool(tcData.name);
            toolCalls.push({ name: tcData.name, arguments: tcData.arguments ?? {} });
            setToolStep((s) => s + 1);
            logStreamEvent(
              "tool_call",
              `${tcData.name}(${JSON.stringify(tcData.arguments ?? {}).slice(0, 80)})`,
            );
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant") {
                last.tool_calls = toolCalls;
              }
              return next;
            });
            break;
          }
          case "tool_result": {
            const trData = chunk.data as { name: string; success: boolean };
            setStreamStatus("streaming_response");
            logStreamEvent("tool_result", `${trData.name} → ${trData.success ? "ok" : "error"}`);
            break;
          }
          case "done": {
            const doneData = chunk.data as { reason?: string };
            setStreamStatus("done");
            logStreamEvent("done", `Stream finished (${doneData.reason ?? "unknown"})`);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant") {
                last.content = assistantContent;
                last.tool_calls = toolCalls;
              }
              return next;
            });
            break;
          }
          case "error": {
            setStreamStatus("idle");
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant") {
                last.content = `Error: ${chunk.data ?? "stream error"}`;
              }
              return next;
            });
            break;
          }
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

  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setStreamStatus("idle");
      setLoading(false);
      abortRef.current = null;
      logStreamEvent("abort", "Stream aborted by user");
    }
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setStreamEvents([]);
    setStreamStatus("idle");
    setAtBottom(true);
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Keyboard shortcuts: Ctrl+Enter to send, Escape to abort
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSend();
      }
      if (e.key === "Escape" && loading) {
        handleAbort();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSend, handleAbort, loading]);

  const anyEngineOnline = engineStatus === "online" || atomicStatus === "online";
  const inputDisabled = !selectedModel || loading || !anyEngineOnline;

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-0px)] max-h-screen">
      <ChatHeader engineStatus={engineStatus} atomicStatus={atomicStatus} />

      <EngineStatusAlerts engineStatus={engineStatus} atomicStatus={atomicStatus} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
        <div className="lg:col-span-2 flex flex-col h-full min-h-0">
          <ModelSelector
            models={models}
            modelsLoading={modelsLoading}
            selectedModel={selectedModel}
            benchmarks={benchmarks}
            onModelChange={setSelectedModel}
            toolRoutes={taskRoutes}
            onAutoSelect={handleAutoSelectModel}
          />
          <BenchmarkControls
            benchmarks={benchmarks}
            benchmarkRunning={benchmarkRunning}
            codingBenchmarkRunning={codingBenchmarkRunning}
            modelsLoading={modelsLoading}
            onRunBenchmarks={handleRunBenchmarks}
            onRunCodingBenchmarks={handleRunCodingBenchmarks}
          />
          <StreamStatusBanner
            streamStatus={streamStatus}
            toolStep={toolStep}
            totalToolSteps={totalToolSteps}
            currentTool={currentTool}
            streamEvents={streamEvents}
            showDetails={showStreamDetails}
            setShowDetails={setShowStreamDetails}
          />
          <VideoUploadPanel
            extractRunning={extractRunning}
            extractError={extractError}
            extractResult={extractResult}
            onUpload={handleVideoUpload}
          />
        </div>

        <div className="lg:col-span-1 flex flex-col gap-4 min-h-0">
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wrench size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Tools</h3>
              </div>
              <label className="flex items-center gap-2 text-xs text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={toolsEnabled}
                  onChange={(e) => setToolsEnabled(e.target.checked)}
                  className="rounded border-white/20 bg-white/5"
                />
                Tool calling ({tools.length})
              </label>
              <p className="text-[10px] text-muted mt-2">
                When enabled, the model can call backend tools (audio, remix, visualizer, etc.)
                during the conversation.
              </p>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={16} className="text-purple-400" />
                <h3 className="text-sm font-semibold text-white">Conversation</h3>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleClear}
                  disabled={messages.length === 0 || loading}
                  className="flex-1 px-3 py-2 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 text-gray-400"
                >
                  <Trash2 size={12} className="mr-2" /> Clear chat
                </button>
                <button
                  onClick={() => {
                    setInput("");
                    setMessages([]);
                  }}
                  disabled={loading}
                  className="px-3 py-2 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50"
                  title="New conversation"
                >
                  <Plus size={12} className="mr-2" /> New
                </button>
              </div>
              <p className="text-[10px] text-muted mt-2">
                {messages.length} message{messages.length !== 1 ? "s" : ""} in this conversation
              </p>
            </div>
          </Card>
        </div>
      </div>

      <MessageList
        messages={messages}
        loading={loading}
        onCopy={(text) => {
          navigator.clipboard.writeText(text);
        }}
        atBottom={atBottom}
        setAtBottom={setAtBottom}
      />

      <ChatInput
        input={input}
        setInput={setInput}
        disabled={inputDisabled}
        loading={loading}
        onSend={handleSend}
        placeholder={selectedModel ? `Message ${selectedModel}…` : "Select a model first…"}
      />
    </div>
  );
}
