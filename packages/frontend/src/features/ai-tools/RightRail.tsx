/**
 * RightRail — sticky tabbed rail on the right of the AI Tools page.
 *
 * Tabs:
 *   Model  — task-routing role chips, benchmark buttons, results area,
 *            Models summary block (two-depth model management)
 *   Tools  — Tool Registry (enable/edit/delete/add) + Video → Audio card
 *   Templates — the six prompt template buttons
 *
 * Sticks in view while the user chats in the center column.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Activity, Cpu, Download, MessageSquare, Settings, Sparkles, Trash2, Wrench } from "lucide-react";
import { VideoExtractionCard } from "./VideoExtractionCard";
import { OllamaModelManager } from "./OllamaModelManager";
import { DS } from "../../styles/designSystem";
import type { Tool } from "./types";
import type { OllamaBenchmarkResult } from "../../services/api";

interface RightRailProps {
  selectedModel: string | null;
  onSelectModel: (model: string) => void;
  taskRoutes: {
    routes: Record<string, { engine: string; model: string; reason: string }>;
    excluded_from_chat: string[];
  } | null;
  benchmarks: Record<string, OllamaBenchmarkResult | undefined>;
  onRunBenchmarks: () => void;
  onRunCodingBenchmarks: () => void;
  benchmarkRunning: boolean;
  codingBenchmarkRunning: boolean;
  tools: Tool[];
  enabledTools: Set<string>;
  onSetEnabledTools: (v: Set<string>) => void;
  onAddTool: () => void;
  onEditTool: (tool: Tool) => void;
  onDeleteTool: (id: string) => void;
  onTemplateSelect: (text: string) => void;
  extractRunning: boolean;
  extractError: string | null;
  extractResult: {
    filename: string;
    relative_path: string;
    stored_path: string;
    size_bytes: number;
    message: string;
    converted: boolean | undefined;
    source_filename: string | null | undefined;
    lossless: boolean | undefined;
  } | null;
  onVideoUpload: (file: File) => void;
  history: {
    prompt: string;
    response: string;
    model: string;
    toolCalls: number;
    timestamp: Date;
  }[];
  onHistorySelect: (h: {
    prompt: string;
    response: string;
    model: string;
    toolCalls: number;
    timestamp: Date;
  }) => void;
}

const TABS = [
  { key: "model", label: "Model", icon: Cpu },
  { key: "tools", label: "Tools", icon: Wrench },
  { key: "templates", label: "Templates", icon: Sparkles },
] as const;

const promptTemplates = [
  {
    label: "Video Concept",
    text: "Generate a creative music video concept for a synthwave song about a neon-lit city at night. Include visual style, color palette, and camera movements.",
  },
  {
    label: "Scene Description",
    text: "Describe a cinematic scene for a music video chorus section. Include lighting, mood, and visual elements.",
  },
  {
    label: "Color Palette",
    text: "Suggest a color palette for a music video with a dark cyberpunk mood. Include hex codes and usage guidelines.",
  },
  {
    label: "Transition Ideas",
    text: "Suggest creative video transitions for a music video that sync to beat drops.",
  },
  { label: "Project Status", text: "What's the current system health and job queue status?" },
  {
    label: "Visualization",
    text: "Use the generate_visualization tool to create a particles visualization with neon colors and high intensity",
  },
];

const timeAgo = (d: Date) => {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export function RightRail({
  selectedModel,
  onSelectModel,
  taskRoutes,
  benchmarks,
  onRunBenchmarks,
  onRunCodingBenchmarks,
  benchmarkRunning,
  codingBenchmarkRunning,
  tools,
  enabledTools,
  onSetEnabledTools,
  onAddTool,
  onEditTool,
  onDeleteTool,
  onTemplateSelect,
  extractRunning,
  extractError,
  extractResult,
  onVideoUpload,
  history,
  onHistorySelect,
}: RightRailProps) {
  const [activeTab, setActiveTab] = useState<"model" | "tools" | "templates">("model");
  const navigate = useNavigate();

  return (
    <div className="lg:col-span-1 space-y-4">
      {/* Sticky tabbed rail */}
      <div className="sticky top-6">
        <div className="flex gap-1 mb-3 border-b border-gray-700/50 pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                activeTab === t.key
                  ? "bg-violet-500/10 border-b-2 border-violet-500 text-violet-300"
                  : "text-gray-400 hover:text-gray-300 hover:bg-gray-700/30"
              }`}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Model tab */}
        {activeTab === "model" && (
          <div className={DS.card}>
            <div className={DS.flexBetween + " mb-3"}>
              <h3 className={DS.sectionTitle}>
                <Cpu size={14} />
                Model
              </h3>
            </div>

            {/* Models summary (rail depth - no delete buttons) */}
            <OllamaModelManager selectedModel={selectedModel} showDelete={false} />

            <div className="mt-3">
              <button
                onClick={() => { void navigate("/analyze/ai/models"); }}
                className="w-full px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center justify-between gap-1"
              >
                <span>Full model management →</span>
                <ArrowRight size={12} />
              </button>
            </div>

            {/* Task-routing role chips */}
            <div className="mt-4">
              <h4 className={DS.textLabel}>Task routing</h4>
              <div className="flex flex-wrap gap-1 mt-2">
                {taskRoutes?.routes ? (
                  Object.entries(taskRoutes.routes).map(([task, route]) => (
                    <button
                      key={task}
                      onClick={() => onSelectModel(route.model)}
                      className="px-2 py-1 text-xs rounded bg-purple-900/20 border border-purple-900/50 hover:bg-purple-900/40 text-purple-300"
                      title={`Switch to ${route.model} for ${task} (${route.reason})`}
                    >
                      {task}: {route.model.split(":")[0]}
                    </button>
                  ))
                ) : null}
              </div>
            </div>

            {/* Benchmark buttons */}
            <div className="mt-4 space-y-2">
              <button
                onClick={onRunBenchmarks}
                disabled={benchmarkRunning}
                className="w-full px-3 py-1.5 text-xs rounded bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center justify-between gap-1 disabled:opacity-50"
              >
                <span>{benchmarkRunning ? "Running…" : "Run benchmarks"}</span>
                {benchmarkRunning ? (
                  <Activity size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
              </button>
              <button
                onClick={onRunCodingBenchmarks}
                disabled={codingBenchmarkRunning}
                className="w-full px-3 py-1.5 text-xs rounded bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600 flex items-center justify-between gap-1 disabled:opacity-50"
              >
                <span>Coding benchmarks</span>
                {codingBenchmarkRunning ? (
                  <Activity size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
              </button>
            </div>

            {/* Results area */}
            <div className="mt-4">
              <h4 className={DS.textLabel}>Results</h4>
              <div className="space-y-2 mt-2 max-h-64 overflow-y-auto">
                {Object.entries(benchmarks).length > 0 ? (
                  Object.entries(benchmarks).map(([name, result]) => {
                    if (!result) return null;
                    return (
                      <div key={name} className="p-2 bg-gray-700/30 rounded-lg border border-gray-600/50">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm text-foreground truncate">{name}</span>
                          <span className={DS.textXs + " text-emerald-400"}>
                            {Math.round(result.validation.score) + "/100"}
                          </span>
                        </div>
                        <div className="flex gap-2 text-[10px] text-muted">
                          {result.latency_ms && (
                            <span>{(result.latency_ms / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className={DS.textXs + " text-muted py-2 text-center"}>
                    No benchmark results yet. Run benchmarks above.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tools tab */}
        {activeTab === "tools" && (
          <div className={DS.card}>
            <div className={DS.flexBetween + " mb-3"}>
              <h3 className={DS.sectionTitle}>
                <Wrench size={14} />
                Tools
              </h3>
              <button onClick={onAddTool} className={DS.btnGhost} aria-label="Add tool" title="Add tool">
                <Settings size={14} />
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
              {tools.map((tool) => (
                <div key={tool.id} className="flex items-center gap-2 p-2 bg-gray-700/30 rounded-lg">
                  <input
                    type="checkbox"
                    checked={enabledTools.has(tool.id)}
                    onChange={(e) => {
                      onSetEnabledTools(
                        new Set(
                          e.target.checked
                            ? [...enabledTools, tool.id]
                            : [...enabledTools].filter((id) => id !== tool.id),
                        ),
                      );
                    }}
                    className="accent-violet-500"
                    aria-label={`Enable ${tool.name || "unnamed tool"}`}
                  />
                  <span className="text-sm text-foreground flex-1 truncate">{tool.name}</span>
                  <button
                    onClick={() => onEditTool(tool)}
                    className="text-muted hover:text-foreground"
                    aria-label={`Edit ${tool.name || "unnamed tool"}`}
                    title={`Edit ${tool.name || "unnamed tool"}`}
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    onClick={() => onDeleteTool(tool.id)}
                    className="text-muted hover:text-red-400 light:hover:text-red-700"
                    aria-label={`Delete ${tool.name || "unnamed tool"}`}
                    title={`Delete ${tool.name || "unnamed tool"}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className={DS.textXs + " mt-2"}>
              Enabled: {enabledTools.size} / {tools.length}
            </p>

            {/* Video → Audio extraction */}
            <div className="mt-4 border-t border-gray-700/50 pt-4">
              <VideoExtractionCard
                extractRunning={extractRunning}
                extractError={extractError}
                extractResult={extractResult}
                handleVideoUpload={onVideoUpload}
              />
            </div>
          </div>
        )}

        {/* Templates tab */}
        {activeTab === "templates" && (
          <div className={DS.card}>
            <div className={DS.flexBetween + " mb-3"}>
              <h3 className={DS.sectionTitle}>
                <Sparkles size={14} />
                Templates
              </h3>
            </div>
            <div className="space-y-2 mt-3">
              {promptTemplates.map((t) => (
                <button
                  key={t.label}
                  onClick={() => void onTemplateSelect(t.text)}
                  className="w-full text-left px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* History (always visible below rail tabs) */}
      {history.length > 0 && (
        <div className={DS.card}>
          <div className={DS.flexBetween + " mb-3"}>
            <h3 className={DS.sectionTitle}>
              <MessageSquare size={14} />
              History
            </h3>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => void onHistorySelect(h)}
                className="w-full text-left px-2 py-1.5 bg-gray-700/50 rounded text-xs text-muted hover:bg-gray-700"
                title={`${h.model} · ${timeAgo(h.timestamp)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{h.prompt}</span>
                  {h.toolCalls ? (
                    <span className="text-amber-400 light:text-amber-700 ml-2 shrink-0">
                      🔧{h.toolCalls}
                    </span>
                  ) : null}
                </div>
                <div className={DS.textXs + " flex items-center justify-between gap-2 mt-0.5"}>
                  <span className="truncate">{h.model}</span>
                  <span className="shrink-0">{timeAgo(h.timestamp)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
