/**
 * AIToolsPage — orchestrator for the AI Tools page (/analyze/ai).
 *
 * Layout (Item 1 + Item 2):
 *   - Center column: chat owns the center — slim header, message list,
 *     collapsible tool-execution log, streaming status banner, input pinned
 *     to bottom.
 *   - Right rail (sticky): Model / Tools / Templates tabs.
 *
 * Chat state + streaming live in useAIChat.ts. This file owns orchestration
 * state (models, benchmarks, tool registry, video extraction, history,
 * tool editor) and wires everything together.
 *
 * Item 5: kept under the 1,000-line ceiling by extracting chat into
 * useAIChat and layout into ChatHeader / MessageList / PromptInput /
 * ToolExecutionLog / RightRail.
 */

import { useEffect, useState } from "react";
import { StopCircle } from "lucide-react";
import { useAIChat, type HistoryEntry } from "./useAIChat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { ToolExecutionLog } from "./ToolExecutionLog";
import { RightRail } from "./RightRail";
import { ToolEditor } from "./ToolEditor";
import { VisualizationCard } from "./VisualizationCard";
import { StreamStatusBanner } from "./StreamStatusBanner";
import { DS } from "../../styles/designSystem";
import {
  getOllamaModels,
  getBenchmarkResults,
  runBenchmark,
  runCodingBenchmark,
  getTaskModelRoutes,
  uploadAudioFile,
  type OllamaModel,
  type OllamaBenchmarkResult,
} from "../../services/api";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { useSpeakAloud } from "../../hooks/useSpeakAloud";
import type { VisualizationConfig } from "./VisualizationCanvas";
import type { Tool } from "./types";

