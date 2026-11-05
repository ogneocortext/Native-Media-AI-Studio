/**
 * AgentChat — Frontend agent that acts on behalf of the user.
 *
 * Uses the agent-loop (runAgentLoop) to:
 * 1. Discover skills from the backend /api/mcp/skills/list endpoint
 * 2. Convert skills into Ollama tool definitions
 * 3. Call ollamaChat with the user's message + tools
 * 4. Execute tool calls via /api/mcp/execute-tool
 * 5. Feed results back and loop until complete
 *
 * Route: /analyze/agent-chat
 */

import { useState, useCallback, useRef } from "react";
import { Send, Loader2, Bot, Wrench, Activity } from "lucide-react";
import { Card } from "../../components/common";
import {
  runAgentLoop,
  type AgentTurn,
  type AgentLoopResult,
  skillsList,
  type SkillInfo,
} from "../../services/api";

interface AgentMessage {
  id: string;
  type: "user" | "assistant" | "tool_call" | "tool_result" | "thought" | "error" | "final";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  timestamp: Date;
}

export function AgentChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load skills on mount
  useState(() => {
    void loadSkills();
  });

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
      setMessages((prev) => [...prev, { ...msg, id, timestamp: new Date() }]);
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input;
    setInput("");
    addMessage({ type: "user", content: userText });

    setLoading(true);

    try {
      const result: AgentLoopResult = await runAgentLoop(userText, {
        model: "qwen3.5:4b",
        maxIterations: 10,
        onTurn: (turn: AgentTurn) => {
          switch (turn.type) {
            case "thought":
              addMessage({ type: "thought", content: turn.content });
              break;
            case "tool_call":
              addMessage({
                type: "tool_call",
                content: `Calling \`${turn.toolName}\`...`,
                toolName: turn.toolName,
                toolArgs: turn.toolArgs,
              });
              break;
            case "tool_result": {
              const success = turn.toolResult?.success ?? false;
              const content = success
                ? `Tool \`${turn.toolName}\` completed.`
                : `Tool \`${turn.toolName}\` failed: ${turn.toolResult?.error}`;
              addMessage({
                type: "tool_result",
                content,
                toolName: turn.toolName,
                toolResult: turn.toolResult,
              });
              break;
            }
            case "final":
              addMessage({ type: "final", content: turn.content });
              break;
            case "error":
              addMessage({ type: "error", content: turn.content });
              break;
          }
          // Scroll after state update
          setTimeout(scrollToBottom, 50);
        },
      });

      // If the loop didn't emit a "final" turn (e.g. error), show the result
      if (!result.success && result.finalResponse) {
        const hasFinal = messages.some((m) => m.type === "final");
        if (!hasFinal) {
          addMessage({ type: "final", content: result.finalResponse });
        }
      }
    } catch (err) {
      addMessage({
        type: "error",
        content: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
      scrollToBottom();
    }
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
            return (
              <div key={msg.id} className={isUser ? "flex justify-end" : "flex justify-start"}>
                <Card className={`max-w-[85%] p-3 rounded-lg ${
                  isUser
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {msg.type === "tool_call" && (
                    <div className="flex items-start gap-2 mb-2 text-xs text-muted/70">
                      <Wrench className="w-3 h-3" />
                      <span>🔧 {msg.toolName}</span>
                    </div>
                  )}
                  {msg.type === "tool_result" && msg.toolResult && (
                    <div className="mb-2">
                      {msg.toolResult.success ? (
                        <span className="text-xs text-emerald-400">✓</span>
                      ) : (
                        <span className="text-xs text-destructive">✗</span>
                      )}
                      <span className="ml-1 text-xs">
                        {msg.toolResult.error ? `Error: ${msg.toolResult.error}` : "Completed"}
                      </span>
                    </div>
                  )}
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.type === "tool_result" && msg.toolResult?.result && msg.toolResult.success && (
                    <div className="mt-2 p-2 bg-background/50 rounded text-xs text-muted overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(msg.toolResult.result, null, 2).slice(0, 500)}
                    </div>
                  )}
                </Card>
              </div>
            );
          })}
          {loading && (
            <div className="flex justify-start">
              <Card className="p-3 bg-muted text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-sm">Agent thinking...</span>
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
              disabled={loading}
              placeholder={loading ? "Agent working…" : "Ask the agent…"}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <p className="text-xs text-muted mt-1">
            The agent uses Ollama (qwen3.5:4b) with tool-calling to discover skills, execute tools, and iterate until your task is complete.
          </p>
        </div>
      </div>
    </Card>
  );
}
