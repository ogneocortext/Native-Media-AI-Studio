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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;
          const lines = eventStr.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const msg: StreamMessage = parseOllamaEvent(parsed);
                onMessage?.(msg);
                if (msg.type === "content") {
                  setOutput((prev) => prev + msg.data);
                }
              } catch {
                // skip malformed events
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
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

function parseOllamaEvent(parsed: any): StreamMessage {
  if (parsed.response) return { type: "content", data: parsed.response };
  if (parsed.message?.content) return { type: "content", data: parsed.message.content };
  if (parsed.done) return { type: "done", data: null };
  if (parsed.error) return { type: "error", data: parsed.error };
  if (parsed.tool_calls) return { type: "tool_calls", data: parsed.tool_calls };
  return { type: "content", data: "" };
}
