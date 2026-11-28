/**
 * ToolExecutionLog — collapsible tool-execution log inside the chat column.
 *
 * Part of the conversation's story, not a separate district. Shows each tool
 * call with its arguments and result.
 */

import { useState } from "react";
import { Zap } from "lucide-react";
import { DS } from "../../styles/designSystem";
import type { Message } from "./useAIChat";

interface ToolExecutionLogProps {
  messages: Message[];
}

export function ToolExecutionLog({ messages }: ToolExecutionLogProps) {
  const [open, setOpen] = useState(false);

  const toolMessages = messages.filter(
    (m) => m.role === "assistant" && m.toolDetails && m.toolDetails.length > 0,
  );

  if (toolMessages.length === 0) return null;

  return (
    <details
      className="mt-4 bg-gray-800/30 rounded-lg border border-gray-700/50"
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <summary className="cursor-pointer flex items-center justify-between p-3 text-xs font-medium text-muted hover:text-white">
        <span className="flex items-center gap-1">
          <Zap size={12} className="text-amber-400" />
          Tool Execution
        </span>
        <span>{open ? "hide" : "show"}</span>
      </summary>
      <div className="p-3 space-y-3">
        {toolMessages.flatMap((msg, mi) =>
          msg.toolDetails?.map((tc, i) => (
            <div key={`${mi}-${i}`} className="p-2 bg-gray-800/50 rounded border border-gray-600/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-amber-300 font-medium">{tc.name}</span>
                <span
                  className={`text-[10px] ${
                    tc.status === "calling" ? "text-violet-300 animate-pulse" : "text-green-400"
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
          )),
        )}
      </div>
    </details>
  );
}