export function AIToolsPage() {
  // ---- Orchestration state ----
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());
  const [showToolEditor, setShowToolEditor] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [toolJsonValid, setToolJsonValid] = useState(true);
  const [benchmarks, setBenchmarks] = useState<Record<string, OllamaBenchmarkResult | undefined>>(
    {},
  );
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [codingBenchmarkRunning, setCodingBenchmarkRunning] = useState(false);
  const [taskRoutes, setTaskRoutes] = useState<{
    routes: Record<string, { engine: string; model: string; reason: string }>;
    excluded_from_chat: string[];
  } | null>(null);
  const [extractRunning, setExtractRunning] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<{
    filename: string;
    relative_path: string;
    stored_path: string;
    size_bytes: number;
    message: string;
    converted: boolean | undefined;
    source_filename: string | null | undefined;
    lossless: boolean | undefined;
  } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [vizConfig, setVizConfig] = useState<VisualizationConfig | null>(null);
  const [prompt, setPrompt] = useState("");

  const { refresh: refreshLibrary } = useAudioLibrary();
  const speakAloud = useSpeakAloud();

  // ---- Chat hook ----
  const {
    messages,
    generating,
    error,
    streamStatus,
    toolStep,
    totalToolSteps,
    currentTool,
    streamEvents,
    showStreamDetails,
    setShowStreamDetails,
    handleGenerate,
    handleCancel,
    handleNewChat: handleNewChatHook,
    handleClear: handleClearHook,
    handleCopy,
    handleRegenerate,
  } = useAIChat({
    models,
    selectedModel,
    tools,
    enabledTools,
    onVizConfig: setVizConfig,
  });

  // ---- Load models + benchmarks + task routes ----
  useEffect(() => {
    void loadModels(true);
  }, []);

  const loadModels = async (verifiedOnly: boolean) => {
    try {
      const modelList = await getOllamaModels(verifiedOnly);
      const enhanced = modelList.map((m) => ({
        ...m,
        supportsTools: m.capabilities?.includes("tools") ?? false,
        supportsVision: m.capabilities?.includes("vision") ?? false,
        supportsThinking: m.capabilities?.includes("thinking") ?? false,
      }));

      let benchMap: Record<string, OllamaBenchmarkResult | undefined> = {};
      const [sceneRes, routesRes] = await Promise.allSettled([
        getBenchmarkResults(),
        getTaskModelRoutes().catch(() => null),
      ]);
      if (sceneRes.status === "fulfilled") {
        benchMap = sceneRes.value.results;
        setBenchmarks(benchMap);
      }
      if (routesRes.status === "fulfilled" && routesRes.value) {
        setTaskRoutes(routesRes.value);
      }

      const sorted = [...enhanced].sort((a, b) => {
        if (a.verified !== b.verified) return a.verified ? -1 : 1;
        const sa = a.benchmark?.score ?? benchMap[a.name]?.validation.score ?? -1;
        const sb = b.benchmark?.score ?? benchMap[b.name]?.validation.score ?? -1;
        if (sa !== sb) return sb - sa;
        const la =
          a.benchmark?.latency_ms ??
          benchMap[a.name]?.latency_ms ??
          999999;
        const lb =
          b.benchmark?.latency_ms ??
          benchMap[b.name]?.latency_ms ??
          999999;
        return la - lb;
      });
      setModels(sorted);
      setOllamaConnected(true);
      if (sorted.length > 0 && !selectedModel) {
        const toolModel = sorted.find((m) => m.supportsTools);
        setSelectedModel(toolModel?.name ?? sorted[0].name);
      }
    } catch {
      setOllamaConnected(false);
    }
  };

  const handleVideoUpload = async (file: File) => {
    setExtractRunning(true);
    setExtractError(null);
    setExtractResult(null);
    try {
      const res = await uploadAudioFile(file);
      void refreshLibrary();
      setExtractResult({
        filename: res.filename,
        relative_path: res.relative_path,
        stored_path: res.stored_path,
        size_bytes: res.size_bytes,
        message: res.message,
        converted: res.converted,
        source_filename: res.source_filename,
        lossless: res.lossless,
      });
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtractRunning(false);
    }
  };

  const handleRunBenchmarks = async () => {
    setBenchmarkRunning(true);
    try {
      await runBenchmark();
      const res = await getBenchmarkResults();
      setBenchmarks(res.results);
    } catch {
      /* benchmarks surface as empty results area in the rail */
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const handleRunCodingBenchmarks = async () => {
    setCodingBenchmarkRunning(true);
    try {
      await runCodingBenchmark();
      const res = await getBenchmarkResults();
      setBenchmarks(res.results);
    } catch {
      /* benchmarks surface as empty results area in the rail */
    } finally {
      setCodingBenchmarkRunning(false);
    }
  };

  const handleNewChat = () => {
    handleNewChatHook();
    setHistory([]);
  };

  const handleClear = () => {
    handleClearHook();
  };

  const handleSaveTool = (tool: Tool) => {
    setTools((prev) => {
      const existing = prev.find((t) => t.id === tool.id);
      if (existing) return prev.map((t) => (t.id === tool.id ? tool : t));
      return [...prev, tool];
    });
    setEnabledTools((prev) => new Set([...prev, tool.id]));
    setShowToolEditor(false);
    setEditingTool(null);
    setToolJsonValid(true);
  };

  return (
    <>
      <div className={DS.page}>
        {/* Center column — chat owns the center */}
        <div className="lg:col-span-2 space-y-4">
          <ChatHeader
            ollamaConnected={ollamaConnected}
            selectedModel={selectedModel}
            models={models}
            onSelectModel={setSelectedModel}
            onNewChat={handleNewChat}
            onClear={handleClear}
          />

          <div className="flex-1 min-h-[300px] max-h-[600px] flex flex-col">
            <MessageList
              messages={messages}
              selectedModel={selectedModel}
              generating={generating}
              onRegenerate={handleRegenerate}
              onCopy={handleCopy}
              onSpeak={(text: string) => {
                void speakAloud.speak(text);
              }}
              onPromptSuggestion={(text: string) => setPrompt(text)}
            />

            <ToolExecutionLog messages={messages} />

            <StreamStatusBanner
              streamStatus={streamStatus}
              streamEvents={streamEvents}
              showStreamDetails={showStreamDetails}
              setShowStreamDetails={setShowStreamDetails}
              currentTool={currentTool}
              toolStep={toolStep}
              totalToolSteps={totalToolSteps}
            />

            <PromptInput
              prompt={prompt}
              setPrompt={setPrompt}
              generating={generating}
              selectedModel={selectedModel}
              onSend={() => void handleGenerate()}
              onCancel={handleCancel}
            />
          </div>

          {error && (
            <div className={DS.cardError}>
              <StopCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {vizConfig && <VisualizationCard config={vizConfig} />}
        </div>

        {/* Right rail — sticky, tabbed */}
      <RightRail
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        taskRoutes={taskRoutes}
        benchmarks={benchmarks}
        onRunBenchmarks={() => {
          void handleRunBenchmarks();
        }}
        onRunCodingBenchmarks={() => {
          void handleRunCodingBenchmarks();
        }}
        benchmarkRunning={benchmarkRunning}
        codingBenchmarkRunning={codingBenchmarkRunning}
          tools={tools}
          enabledTools={enabledTools}
          onSetEnabledTools={setEnabledTools}
          onAddTool={() => {
            const newTool: Tool = {
              id: `tool-${Date.now()}`,
              name: "",
              description: "",
              parameters: { type: "object", properties: {}, required: [] },
            };
            setEditingTool(newTool);
            setToolJsonValid(true);
            setShowToolEditor(true);
          }}
          onEditTool={setEditingTool}
          onDeleteTool={(id: string) => {
            setTools((prev) => prev.filter((t) => t.id !== id));
            setEnabledTools((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }}
          onTemplateSelect={(text: string) => setPrompt(text)}
          extractRunning={extractRunning}
          extractError={extractError}
          extractResult={extractResult}
          onVideoUpload={(file: File) => {
            void handleVideoUpload(file);
          }}
          history={history}
          onHistorySelect={(h) => {
            setPrompt(h.prompt);
            if (models.some((m) => m.name === h.model)) {
              setSelectedModel(h.model);
            }
          }}
        />
      </div>

      {/* Tool Editor Modal */}
      {showToolEditor && editingTool && (
        <ToolEditor
          editingTool={editingTool}
          setEditingTool={setEditingTool}
          toolJsonValid={toolJsonValid}
          setToolJsonValid={setToolJsonValid}
          onSave={handleSaveTool}
          onClose={() => {
            setShowToolEditor(false);
            setEditingTool(null);
          }}
        />
      )}
    </>
  );
}
