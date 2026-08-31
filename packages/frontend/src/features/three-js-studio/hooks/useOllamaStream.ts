import { useState, useCallback, useRef, useEffect } from "react";
import { ollamaChatStream } from "../../../services/api";

export interface StreamMessage {
  type: "content" | "tool_calls" | "done" | "connected" | "error";
  data: any;
}

export function useOllamaStream() {
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState("");
  const outputRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  // Sync ref to state less frequently to reduce re-renders during streaming
  const syncTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    syncTimer.current = setInterval(() => {
      setOutput(outputRef.current);
    }, 200);
    return () => {
      if (syncTimer.current) clearInterval(syncTimer.current);
    };
  }, []);

  const generate = useCallback(async (
    prompt: string,
    model: string,
    systemPrompt?: string,
    ollamaOptionsOrUseTools?: Record<string, unknown> | ((msg: StreamMessage) => void) | boolean,
    onMessageOrUseTools?: ((msg: StreamMessage) => void) | boolean,
    useToolsArg?: boolean,
  ) => {
    setGenerating(true);
    setOutput("");
    const controller = new AbortController();
    abortRef.current = controller;

    // Handle overloaded signatures:
    // 1) generate(prompt, model, system, useTools)
    // 2) generate(prompt, model, system, ollamaOptions, useTools)
    // 3) generate(prompt, model, system, ollamaOptions, onMessage, useTools)
    // 4) generate(prompt, model, system, onMessage, useTools)
    let ollamaOptions: Record<string, unknown> | undefined;
    let onMessage: ((msg: StreamMessage) => void) | undefined;
    let useTools: boolean | undefined;

    const isOllamaOptions = (v: unknown): boolean => {
      if (!v || typeof v !== "object" || Array.isArray(v)) return false;
      const keys = ["temperature", "top_p", "top_k", "num_predict", "repeat_penalty", "num_ctx", "seed", "stop"];
      return keys.some((k) => k in (v as Record<string, unknown>));
    };

    if (isOllamaOptions(ollamaOptionsOrUseTools)) {
      ollamaOptions = ollamaOptionsOrUseTools as Record<string, unknown>;
      if (typeof onMessageOrUseTools === "function") {
        onMessage = onMessageOrUseTools;
        useTools = useToolsArg;
      } else if (typeof onMessageOrUseTools === "boolean") {
        useTools = onMessageOrUseTools;
      }
    } else if (typeof ollamaOptionsOrUseTools === "function") {
      onMessage = ollamaOptionsOrUseTools;
      useTools = onMessageOrUseTools as boolean | undefined;
    } else if (typeof ollamaOptionsOrUseTools === "boolean") {
      useTools = ollamaOptionsOrUseTools;
    } else if (ollamaOptionsOrUseTools && typeof ollamaOptionsOrUseTools === "object") {
      // fallback: treat any plain object as options if not matched above but looks like options
      // avoid misclassifying; only if next arg is function/boolean
      if (typeof onMessageOrUseTools === "function" || typeof onMessageOrUseTools === "boolean" || onMessageOrUseTools === undefined) {
        ollamaOptions = ollamaOptionsOrUseTools as Record<string, unknown>;
        if (typeof onMessageOrUseTools === "function") {
          onMessage = onMessageOrUseTools;
          useTools = useToolsArg;
        } else if (typeof onMessageOrUseTools === "boolean") {
          useTools = onMessageOrUseTools;
        }
      }
    }

    try {
      const stream = await ollamaChatStream(
        prompt,
        model,
        { system: systemPrompt, think: false, tools: useTools, ...(ollamaOptions || {}) },
        controller.signal,
      );
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            lastEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              let msg: StreamMessage | null = null;

              if (lastEvent === "content") {
                const content = data.content || "";
                if (content) {
                  msg = { type: "content", data: content };
                  outputRef.current += content;
                }
              } else if (lastEvent === "done") {
                // Final sync to state before completing
                setOutput(outputRef.current);
                msg = { type: "done", data };
                onMessage?.(msg);
                return; // Stream complete
              } else if (lastEvent === "tool_calls") {
                msg = { type: "tool_calls", data };
              } else if (lastEvent === "connected") {
                msg = { type: "connected", data };
              } else if (lastEvent === "error") {
                msg = { type: "error", data };
              }

              if (msg) onMessage?.(msg);
            } catch {
              // skip malformed events
            }
          }
        }
      }
    } catch (err: any) {
      // Don't treat aborted or incomplete streams as fatal errors
      if (err.name === "AbortError") {
        // User cancelled - keep what we have
      } else if (err.name === "TypeError" && err.message.includes("network")) {
        // Network error mid-stream - we may have partial content
        console.warn("Stream interrupted, using partial content");
      } else if (err.name !== "AbortError") {
        setOutput((prev) => prev + `\n\nError: ${err.message}`);
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, []);

  return { generate, cancel, generating, output, getOutput: () => outputRef.current };
}
