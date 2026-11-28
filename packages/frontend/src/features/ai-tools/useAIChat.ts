/**
 * useAIChat — all chat state and streaming handling for the AI Tools page.
 *
 * Extracted from AIToolsPage.tsx (Item 5: size-ceiling duty). Owns the
 * conversation lifecycle: message list, stream status, tool-calling loop,
 * history, cancel, regenerate, copy, and clear. Model selection, benchmarks,
 * tool registry, and video extraction remain with the page orchestrator /
 * right rail.
 */

import { useCallback, useRef, useState } from "react";
import { ollamaChatStream, type OllamaModel, type ToolDefinition } from "../../services/api";
import { parseOllamaStream } from "../../services/api/ollama";
import type { VisualizationConfig } from "./VisualizationCanvas";

export interface Message {
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

export interface HistoryEntry {
  prompt: string;
  response: string;
  model: string;
  toolCalls: number;
  timestamp: Date;
}

export interface UseAIChatProps {
  models: OllamaModel[];
  selectedModel: string | null;
  tools: {
    id: string;
    name: string;
    description: string;
    parameters: unknown;
  }[];
  enabledTools: Set<string>;
  onVizConfig?: (config: VisualizationConfig | null) => void;
}

export function useAIChat({
  models,
  selectedModel,
  tools,
  enabledTools,
  onVizConfig,
}: UseAIChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [streamStatus, setStreamStatus] = useState<
    "idle" | "connecting" | "thinking" | "executing_tool" | "streaming_response" | "done"
  >("idle");
  const [toolStep, setToolStep] = useState(0);
  const [totalToolSteps, setTotalToolSteps] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<
    { time: string; event: string; detail: string }[]
  >([]);
  const [showStreamDetails, setShowStreamDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const logStreamEvent = useCallback((event: string, detail: string) => {
    const time = new Date().toLocaleTimeString();
    setStreamEvents((prev) => [...prev, { time, event, detail }]);
  }, []);

  const convertToToolDefinitions = useCallback((): ToolDefinition[] => {
    return tools
      .filter((t) => enabledTools.has(t.id))
      .map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as ToolDefinition["function"]["parameters"],
        },
      }));
  }, [tools, enabledTools]);

  const handleGenerate = useCallback(
    async (contentOverride?: string) => {
      const content = (contentOverride ?? "").trim();
      if (!content) return;
      if (!selectedModel) return;
      setGenerating(true);
      setError(null);
      setStreamStatus("connecting");
      setToolStep(0);
      setTotalToolSteps(0);
      setCurrentTool(null);
      setStreamEvents([]);
      logStreamEvent("connecting", "Opening stream to model…");

      const supportsTools = models.find((m) => m.name === selectedModel)?.supportsTools;
      const activeTools = supportsTools ? convertToToolDefinitions() : [];

      const controller = new AbortController();
      abortRef.current = controller;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

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
          content,
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
        const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];

        for await (const event of parseOllamaStream(stream)) {
          if (controller.signal.aborted) break;
          if (event.type === "content") {
            const data = event.data as { content: string; thinking?: string };
            fullResponse += data.content;
            setStreamStatus("streaming_response");
            logStreamEvent("content", data.content.slice(0, 80));
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: fullResponse } : m)),
            );
            if (data.thinking) {
              fullThinking += data.thinking;
              setStreamStatus("thinking");
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, thinking: fullThinking } : m)),
              );
            }
          } else if (event.type === "tool_calls") {
            const data = event.data as {
              tool_calls: { name: string; arguments: Record<string, unknown> }[];
            };
            setStreamStatus("executing_tool");
            for (const tc of data.tool_calls) {
              toolDetails.push({ ...tc, status: "calling" });
              toolCalls.push({ name: tc.name, arguments: tc.arguments });
              setToolStep((s) => s + 1);
              setCurrentTool(tc.name);
              logStreamEvent(
                "tool_call",
                `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)})`,
              );
            }
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, toolDetails: [...toolDetails] } : m)),
            );
          } else if (event.type === "tool_result") {
            const data = event.data as { name: string; result: string };
            setStreamStatus("streaming_response");
            logStreamEvent("tool_result", `${data.name} → ok`);
            const target = toolDetails.find((t) => t.name === data.name && t.status === "calling");
            if (target) {
              target.result = data.result;
              target.status = "done";
            }
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, toolDetails: [...toolDetails] } : m)),
            );
            if (data.name === "generate_visualization") {
              try {
                const cfg = JSON.parse(data.result) as Partial<VisualizationConfig> | null;
                if (cfg?.style && cfg.colors) {
                  const viz = cfg as VisualizationConfig;
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, vizConfig: viz } : m)),
                  );
                  onVizConfig?.(viz);
                }
              } catch {
                /* result was not a visualization config */
              }
            }
          } else if (event.type === "error") {
            const data = event.data as { message?: string };
            setStreamStatus("idle");
            throw new Error(data.message ?? "Ollama returned no response");
          }
        }

        setStreamStatus("done");
        logStreamEvent("done", `Stream finished (${fullResponse.length} chars)`);

        if (fullResponse) {
          setHistory((prev) => [
            {
              prompt: content,
              response: fullResponse,
              model: selectedModel,
              toolCalls: toolDetails.length,
              timestamp: new Date(),
            },
            ...prev.slice(0, 19),
          ]);
        }
      } catch (e: unknown) {
        setStreamStatus("idle");
        if (e instanceof Error && e.name === "AbortError") {
          setError("Generation cancelled");
        } else {
          setError(e instanceof Error ? e.message : "Failed to generate response");
        }
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [selectedModel, models, convertToToolDefinitions, logStreamEvent, onVizConfig],
  );

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setStreamStatus("idle");
      logStreamEvent("abort", "Stream aborted by user");
    }
  }, [logStreamEvent]);

  const handleNewChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setHistory([]);
    setError(null);
    setGenerating(false);
    setStreamStatus("idle");
    setStreamEvents([]);
    abortRef.current = null;
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setStreamEvents([]);
    setStreamStatus("idle");
  }, []);

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const handleRegenerate = useCallback(
    (message: Message) => {
      if (message.role !== "assistant") return;
      const idx = messages.findIndex((m) => m.id === message.id);
      if (idx === -1) return;
      const userMsg = messages.at(idx - 1);
      if (userMsg?.role !== "user") return;
      setMessages((prev) => prev.slice(0, idx));
      setGenerating(true);
      void handleGenerate(userMsg.content);
    },
    [messages, selectedModel, handleGenerate],
  );

  return {
    // State
    messages,
    generating,
    error,
    history,
    streamStatus,
    toolStep,
    totalToolSteps,
    currentTool,
    streamEvents,
    showStreamDetails,
    setShowStreamDetails,
    // Handlers
    handleGenerate,
    handleCancel,
    handleNewChat,
    handleClear,
    handleCopy,
    handleRegenerate,
    setStreamStatus,
  };
}
