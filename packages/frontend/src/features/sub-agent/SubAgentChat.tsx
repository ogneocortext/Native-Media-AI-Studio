/**
 * SubAgentChat - Frontend interface for the local Qwen sub-agent.
 *
 * Users submit natural-language tasks (e.g. "run the ruff gate and report results")
 * and the agent autonomously executes tools (read_file, grep_search, run_gates,
 * run_pytest, run_cmd) streaming its ReAct loop back in real time via SSE.
 */

import { useState, useEffect, useRef } from "react";
import { Loader2, Bot, Wrench, Shield, AlertCircle, ChevronDown, Play, StopCircle } from "lucide-react";
import { Card } from "../../components/common";
import {
  runSubAgentTask,
  listSubAgentTasks,
  subscribeToSubAgentStream,
  type SubAgentTask,
  type SubAgentEvent,
} from "../../services/api";

export function SubAgentChat() {
  const [tasks, setTasks] = useState<SubAgentTask[]>([]);
  const [iterations, setIterations] = useState<{ id: string; text: string; type: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("qwen3.5:4b");
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const iterationsEndRef = useRef<HTMLDivElement>(null);

  // Load available tasks on mount
  useEffect(() => {
    let cancelled = false;
    listSubAgentTasks()
      .then(({ tasks: t }) => {
        if (!cancelled) setTasks(t);
      })
      .catch(() => {
        // Tasks list is optional; ignore failures
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    iterationsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [iterations]);

  // Clean up EventSource on unmount
  useEffect(() => {
  return () => {
    // Don't close the EventSource here — React 18 StrictMode mounts/unmounts/
    // remounts components in development, which would close the SSE connection
    // before the task completes. The backend closes the connection when the
    // task finishes (agent_done event). The EventSource is also cleaned up
    // when the page unloads or the user navigates away.
    if (abortRef.current) abortRef.current.abort();
  };
  }, []);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const taskText = input.trim();
    setInput("");
    setLoading(true);
    setIterations([]);

    try {
      const response = await runSubAgentTask({ task: taskText, model: selectedModel });
      const taskId = response.task_id;

      // Add initial task entry
      setTasks((prev) => [
        {
          task_id: taskId,
          status: "running",
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      // Open SSE stream for real-time output
      const controller = new AbortController();
      abortRef.current = controller;

      const es = subscribeToSubAgentStream(
        taskId,
        (event: SubAgentEvent) => {
          if (controller.signal.aborted) return;

          if (event.type === "agent_output") {
            const data = event.data as { text?: string };
            setIterations((prev) => [
              ...prev,
              { id: crypto.randomUUID(), text: data.text || "", type: "output" },
            ]);
          } else if (event.type === "agent_done") {
            const data = event.data as { result?: string };
            setIterations((prev) => [
              ...prev,
              { id: crypto.randomUUID(), text: `\n✅ Task completed.\n\nResult:\n${data.result || "(no output)"}`, type: "done" },
            ]);
            setLoading(false);
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }
            // Refresh task list
            listSubAgentTasks()
              .then(({ tasks: t }) => setTasks(t))
              .catch(() => {});
          } else if (event.type === "agent_error") {
            const data = event.data as { error?: string };
            setIterations((prev) => [
              ...prev,
              { id: crypto.randomUUID(), text: `\n❌ Task failed: ${data.error || "unknown error"}`, type: "error" },
            ]);
            setLoading(false);
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }
          } else if (event.type === "error") {
            setIterations((prev) => [
              ...prev,
              { id: crypto.randomUUID(), text: `\n⚠️ Stream error`, type: "error" },
            ]);
            setLoading(false);
          }
        },
  (err: Event) => {
    console.log("[sub-agent] onError callback:", err);
    setLoading(false);
  },
      );

      eventSourceRef.current = es;
    } catch (err) {
      setIterations((prev) => [
        ...prev,
        { id: crypto.randomUUID(), text: `❌ Failed to start task: ${err instanceof Error ? err.message : "unknown error"}`, type: "error" },
      ]);
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setIterations((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: "\n⏹️ Task cancelled by user.", type: "error" },
    ]);
  };

  const formatIterationText = (text: string, type: string) => {
    // Simple formatting: show tool call headers in a compact way
    if (type === "done") return text;
    if (type === "error") return text;
    return text;
  };

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-0px)] max-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Local Qwen Sub-Agent</h1>
          <p className="text-sm text-muted mt-1">
            Chat with a local Qwen-powered agent that can run gates, read files,
            search code, and run tests on your repository.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={loading}
              className="appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-16 text-sm text-white focus:outline-none focus:border-violet-500"
            >
              <option value="qwen3.5:4b">qwen3.5:4b (loaded)</option>
              <option value="qwen3:8b">qwen3:8b</option>
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
              <Shield size={10} className="text-green-400" />
              <ChevronDown size={14} className="text-muted" />
            </div>
          </div>
          <span className="text-xs text-muted px-2 py-1 bg-white/10 rounded border border-white/5">
            {loading ? "Running…" : "Idle"}
          </span>
        </div>
      </div>

      {/* Task Input */}
      <Card className="shrink-0">
        <div className="p-4">
          <form onSubmit={handleSend} className="flex items-center gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="e.g. 'run the ruff gate on the backend and report any violations' or 'read packages/backend/tests/conftest.py and report the fixture scope'"
              disabled={loading}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-muted focus:outline-none focus:border-violet-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <StopCircle size={16} onClick={handleCancel} />
              ) : (
                <Play size={16} />
              )}
            </button>
          </form>
          {loading && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" />
              <span>Agent is running tools…</span>
            </div>
          )}
        </div>
      </Card>

      {/* Output */}
      <Card className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {iterations.length === 0 && (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <Bot size={40} className="text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-muted">Submit a task to get started</p>
                <p className="text-xs text-muted mt-1">Examples:</p>
                <ul className="text-left mt-1 space-y-1 text-xs">
                  <li>"run the ruff gate on the backend and report violations"</li>
                  <li>"read packages/backend/tests/conftest.py and report fixture scope"</li>
                  <li>"grep for init_db across the backend tests directory"</li>
                  <li>"run pytest on test_audio_file_size.py and report results"</li>
                </ul>
              </div>
            </div>
          )}
          {iterations.map((item) => (
            <div
              key={item.id}
              className={`flex gap-3 ${item.type === "done" || item.type === "error" ? "justify-start" : ""}`}
            >
              {item.type === "output" && (
                <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center shrink-0">
                  <Wrench size={16} className="text-white" />
                </div>
              )}
              {item.type === "done" && (
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
                  <Shield size={16} className="text-white" />
                </div>
              )}
              {item.type === "error" && (
                <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
                  <AlertCircle size={16} className="text-white" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                  item.type === "output"
                    ? "bg-white/5 text-gray-200 border border-white/5"
                    : item.type === "done"
                    ? "bg-emerald-500/10 text-emerald-100 border border-emerald-500/30"
                    : "bg-red-500/10 text-red-100 border border-red-500/30"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{formatIterationText(item.text, item.type)}</p>
                <p className="text-[10px] text-muted mt-1">
                  {new Date().toLocaleTimeString()} · {item.type}
                </p>
              </div>
              {item.type === "output" && (
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                  <Bot size={16} className="text-white" />
                </div>
              )}
            </div>
          ))}
          <div ref={iterationsEndRef} />
        </div>
      </Card>

      {/* Recent tasks sidebar (compact) */}
      {tasks.length > 0 && (
        <div className="mt-4 shrink-0">
          <Card>
            <div className="p-3">
              <h3 className="text-sm font-semibold text-white mb-2">Recent tasks</h3>
              <ul className="space-y-1">
                {tasks.slice(0, 5).map((t) => (
                  <li key={t.task_id} className="text-xs flex justify-between items-center">
                    <span className="text-gray-300 truncate max-w-[200px]">{t.task_id}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        t.status === "completed"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : t.status === "failed"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-white/10 text-gray-400"
                      }`}
                    >
                      {t.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
