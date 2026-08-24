import { useState, useEffect, useCallback } from "react";
import {
  Film,
  Wand2,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Sparkles,
  Settings,
  Play,
  Download,
} from "lucide-react";
import {
  generateVideoSection,
  getMusicVideoStyles,
  getWorkflowTemplates,
  getJobTypes,
  type VideoGenerateRequest,
  type VideoGenerateResponse,
} from "../../services/api";

interface Style {
  id: string;
  name: string;
  description: string;
  preview?: string;
}

interface Template {
  id: string;
  name: string;
  description: string;
  sections: string[];
}

export function VideoGenerationPage() {
  const [prompt, setPrompt] = useState("cinematic music video, vibrant colors, professional lighting");
  const [negativePrompt, setNegativePrompt] = useState("blurry, low quality, distorted");
  const [steps, setSteps] = useState(20);
  const [cfgScale, setCfgScale] = useState(7.0);
  const [selectedStyle, setSelectedStyle] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [duration, setDuration] = useState(10);
  const [verticalFirst, setVerticalFirst] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<VideoGenerateResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [styles, setStyles] = useState<Style[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobTypes, setJobTypes] = useState<Record<string, unknown>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [stylesData, templatesData, jobTypesData] = await Promise.all([
        getMusicVideoStyles(),
        getWorkflowTemplates(),
        getJobTypes(),
      ]);
      setStyles(Array.isArray(stylesData) ? stylesData : []);
      setTemplates(Array.isArray(templatesData) ? templatesData : []);
      setJobTypes(jobTypesData || {});
    } catch {
      // Backend may not be running
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    const newResults: VideoGenerateResponse[] = [];

    try {
      const sections = selectedTemplate
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) || ["full"];

      for (const section of sections) {
        const request: VideoGenerateRequest = {
          prompt,
          negative_prompt: negativePrompt,
          steps,
          cfg_scale: cfgScale,
          section,
          duration: duration / sections.length,
          vertical_first: verticalFirst,
        };
        const result = await generateVideoSection(request);
        newResults.push(result);
      }
      setResults(newResults);
    } catch (err: any) {
      setError(err.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const promptSuggestions = [
    { label: "Happy/Upbeat", words: ["upbeat", "bright", "colorful", "energetic", "joyful"] },
    { label: "Dark/Moody", words: ["moody", "atmospheric", "cinematic", "dramatic", "intense"] },
    { label: "Electronic", words: ["neon", "futuristic", "cyberpunk", "glitch", "synthwave"] },
    { label: "Natural", words: ["organic", "earthy", "warm", "sunset", "flowing"] },
  ];

  const addPromptWords = (words: string[]) => {
    const current = prompt.toLowerCase();
    const newWords = words.filter((w) => !current.includes(w.toLowerCase()));
    if (newWords.length > 0) {
      setPrompt((prev) => `${prev}, ${newWords.join(", ")}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Film size={24} className="text-purple-400" />
          Video Generation
        </h1>
        <p className="text-gray-400 mt-1">
          Generate video sections for your music video with AI.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Controls */}
        <div className="lg:col-span-2 space-y-4">
          {/* Prompt */}
          <div className="bg-gray-800 rounded-lg p-4">
            <label className="text-sm font-medium text-gray-300 block mb-2">Positive Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:border-purple-500 focus:outline-none"
              rows={3}
              placeholder="Describe the visual style..."
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {promptSuggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => addPromptWords(s.words)}
                  className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-400"
                >
                  + {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Negative Prompt */}
          <div className="bg-gray-800 rounded-lg p-4">
            <label className="text-sm font-medium text-gray-300 block mb-2">Negative Prompt</label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-purple-500 focus:outline-none"
              placeholder="What to avoid..."
            />
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg p-3">
              <label className="text-xs text-gray-500 block mb-1">Steps</label>
              <input
                type="number"
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                min={5}
                max={50}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              />
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <label className="text-xs text-gray-500 block mb-1">CFG Scale</label>
              <input
                type="number"
                value={cfgScale}
                onChange={(e) => setCfgScale(Number(e.target.value))}
                min={1}
                max={20}
                step={0.5}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              />
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <label className="text-xs text-gray-500 block mb-1">Duration (s)</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                min={1}
                max={60}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              />
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={verticalFirst}
                  onChange={(e) => setVerticalFirst(e.target.checked)}
                  className="accent-purple-500"
                />
                Vertical First
              </label>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            {generating ? "Generating..." : "Generate Video"}
          </button>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Results</h3>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className={`p-3 rounded-lg ${r.success ? "bg-green-900/20 border border-green-700" : "bg-red-900/20 border border-red-700"}`}>
                    <div className="flex items-center gap-2">
                      {r.success ? <CheckCircle size={16} className="text-green-400" /> : <XCircle size={16} className="text-red-400" />}
                      <span className="text-white font-medium">{r.section}</span>
                    </div>
                    {r.output_path && <p className="text-gray-500 text-sm mt-1">{r.output_path}</p>}
                    {r.error && <p className="text-red-400 text-sm mt-1">{r.error}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Styles */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <Sparkles size={16} />
              Styles
            </h3>
            {styles.length > 0 ? (
              <div className="space-y-1">
                {styles.map((s: any) => (
                  <button
                    key={s.id || s.name}
                    onClick={() => setSelectedStyle(s.id || "")}
                    className={`w-full text-left px-3 py-2 rounded text-sm ${
                      selectedStyle === s.id ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                    }`}
                  >
                    {s.name || s.id}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No styles available</p>
            )}
          </div>

          {/* Templates */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <Settings size={16} />
              Templates
            </h3>
            {templates.length > 0 ? (
              <div className="space-y-1">
                {templates.map((t: any) => (
                  <button
                    key={t.id || t.name}
                    onClick={() => setSelectedTemplate(t.id || "")}
                    className={`w-full text-left px-3 py-2 rounded text-sm ${
                      selectedTemplate === t.id ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                    }`}
                  >
                    <span>{t.name || t.id}</span>
                    {t.sections && <span className="text-xs text-gray-500 ml-1">({t.sections.length})</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No templates available</p>
            )}
          </div>

          {/* Job Types */}
          {Object.keys(jobTypes).length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Job Types</h3>
              <div className="flex flex-wrap gap-1">
                {Object.keys(jobTypes).map((type) => (
                  <span key={type} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
                    {type}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
