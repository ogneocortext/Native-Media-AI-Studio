/**
 * MessageList — renders the conversation in the center chat column.
 *
 * Empty state shows suggested prompts inside the message area. Assistant
 * messages render SimpleMarkdown; tool details and thinking blocks render
 * inline. A "generating" placeholder shows while streaming.
 */

import { useCallback } from "react";
import { Bot, Copy, MessageCircle, RotateCw, User, Volume2, Zap, Brain } from "lucide-react";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { DS } from "../../styles/designSystem";
import type { Message } from "./useAIChat";

interface MessageListProps {
  messages: Message[];
  selectedModel: string | null;
  generating: boolean;
  onRegenerate: (message: Message) => void;
  onCopy: (text: string) => void;
  onSpeak: (text: string) => void;
  onPromptSuggestion: (text: string) => void;
}

const SUGGESTED_PROMPTS = [
  "Summarize my current project structure",
  "Help me plan a beat-synced music video",
  "Analyze the latest audio track",
  "Generate a visualizer preset for this track",
  "Explain the remix mashup workflow",
];

export function MessageList({
  messages,
  selectedModel,
  generating,
  onRegenerate,
  onCopy,
  onSpeak,
  onPromptSuggestion,
}: MessageListProps) {
  const handleSpeak = useCallback(
    (text: string) => {
      void onSpeak(text);
    },
    [onSpeak],
  );

  return (
    <div className="flex-1 min-h-[300px] max-h-[600px] overflow-y-auto space-y-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700/50">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <MessageCircle size={32} className="mb-3 opacity-30" />
          <p>Start a conversation with your AI model</p>
          <p className="text-xs mt-1 opacity-50">
            {selectedModel ? "Type a message below" : "Select a model and type a message below"}
          </p>
          <div className="flex flex-col gap-2 mt-6 w-full max-w-xs mx-auto">
            {SUGGESTED_PROMPTS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => void onPromptSuggestion(suggestion)}
                className="w-full text-left px-3 py-1.5 text-xs rounded bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center gap-1 whitespace-nowrap"
              >
                <Bot size={10} className="text-amber-400 shrink-0" />
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
            {msg.role === "user" ? (
              <User size={14} className="text-gray-400" />
            ) : (
              <Bot size={14} className="text-violet-400" />
            )}
          </div>
          <div
            className={`flex-1 max-w-[85%] ${msg.role === "user" ? "text-right" : "text-left"}`}
          >
            <div
              className={`inline-block p-3 rounded-lg ${
                msg.role === "user"
                  ? "bg-violet-600 text-white"
                  : "bg-gray-700 border border-gray-600 text-foreground"
              }`}
            >
              {msg.role === "assistant" && msg.model && (
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] text-violet-300 font-medium">{msg.model}</span>
                  <button
                    onClick={() => onRegenerate(msg)}
                    disabled={generating}
                    className="text-[10px] text-gray-400 hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-600"
                    title="Regenerate"
                  >
                    <RotateCw size={10} />
                  </button>
                  <button
                    onClick={() => onCopy(msg.content)}
                    className="text-[10px] text-gray-400 hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-600"
                    title="Copy"
                  >
                    <Copy size={10} />
                  </button>
                  <button
                    onClick={() => void handleSpeak(msg.content)}
                    className="text-[10px] text-gray-400 hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-600"
                    title="Read aloud"
                  >
                    <Volume2 size={10} />
                  </button>
                </div>
              )}
              {msg.role === "assistant" ? (
                <SimpleMarkdown content={msg.content} />
              ) : (
                <div className="whitespace-pre-wrap break-words text-sm">{msg.content}</div>
              )}
              {msg.role === "assistant" && msg.thinking && !generating && (
                <div className="mt-2 pt-2 border-t border-gray-600/50">
                  <button
                    onClick={() => {
                      onRegenerate(msg);
                    }}
                    className="text-[10px] text-purple-300 hover:text-purple-200 flex items-center gap-1"
                  >
                    {msg.showThinking ? "Hide thinking" : "Show thinking"}
                    <Brain size={10} />
                  </button>
                  {msg.showThinking && (
                    <div className="mt-1 p-2 bg-gray-800/50 rounded text-[11px] text-purple-200 italic whitespace-pre-wrap">
                      {msg.thinking}
                    </div>
                  )}
                </div>
              )}
              {msg.role === "assistant" && msg.toolDetails && msg.toolDetails.length > 0 && (
                <div className="mt-3 space-y-2">
                  {msg.toolDetails.map((tc, i) => (
                    <div key={i} className="p-2 bg-gray-800/50 rounded border border-gray-600/30">
                      <div className="flex items-center gap-2 mb-1">
                        <Zap size={12} className="text-amber-400 shrink-0" />
                        <span className="text-xs text-amber-300 font-medium">{tc.name}</span>
                        <span
                          className={`ml-auto text-[10px] ${
                            tc.status === "calling"
                              ? "text-violet-300 animate-pulse"
                              : "text-green-400"
                          }`}
                        >
                          {tc.status === "calling" ? "calling…" : "done"}
                        </span>
                      </div>
                      <pre className={DS.mono + " overflow-auto"}>
                        {JSON.stringify(tc.arguments, null, 2)}
                      </pre>
                      {tc.result && (
                        <div className="mt-1 p-1.5 bg-green-900/10 border border-green-900/20 rounded text-[11px] text-green-300">
                          {tc.result}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {generating && (
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
            <Bot size={14} className="text-violet-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-violet-300 font-medium">{selectedModel}</span>
              <span className="text-[10px] text-purple-300 animate-pulse">Thinking…</span>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-3 h-3 bg-gray-600 rounded-full animate-pulse"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
