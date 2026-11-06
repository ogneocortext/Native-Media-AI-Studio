/**
 * AgentChat — Frontend agent chat with real-time streaming and inline visualizations.
 *
 * Uses ollamaChatStream + parseOllamaStream for true streaming:
 * 1. Discover skills from the backend /api/mcp/skills/list endpoint
 * 2. Convert skills into Ollama tool definitions
 * 3. Stream ollamaChat with the user's message + tools (backend handles tool execution loop)
 * 4. Display content, tool calls, and tool results in real-time as they arrive
 * 5. Render image/video tool results inline
 *
 * Route: /analyze/agent-chat
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Send,
  Loader2,
  Bot,
  Wrench,
  Activity,
  Video as VideoIcon,
  StopCircle,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Card } from "../../components/common";
import {
  skillsList,
  selectModel,
  type SkillInfo,
  type ExecuteToolResponse,
} from "../../services/api";
import {
  ollamaChatStream,
  parseOllamaStream,
  type ChatMessage,
  type ToolDefinition,
} from "../../services/api/ollama";
import { getOutputUrl } from "../../utils/url";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];

function isImagePath(path: string): boolean {
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));
  return IMAGE_EXTENSIONS.includes(ext);
}

function isVideoPath(path: string): boolean {
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));
  return VIDEO_EXTENSIONS.includes(ext);
}

function extractMediaPaths(obj: unknown): string[] {
  const paths: string[] = [];
  if (typeof obj === "string") {
    if (isImagePath(obj) || isVideoPath(obj)) paths.push(obj);
  } else if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const v of Object.values(obj)) {
      paths.push(...extractMediaPaths(v));
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) paths.push(...extractMediaPaths(item));
  }
  return paths;
}

interface AgentMessage {
  id: string;
  type: "user" | "assistant" | "tool_call" | "tool_result" | "thought" | "error" | "final";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ExecuteToolResponse;
  mediaUrls?: string[]; // Inline image/video URLs to render
  timestamp: Date;
  expanded?: boolean;
}

export function AgentChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load skills on mount
  useEffect(() => {
    void loadSkills();
  }, []);

  async function loadSkills() {
    try {
      const loaded = await skillsList();
      setSkills(loaded);
      setSkillsLoaded(true);
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : String(err));
      setSkillsLoaded(true);
    }
  }

  const addMessage = useCallback(
    (msg: Omit<AgentMessage, "id" | "timestamp">) => {
      const id = Math.random().toString(36).slice(2);
      setMessages((prev) => [...prev, { ...msg, id, timestamp: new Date(), expanded: false }]);
    },
    [],
  );

  const appendToLastMessage = useCallback(
    (content: string) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const updated = { ...last, content: last.content + content };
        return [...prev.slice(0, -1), updated];
      });
    },
    [],
  );

  const updateLastMessage = useCallback(
    (updates: Partial<Omit<AgentMessage, "id" | "timestamp">>) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = { ...prev[prev.length - 1], ...updates };
        return [...prev.slice(0, -1), last];
      });
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleExpanded = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, expanded: !m.expanded } : m)),
    );
  }, []);

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userText = input;
    setInput("");
    addMessage({ type: "user", content: userText });

    setStreaming(true);
    abortControllerRef.current = new AbortController();

    try {
      // Step 1: Discover skills from the backend
      let loadedSkills: SkillInfo[] = skills.length > 0 ? skills : [];
      try {
        loadedSkills = await skillsList();
        setSkills(loadedSkills);
        setSkillsLoaded(true);
      } catch (err) {
        setSkillsError(err instanceof Error ? err.message : String(err));
        setSkillsLoaded(true);
      }

      const toolDefs: ToolDefinition[] = loadedSkills.map((skill) => ({
        type: "function",
        function: {
          name: `skill_${skill.name}`,
          description:
            skill.description || `Skill: ${skill.name}. Available tools: ${skill.tools.join(", ")}`,
          parameters: {
            type: "object",
            properties: {
              tool: {
                type: "string",
                description: `Which tool to call within the ${skill.name} skill. Available: ${skill.tools.join(
                  ", ",
                )}`,
              },
              arguments: {
                type: "object",
                description:
                  "Arguments for the tool. Parameter names and types depend on the specific tool.",
              },
            },
            required: ["tool", "arguments"],
            additionalProperties: false,
          },
        },
      }));

      // Build conversation history from existing messages
      const history: ChatMessage[] = [];
      for (const m of messages) {
        if (m.type === "user") {
          history.push({ role: "user", content: m.content });
        } else if (m.type === "assistant" || m.type === "final") {
          history.push({ role: "assistant", content: m.content });
        } else if (m.type === "tool_result") {
          history.push({
            role: "tool",
            content: JSON.stringify(m.toolResult),
            tool_name: m.toolName,
          });
        }
      }

      // Step 2: Stream from Ollama (backend handles tool execution loop)
      const model = await selectModel("default");

      const stream = await ollamaChatStream(userText, model, {
        history,
        tools: toolDefs,
        think: false,
        maxToolCalls: 5,
      });

      const eventStream = parseOllamaStream(stream);

      let assistantMessageId: string | null = null;
      const toolCallMessageIds = new Map<string, string>();

      for await (const event of eventStream) {
        if (abortControllerRef.current?.signal.aborted) break;

        switch (event.type) {
          case "connected":
            // Stream connected, no UI change needed
            break;

          case "content": {
            const raw =
              typeof event.data === "string"
                ? JSON.parse(event.data)
                : event.data;
            const data = raw as { content?: string; thinking?: string };
            const text = data?.content ?? (typeof event.data === "string" ? event.data : JSON.stringify(event.data));
            if (!assistantMessageId) {
              const newId = Math.random().toString(36).slice(2);
              assistantMessageId = newId;
              setMessages((prev: AgentMessage[]) => [
                ...prev,
                {
                  id: newId,
                  type: "assistant",
                  content: text,
                  timestamp: new Date(),
                },
              ]);
            } else {
              appendToLastMessage(text);
            }
            break;
          }

          case "tool_calls": {
            const calls =
              typeof event.data === "string"
                ? JSON.parse(event.data)
                : (event.data as { tool_calls: Array<{ name: string; arguments: unknown }> });
            const toolCalls = calls.tool_calls || [];

            for (const tc of toolCalls) {
              const toolId = Math.random().toString(36).slice(2);
              toolCallMessageIds.set(tc.name, toolId);

              addMessage({
                type: "tool_call",
                content: `Calling \`${tc.name}\`...`,
                toolName: tc.name,
                toolArgs: tc.arguments as Record<string, unknown>,
              });
            }
            break;
          }
          case "tool_result": {
            const raw =
              typeof event.data === "string"
                ? JSON.parse(event.data)
                : event.data;
            // Backend sends {"name": "...", "result": {...}} for tool results
            const toolName = (raw as any).name || (raw as any).tool_name || "unknown";
            const resultData = (raw as any).result;
            // result may be an ExecuteToolResponse {success, error, result} or raw data
            const execResult: ExecuteToolResponse =
              resultData && typeof resultData === "object" && "success" in resultData
                ? (resultData as ExecuteToolResponse)
                : { success: true, result: resultData };
            const success = execResult.success ?? false;
            const error = execResult.error;

            // Extract media paths for inline rendering
            const mediaUrls = extractMediaPaths(resultData).map((p) => getOutputUrl(p));

            // Find the matching tool_call message to mark as complete
            const toolId = toolCallMessageIds.get(toolName);
            if (toolId) {
              updateLastMessage({
                type: "tool_result",
                content: success
                  ? `Tool \`${toolName}\` completed.`
                  : `Tool \`${toolName}\` failed: ${error || "Unknown error"}`,
                toolName,
                toolResult: {
                  success,
                  error,
                  result: resultData,
                },
                mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
              });
              toolCallMessageIds.delete(toolName);
            } else {
              addMessage({
                type: "tool_result",
                content: success
                  ? `Tool \`${toolName}\` completed.`
                  : `Tool \`${toolName}\` failed: ${error || "Unknown error"}`,
                toolName,
                toolResult: {
                  success,
                  error,
                  result: resultData,
                },
                mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
              });
            }
            break;
          }
          case "done": {
            // Stream complete
            break;
          }

          case "error": {
            const errMsg =
              typeof event.data === "string"
                ? event.data
                : (event.data as { message?: string }).message || "Stream error";
            addMessage({ type: "error", content: errMsg });
            break;
          }
        }

        scrollToBottom();
      }

      setStreaming(false);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!abortControllerRef.current?.signal.aborted) {
        addMessage({ type: "error", content: `Agent error: ${errMsg}` });
      }
      setStreaming(false);
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setStreaming(false);
      }
      scrollToBottom();
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStreaming(false);
    addMessage({ type: "error", content: "Request cancelled." });
  };

  const skillsSummary = skills
    .map((s) => `${s.name} (${s.tools.length} tools)`)
    .join(", ");

  return (
    <Card className="h-full flex flex-col">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              <h2 className="font-semibold">Agent Chat</h2>
            </div>
            {skillsError ? (
              <span className="text-xs text-destructive">Skills load error</span>
            ) : (
              <span className="text-xs text-muted">
                {skillsLoaded ? `${skills.length} skills loaded` : "Loading skills..."}
              </span>
            )}
          </div>
          {skillsSummary && (
            <p className="text-xs text-muted truncate">{skillsSummary}</p>
          )}
        </div>

        {/* Messages */}
        <div
          ref={messagesEndRef}
          className="flex-1 overflow-y-auto p-4 space-y-4 bg-background"
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted">
              <Activity className="w-12 h-12 mb-2 opacity-20" />
              <p>Ask the agent to create visualizations, remix tracks, analyze audio, or plan 3D scenes.</p>
            </div>
          )}
          {messages.map((msg) => {
            const isUser = msg.type === "user";
            const isAssistant = msg.type === "assistant";
            const isToolCall = msg.type === "tool_call";
            const isToolResult = msg.type === "tool_result";
            const isThought = msg.type === "thought";
            const isError = msg.type === "error";
            const isFinal = msg.type === "final";

            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <Card
                  className={`max-w-[85%] p-3 rounded-lg shadow-sm border ${
                    isUser
                      ? "bg-primary text-primary-foreground border-primary"
                      : isError
                      ? "bg-destructive text-destructive-foreground border-destructive"
                      : isToolCall || isToolResult
                      ? "bg-muted text-muted-foreground border-muted/50"
                      : "bg-background text-foreground border-border"
                  }`}
                >
                  {/* Message header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      {isUser && <span className="text-primary">You</span>}
                      {isAssistant && <span className="text-primary">Assistant</span>}
                      {isToolCall && (
                        <>
                          <Wrench className="w-3 h-3" />
                          <span className="text-purple-400">{msg.toolName}</span>
                        </>
                      )}
                      {isToolResult && (
                        <>
                          {(msg.toolResult?.success ? (
                            <CheckCircle className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <AlertCircle className="w-3 h-3 text-destructive" />
                          ))}
                          <span className={`text-xs ${msg.toolResult?.success ? "text-emerald-400" : "text-destructive"}`}>
                            {msg.toolName}
                          </span>
                        </>
                      )}
                      {isThought && (
                        <>
                          <Clock className="w-3 h-3 text-muted/50" />
                          <span className="text-muted">Thinking</span>
                        </>
                      )}
                      {isError && (
                        <>
                          <AlertCircle className="w-3 h-3 text-destructive" />
                          <span className="text-destructive">Error</span>
                        </>
                      )}
                      {isFinal && (
                        <>
                          <CheckCircle className="w-3 h-3 text-primary" />
                          <span className="text-primary">Done</span>
                        </>
                      )}
                      <span className="text-muted/50">· {formatTimestamp(msg.timestamp)}</span>
                    </div>
                    {msg.expanded !== undefined && (
                      <button
                        onClick={() => toggleExpanded(msg.id)}
                        className="p-1 hover:bg-muted/50 rounded text-muted hover:text-primary transition-colors"
                        title={msg.expanded ? "Collapse" : "Expand"}
                      >
                        {msg.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                    )}
                  </div>

                  {/* Message content */}
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

                  {/* Tool result details */}
                  {isToolResult && msg.toolResult && (
                    <div className="mt-2 pt-2 border-t border-muted/30">
                      <div className="flex items-center gap-2 mb-1 text-xs">
                        {msg.toolResult.success ? (
                          <span className="text-emerald-400">✓ Success</span>
                        ) : (
                          <span className="text-destructive">✗ Failed</span>
                        )}
                        {msg.toolResult.error && (
                          <span className="text-muted/70">· {msg.toolResult.error}</span>
                        )}
                      </div>
                      {msg.toolResult.result != null && Boolean(msg.toolResult.result) && (
                        <div className="mt-1">
                          <button
                            onClick={() => toggleExpanded(msg.id)}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            {msg.expanded ? "Hide details" : "Show details"}
                            {msg.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                          {msg.expanded && (
                            <div className="mt-2 p-2 bg-background/50 rounded overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                              {JSON.stringify(msg.toolResult.result, null, 2).slice(0, 1000)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inline media rendering */}
                  {msg.mediaUrls && msg.mediaUrls.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {msg.mediaUrls.map((url, idx) => (
                        <div key={idx} className="rounded-lg overflow-hidden border border-muted/30 bg-background">
                          {isImagePath(url) ? (
                            <img
                              src={url}
                              alt="Generated image"
                              className="w-full h-48 object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="aspect-video bg-muted flex items-center justify-center p-2">
                              <video
                                src={url}
                                className="w-full h-full object-cover"
                                controls
                                preload="metadata"
                              />
                              {!isVideoPath(url) && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                  <VideoIcon className="w-8 h-8 text-muted/50 mb-1" />
                                  <span className="text-xs text-muted">Media: {url.split("/").pop()}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            );
          })}
          {streaming && (
            <div className="flex justify-start">
              <Card className="p-3 bg-muted text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-sm">Agent working…</span>
                <button
                  onClick={handleCancel}
                  className="ml-4 text-xs text-destructive hover:text-destructive/80 underline"
                >
                  Cancel
                </button>
              </Card>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t bg-background">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 px-4 py-2 rounded-lg border bg-muted/30 text-muted-foreground focus:outline-none focus:border-primary"
              disabled={streaming}
              placeholder={streaming ? "Agent working…" : "Ask the agent…"}
            />
            {streaming ? (
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                <StopCircle className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
          <p className="text-xs text-muted mt-1">
            The agent uses Ollama with tool-calling to discover skills,
            execute tools, and iterate until your task is complete.
            Images and videos generated by tools appear inline below.
          </p>
        </div>
      </div>
    </Card>
  );
}
