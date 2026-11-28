/**
 * PromptInput — the message input card, pinned to the bottom of the chat
 * column. Sends on Ctrl+Enter. Shows Cancel while generating.
 */

import { useCallback, useRef } from "react";
import { Loader2, Send, StopCircle } from "lucide-react";
import { DS } from "../../styles/designSystem";

interface PromptInputProps {
  prompt: string;
  setPrompt: (v: string) => void;
  generating: boolean;
  selectedModel: string | null;
  onSend: () => void;
  onCancel: () => void;
}

export function PromptInput({
  prompt,
  setPrompt,
  generating,
  selectedModel,
  onSend,
  onCancel,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        void onSend();
      }
    },
    [onSend],
  );

  return (
    <div className={DS.card}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className={DS.textarea + " pr-12"}
          rows={3}
          placeholder={selectedModel ? `Message ${selectedModel}…` : "Select a model first…"}
          onKeyDown={handleKeyDown}
          disabled={generating || !selectedModel}
        />
      </div>
      <div className={DS.flexBetween + " mt-2"}>
        <span className={DS.textXs}>
          {prompt.length} / 4000 characters · Ctrl+Enter to send
        </span>
        <div className="flex gap-2">
          {generating && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center gap-1"
            >
              <StopCircle size={16} className="text-red-400" />
              Cancel
            </button>
          )}
          <button
            onClick={onSend}
            disabled={generating || !prompt.trim() || !selectedModel}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {generating ? (
              <>
                <Loader2 size={16} className={DS.loading} />
                Generating…
              </>
            ) : (
              <>
                <Send size={16} />
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
