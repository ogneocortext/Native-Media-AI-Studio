import { useState, useEffect } from "react";
import {
  Brain,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Cpu,
  MessageSquare,
  Wrench,
  Plus,
  Trash2,
  Settings,
  Zap,
} from "lucide-react";
import {
  getOllamaModels,
  ollamaGenerate,
  type OllamaModel,
} from "../../services/api";
import { DS } from "../../styles/designSystem";

interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

const DEFAULT_TOOLS: Tool[] = [
  {
    id: "generate_image",
    name: "generate_image",
    description: "Generate an image using ComfyUI with the given prompt",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The image generation prompt" },
        negative_prompt: { type: "string", description: "What to avoid in the image" },
        width: { type: "number", description: "Image width in pixels" },
        height: { type: "number", description: "Image height in pixels" },
      },
      required: ["prompt"],
    },
  },
  {
    id: "analyze_audio",
    name: "analyze_audio",
    description: "Analyze an audio file to detect tempo, beats, and song structure",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the audio file" },
      },
      required: ["file_path"],
    },
  },
  {
    id: "search_docs",
    name: "search_docs",
    description: "Search the project documentation",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Maximum number of results" },
      },
      required: ["query"],
    },
  },
  {
    id: "get_project_structure",
    name: "get_project_structure",
    description: "Get the project directory structure",
    parameters: {
      type: "object",
      properties: {
        depth: { type: "number", description: "Directory depth to traverse" },
      },
      required: [],
    },
  },
];

