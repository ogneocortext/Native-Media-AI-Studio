import { useState, useCallback } from "react";
import {
  Box,
  Wand2,
  Loader2,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Download,
} from "lucide-react";
import {
  generate3D,
  get3DStatus,
} from "../../services/api";

export function Generation3DPage() {
  const [prompt, setPrompt] = useState("a futuristic robot");
  const [model, setModel] = useState("hunyuan3d-2mini");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [status3d, setStatus3d] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const data = await get3DStatus();
      setStatus3d(data);
    } catch {
      // Backend may not be running
    }
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const data = await generate3D({ prompt, model });
      setResult(data);
      loadStatus();
    } catch (err: any) {
      setError(err.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const models = [
    { id: "hunyuan3d-2mini", name: "Hunyuan3D-2mini (0.6B, fast)" },
    { id: "hunyuan3d-2", name: "Hunyuan3D-2 (full)" },
  ];

  const promptSuggestions = [
    "a futuristic robot, chrome metallic",
    "a neon microphone, cyberpunk style",
    "a DJ console, modern minimalist",
    "a cartoon shrimp character, happy",
    "a golden crown, ornate details",
    "a spaceship, sci-fi design",
  ];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Box size={24} className="text-purple-400" />
          3D Model Generation
        </h1>
        <p className="text-gray-400 mt-1">
          Generate 3D models from text prompts using Hunyuan3D.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Model Selection */}
          <div className="bg-gray-800 rounded-lg p-4">
            <label className="text-sm font-medium text-gray-300 block mb-2">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-purple-500 focus:outline-none"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Prompt */}
          <div className="bg-gray-800 rounded-lg p-4">
            <label className="text-sm font-medium text-gray-300 block mb-2">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:border-purple-500 focus:outline-none"
              rows={3}
              placeholder="Describe the 3D model you want to generate..."
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {promptSuggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setPrompt(s)}
                  className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-400"
                >
                  {s.slice(0, 30)}...
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            {generating ? "Generating 3D Model..." : "Generate 3D Model"}
          </button>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-white font-medium">Generation Result</span>
              </div>
              <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400 overflow-auto max-h-48">
                {JSON.stringify(result, null, 2)}
              </pre>
              {result.model_path != null && (
                <button className="mt-3 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white text-sm flex items-center gap-2">
                  <Download size={14} />
                  Download Model
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* 3D Service Status */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <Sparkles size={16} />
              Service Status
            </h3>
            {Object.keys(status3d).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(status3d).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between p-2 bg-gray-700/30 rounded">
                    <span className="text-gray-400 text-sm capitalize">{key.replace(/_/g, " ")}</span>
                    <span className={`text-sm ${typeof value === "boolean" ? (value ? "text-green-400" : "text-red-400") : "text-white"}`}>
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button
                onClick={loadStatus}
                className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
              >
                Check Status
              </button>
            )}
          </div>

          {/* Tips */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3">Tips</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>• Be specific about materials and style</li>
              <li>• Include "highly detailed" for better quality</li>
              <li>• Mention the viewing angle</li>
              <li>• Use "3D model" in your prompt</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
