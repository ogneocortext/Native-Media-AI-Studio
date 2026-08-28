import { useState, useCallback, useRef } from "react";
import { ollamaChatStream } from "../../../services/api";

export interface StreamMessage {
  type: "content" | "tool_calls" | "done" | "connected" | "error";
  data: any;
}

export function useOllamaStream() {
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (
    prompt: string,
    model: string,
    systemPrompt?: string,
    onMessage?: (msg: StreamMessage) => void,
  ) => {
    setGenerating(true);
    setOutput("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const stream = await ollamaChatStream(
        prompt,
        model,
        { system: systemPrompt, think: false },
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
                  setOutput((prev) => prev + content);
                }
              } else if (lastEvent === "done") {
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

  return { generate, cancel, generating, output };
}