export function AIToolsPage() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<string>("");
  const [toolCalls, setToolCalls] = useState<Array<{ name: string; arguments: Record<string, unknown> }>>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ prompt: string; response: string; model: string }>>([]);
  const [tools, setTools] = useState<Tool[]>(DEFAULT_TOOLS);
  const [showToolEditor, setShowToolEditor] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set(DEFAULT_TOOLS.map((t) => t.id)));

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const modelList = await getOllamaModels();
      const enhanced = modelList.map((m) => ({
        ...m,
        supportsTools: m.capabilities?.includes("tools") || m.name.includes("qwen") || m.name.includes("gemma"),
        supportsVision: m.capabilities?.includes("vision") || m.name.includes("vl"),
      }));
      setModels(enhanced);
      if (enhanced.length > 0 && !selectedModel) {
        setSelectedModel(enhanced[0].name);
      }
    } catch {
      // Ollama may not be running
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModel) return;
    setGenerating(true);
    setError(null);
    setResponse("");
    setToolCalls([]);

    const activeTools = tools.filter((t) => enabledTools.has(t.id));
    const supportsTools = models.find((m) => m.name === selectedModel)?.supportsTools;

    try {
      const result = await ollamaGenerate(prompt, selectedModel, {
        tools: supportsTools ? activeTools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })) : undefined,
      });
      setResponse(result.response);
      if (result.toolCalls) {
        setToolCalls(result.toolCalls);
      }
      setHistory((prev) => [{ prompt, response: result.response, model: selectedModel }, ...prev.slice(0, 9)]);
    } catch (err: any) {
      setError(err.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${(bytes / 1e3).toFixed(0)} KB`;
  };

  const promptTemplates = [
    { label: "Video Concept", text: "Generate a creative music video concept for a [genre] song about [theme]. Include visual style, color palette, and camera movements." },
    { label: "Scene Description", text: "Describe a cinematic scene for a music video chorus section. Include lighting, mood, and visual elements." },
    { label: "Color Palette", text: "Suggest a color palette for a music video with [mood] mood. Include hex codes and usage guidelines." },
    { label: "Transition Ideas", text: "Suggest creative video transitions for a music video that sync to beat drops." },
  ];

  const addTool = () => {
    const newTool: Tool = {
      id: `tool-${Date.now()}`,
      name: "new_tool",
      description: "A new tool",
      parameters: { type: "object", properties: {}, required: [] },
    };
    setEditingTool(newTool);
    setShowToolEditor(true);
  };

  const saveTool = (tool: Tool) => {
    setTools((prev) => {
      const existing = prev.find((t) => t.id === tool.id);
      if (existing) return prev.map((t) => (t.id === tool.id ? tool : t));
      return [...prev, tool];
    });
    setEnabledTools((prev) => new Set([...prev, tool.id]));
    setShowToolEditor(false);
    setEditingTool(null);
  };

  const deleteTool = (id: string) => {
    setTools((prev) => prev.filter((t) => t.id !== id));
    setEnabledTools((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const selectedModelData = models.find((m) => m.name === selectedModel);

  return (
    <div className={DS.page}>
      {/* Header */}
      <div>
        <h1 className={DS.pageTitle}>
          <Brain size={22} className={DS.accentViolet} />
          AI Tools
        </h1>
        <p className={DS.pageSubtitle}>
          Generate creative ideas using local AI models with tool support.
        </p>
      </div>

      <div className={DS.gridChat}>
        {/* Main Chat Area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Model Selection */}
          <div className={DS.card}>
            <label className={DS.textSmMedium + " block mb-2"}>Model</label>
            {models.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className={DS.select}
                >
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({formatSize(m.size)})
                      {m.supportsTools ? " 🔧" : ""}
                      {m.supportsVision ? " 👁" : ""}
                    </option>
                  ))}
                </select>
                {selectedModelData && (
                  <div className="flex gap-2 text-xs">
                    {selectedModelData.supportsTools && (
                      <span className={DS.badgeGreen + " flex items-center gap-1"}>
                        <Wrench size={10} /> Tools
                      </span>
                    )}
                    {selectedModelData.supportsVision && (
                      <span className={DS.badgeBlue}>👁 Vision</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className={DS.textXs}>No Ollama models available. Start Ollama to use this feature.</p>
            )}
          </div>

          {/* Prompt Input */}
          <div className={DS.card}>
            <label className={DS.textSmMedium + " block mb-2"}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className={DS.textarea}
              rows={4}
              placeholder="Ask for video concepts, scene descriptions, color palettes..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleGenerate();
                }
              }}
            />
            <div className={DS.flexBetween + " mt-2"}>
              <span className={DS.textXs}>Ctrl+Enter to send</span>
              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim() || !selectedModel}
                className={DS.btnPrimary + " " + DS.btnDisabled}
              >
                {generating ? <Loader2 size={16} className={DS.loading} /> : <Send size={16} />}
                {generating ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className={DS.cardError}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Response */}
          {response && (
            <div className={DS.card}>
              <div className={DS.flexCenter + " mb-3"}>
                <CheckCircle size={16} className={DS.accentGreen} />
                <span className={DS.textBold}>Response</span>
                <span className={DS.textXs}>({selectedModel})</span>
              </div>
              <div className={DS.textSm + " whitespace-pre-wrap"}>{response}</div>
            </div>
          )}

          {/* Tool Calls */}
          {toolCalls.length > 0 && (
            <div className={DS.card}>
              <div className={DS.flexCenter + " mb-3"}>
                <Wrench size={16} className="text-amber-400" />
                <span className={DS.textBold}>Tool Calls</span>
              </div>
              <div className="space-y-2">
                {toolCalls.map((tc, i) => (
                  <div key={i} className="p-3 bg-gray-700/50 rounded-lg">
                    <div className={DS.flexCenter + " mb-1"}>
                      <Zap size={12} className="text-amber-400" />
                      <span className="text-amber-400 text-sm font-medium">{tc.name}</span>
                    </div>
                    <pre className={DS.mono + " overflow-auto"}>
                      {JSON.stringify(tc.arguments, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Prompt Templates */}
          <div className={DS.card}>
            <h3 className={DS.sectionTitle}>
              <Sparkles size={14} />
              Templates
            </h3>
            <div className="space-y-2 mt-3">
              {promptTemplates.map((t) => (
                <button
                  key={t.label}
                  onClick={() => setPrompt(t.text)}
                  className="w-full text-left px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tool Registry */}
          <div className={DS.card}>
            <div className={DS.flexBetween + " mb-3"}>
              <h3 className={DS.sectionTitle}>
                <Wrench size={14} />
                Tool Registry
              </h3>
              <button onClick={addTool} className={DS.btnGhost}>
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {tools.map((tool) => (
                <div key={tool.id} className="flex items-center gap-2 p-2 bg-gray-700/30 rounded-lg">
                  <input
                    type="checkbox"
                    checked={enabledTools.has(tool.id)}
                    onChange={(e) => {
                      setEnabledTools((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(tool.id);
                        else next.delete(tool.id);
                        return next;
                      });
                    }}
                    className="accent-violet-500"
                  />
                  <span className="text-sm text-gray-300 flex-1 truncate">{tool.name}</span>
                  <button onClick={() => { setEditingTool(tool); setShowToolEditor(true); }} className="text-gray-500 hover:text-white">
                    <Settings size={12} />
                  </button>
                  <button onClick={() => deleteTool(tool.id)} className="text-gray-500 hover:text-red-400">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <p className={DS.textXs + " mt-2"}>
              Enabled: {enabledTools.size} / {tools.length}
            </p>
          </div>

          {/* Available Models */}
          <div className={DS.card}>
            <h3 className={DS.sectionTitle}>
              <Cpu size={14} />
              Models
            </h3>
            {models.length > 0 ? (
              <div className="space-y-1 mt-3">
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setSelectedModel(m.name)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm ${
                      selectedModel === m.name ? "bg-violet-600/30 text-violet-300" : "text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={DS.truncate}>{m.name}</span>
                      {m.supportsTools && <Wrench size={10} className={DS.accentGreen} />}
                      {m.supportsVision && <span className={DS.accentSky}>👁</span>}
                    </div>
                    <div className={DS.textXs}>{formatSize(m.size)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className={DS.textXs}>No models available</p>
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className={DS.card}>
              <h3 className={DS.sectionTitle}>
                <MessageSquare size={14} />
                History
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => { setPrompt(h.prompt); setResponse(h.response); }}
                    className="w-full text-left px-2 py-1.5 bg-gray-700/50 rounded text-xs text-gray-400 truncate hover:bg-gray-700"
                  >
                    {h.prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tool Editor Modal */}
      {showToolEditor && editingTool && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
            <h3 className="text-white font-semibold mb-4">Edit Tool</h3>
            <div className="space-y-3">
              <div>
                <label className={DS.textSm + " block mb-1"}>Name</label>
                <input
                  type="text"
                  value={editingTool.name}
                  onChange={(e) => setEditingTool({ ...editingTool, name: e.target.value })}
                  className={DS.input}
                />
              </div>
              <div>
                <label className={DS.textSm + " block mb-1"}>Description</label>
                <textarea
                  value={editingTool.description}
                  onChange={(e) => setEditingTool({ ...editingTool, description: e.target.value })}
                  className={DS.textarea}
                  rows={2}
                />
              </div>
              <div>
                <label className={DS.textSm + " block mb-1"}>Parameters (JSON)</label>
                <textarea
                  value={JSON.stringify(editingTool.parameters, null, 2)}
                  onChange={(e) => {
                    try {
                      const params = JSON.parse(e.target.value);
                      setEditingTool({ ...editingTool, parameters: params });
                    } catch { /* Invalid JSON */ }
                  }}
                  className={DS.textarea + " " + DS.mono}
                  rows={6}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => saveTool(editingTool)}
                className={"flex-1 " + DS.btnPrimary}
              >
                Save
              </button>
              <button
                onClick={() => { setShowToolEditor(false); setEditingTool(null); }}
                className={"flex-1 " + DS.btnSecondary}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
