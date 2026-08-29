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
    onMessageOrUseTools?: ((msg: StreamMessage) => void) | boolean,
    useToolsArg?: boolean,
  ) => {
    setGenerating(true);
    setOutput("");
    const controller = new AbortController();
    abortRef.current = controller;

    // Handle overloaded signature: (prompt, model, systemPrompt, useTools) or (prompt, model, systemPrompt, onMessage, useTools)
    let onMessage: ((msg: StreamMessage) => void) | undefined;
    let useTools: boolean | undefined;
    if (typeof onMessageOrUseTools === "function") {
      onMessage = onMessageOrUseTools;
      useTools = useToolsArg;
    } else if (typeof onMessageOrUseTools === "boolean") {
      useTools = onMessageOrUseTools;
    }

    try {
      const stream = await ollamaChatStream(
        prompt,
        model,
        { system: systemPrompt, think: false, tools: useTools },
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
