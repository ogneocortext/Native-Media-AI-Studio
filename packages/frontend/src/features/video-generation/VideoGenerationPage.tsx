import { useState, useEffect, useCallback, useRef } from "react";
import {
  Film,
  Wand2,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Sparkles,
  Settings,
  ImageIcon,
  Clock,
  X,
  Gauge,
} from "lucide-react";
import {
  getMusicVideoStyles,
  getWorkflowTemplates,
  getJobTypes,
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

interface VideoModel {
  name: string;
  description: string;
  type: string;
  bestFor: string;
}

function getVideoModelInfo(modelName: string): VideoModel {
  const base = modelName.toLowerCase();
  if (base.includes("wan") && base.includes("ti2v")) {
    return { name: modelName, description: "Wan 2.2 — text-to-video model generates video clips from text prompts", type: "Text-to-Video", bestFor: "Short video clips, animations, motion content" };
  }
  if (base.includes("kandinsky")) {
    return { name: modelName, description: "Kandinsky 5 Lite — image-to-video model that animates a starting image", type: "Image-to-Video", bestFor: "Animating still images into video clips" };
  }
  if (base.includes("animate") || base.includes("mm_sd")) {
    return { name: modelName, description: "AnimateDiff motion module — adds motion to Stable Diffusion generations", type: "Motion Module", bestFor: "Adding camera motion and animation to SD images" };
  }
  if (base.includes("wan")) {
    return { name: modelName, description: "Wan video generation model", type: "Video", bestFor: "Video generation from text or image" };
  }
  return { name: modelName, description: `Video model: ${modelName}`, type: "Video", bestFor: "Video generation" };
}

interface JobProgress {
  job_id: string;
  status: string;
  progress: number;
  current_step: number;
  total_steps: number;
  current_frame: number;
  total_frames: number;
  elapsed_seconds: number;
  estimated_seconds: number;
  remaining_seconds: number;
  estimated_end_time: string;
  error: string | null;
}

// Style gradient placeholders (instant visual feedback while preview generates)
const STYLE_GRADIENTS: Record<string, string> = {
  cyberpunk_neon: "linear-gradient(135deg, #ff00ff 0%, #00ffff 50%, #ff00aa 100%)",
  organic_flow: "linear-gradient(135deg, #4a7c59 0%, #8fbc8f 50%, #2d5016 100%)",
  geometric_pulse: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
  particle_dance: "linear-gradient(135deg, #ffd700 0%, #ff8c00 50%, #ff4500 100%)",
  vinyl_retro: "linear-gradient(135deg, #8b4513 0%, #d2691e 50%, #cd853f 100%)",
  waveform_classic: "linear-gradient(135deg, #00ff00 0%, #003300 50%, #001100 100%)",
  fire_energy: "linear-gradient(135deg, #ff0000 0%, #ff4500 50%, #ff8c00 100%)",
};

// Generate a placeholder SVG for style previews (instant, no API call needed)
function generateStylePlaceholder(styleId: string, styleName: string): string {
  const colors = STYLE_GRADIENTS[styleId]?.match(/#[0-9a-f]{6}/gi) || ["#667eea", "#764ba2"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="144" viewBox="0 0 256 144">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${colors[0]}" />
        <stop offset="100%" style="stop-color:${colors[1] || colors[0]}" />
      </linearGradient>
    </defs>
    <rect width="256" height="144" fill="url(#g)" />
    <text x="128" y="72" font-family="Arial" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle" style="text-shadow: 1px 1px 2px rgba(0,0,0,0.5)">${styleName}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function VideoGenerationPage() {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("blurry, low quality, distorted");
  const [steps, setSteps] = useState(20);
  const [cfgScale, setCfgScale] = useState(7.0);
  const [selectedStyle, setSelectedStyle] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [duration, setDuration] = useState(10);
  const [verticalFirst, setVerticalFirst] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<VideoGenerateResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [styles, setStyles] = useState<Style[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [, setJobTypes] = useState<Record<string, unknown>>({});
  const [stylePreviews, setStylePreviews] = useState<Record<string, string>>({});
  const [loadingPreviews, setLoadingPreviews] = useState<Record<string, boolean>>({});
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadData();
    // Fetch video models from ComfyUI
    fetch("/api/integrations/comfyui/checkpoints")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.checkpoints?.length) {
          const vModels = data.checkpoints
            .filter((name: string) => {
              const base = name.toLowerCase();
              return base.includes("wan") || base.includes("kandinsky") || base.includes("animate") || base.includes("mm_sd") || base.includes("motion");
            })
            .map((name: string) => getVideoModelInfo(name));
          if (vModels.length === 0) {
            // Fallback: show all diffusion models if no specific video models found
            const allDiff = data.checkpoints
              .filter((name: string) => !name.toLowerCase().includes("sdxl") && !name.toLowerCase().includes("sd_v1"))
              .map((name: string) => getVideoModelInfo(name));
            setVideoModels(allDiff.slice(0, 6));
          } else {
            setVideoModels(vModels);
          }
          if (vModels.length > 0 && !selectedModel) {
            setSelectedModel(vModels[0].name);
          }
        }
      })
      .catch(() => {});
    const retryTimer = setTimeout(() => {
      if (styles.length === 0 && templates.length === 0) {
        loadData();
      }
    }, 2000);
    return () => clearTimeout(retryTimer);
  }, []);

  const loadData = async () => {
    try {
      const [stylesData, templatesData, jobTypesData] = await Promise.all([
        getMusicVideoStyles(),
        getWorkflowTemplates(),
        getJobTypes(),
      ]);
      const loadedStyles = Array.isArray(stylesData) ? stylesData : (stylesData?.styles as Style[]) || [];
      setStyles(loadedStyles);
      setTemplates(Array.isArray(templatesData) ? templatesData : (templatesData?.templates as Template[]) || []);
      setJobTypes(jobTypesData || {});
    } catch {
      // Backend may not be running — data will show as empty
    }
  };

  const handleRefreshData = () => {
    loadData();
  };

  // Poll job progress
  const startProgressPolling = useCallback((jobId: string) => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/integrations/music-video/job/${jobId}/progress`);
        if (res.ok) {
          const data: JobProgress = await res.json();
          setJobProgress(data);
          if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }
            setGenerating(false);
            setActiveJobId(null);
            if (data.status === "completed") {
              setResults((prev) => [...prev, { success: true, job_id: jobId, output_path: "", section: "", error: null, message: "Completed" }]);
            }
            if (data.error) {
              setError(data.error);
            }
          }
        }
      } catch (e) {
        console.error("Progress poll error:", e);
      }
    }, 1000);
  }, []);

  const stopProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopProgressPolling();
  }, [stopProgressPolling]);

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/jobs/${activeJobId}/cancel`, { method: "POST" });
      stopProgressPolling();
      setGenerating(false);
      setActiveJobId(null);
      setJobProgress(null);
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  const generateStylePreview = async (styleId: string) => {
    setLoadingPreviews((prev) => ({ ...prev, [styleId]: true }));
    try {
      // Try to get a cached preview from localStorage first
      const cached = localStorage.getItem(`style-preview-${styleId}`);
      if (cached) {
        setStylePreviews((prev) => ({ ...prev, [styleId]: cached }));
        setLoadingPreviews((prev) => ({ ...prev, [styleId]: false }));
        return;
      }
      const res = await fetch(`/api/integrations/music-video/style-preview?style_id=${styleId}`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.image) {
          // Cache the preview for future visits
          try {
            localStorage.setItem(`style-preview-${styleId}`, data.image);
          } catch {
            // localStorage full — skip caching
          }
          setStylePreviews((prev) => ({ ...prev, [styleId]: data.image }));
        }
      }
    } catch (e) {
      console.error("Preview generation failed:", e);
      // Keep the SVG placeholder on failure
    } finally {
      setLoadingPreviews((prev) => ({ ...prev, [styleId]: false }));
    }
  };

  const handleGenerate = async () => {
    console.log("[VideoGen] Starting generation...", { prompt, selectedModel, selectedStyle, steps, cfgScale, duration });
    setGenerating(true);
    setError(null);
    setResults([]);

    try {
      const body = {
        prompt,
        negative_prompt: negativePrompt,
        steps,
        cfg_scale: cfgScale,
        model: selectedModel,
        duration,
        style: selectedStyle,
      };
      console.log("[VideoGen] Sending request:", body);
      const res = await fetch(`/api/integrations/music-video/generate-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      console.log("[VideoGen] Response status:", res.status);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        console.error("[VideoGen] Error response:", err);
        throw new Error(err.detail || `Generation failed (${res.status})`);
      }

      const data = await res.json();
      console.log("[VideoGen] Success:", data);
      if (data.job_id) {
        setActiveJobId(data.job_id);
        startProgressPolling(data.job_id);
      }
    } catch (err: any) {
      console.error("[VideoGen] Generation error:", err);
      setError(err.message || "Generation failed");
      setGenerating(false);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
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
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Film size={24} className="text-purple-400" />
            Video Generation
          </h1>
          <p className="text-gray-400 mt-1">
            Generate video sections for your music video with AI.
          </p>
        </div>
        <button
          onClick={handleRefreshData}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300 flex items-center gap-1"
        >
          Refresh
        </button>
      </div>

      {/* Real-time Progress Banner */}
      {generating && jobProgress && (
        <div className="bg-purple-900/30 border border-purple-500/50 rounded-lg p-4 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 size={16} className="text-purple-400 animate-spin" />
              <span className="text-sm font-medium text-purple-300">Generating Video...</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">
                Step {jobProgress.current_step}/{jobProgress.total_steps}
              </span>
              <span className="text-xs text-gray-400">
                Frame {jobProgress.current_frame}/{jobProgress.total_frames}
              </span>
              <button
                onClick={handleCancelJob}
                className="px-2 py-1 bg-red-600/30 hover:bg-red-600/50 rounded text-xs text-red-300 flex items-center gap-1"
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
              style={{ width: `${jobProgress.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Clock size={12} />
                Elapsed: {formatTime(jobProgress.elapsed_seconds)}
              </span>
              <span>Remaining: {formatTime(jobProgress.remaining_seconds)}</span>
            </div>
            <span className="flex items-center gap-1">
              <Gauge size={12} />
              ETA: {jobProgress.estimated_end_time ? new Date(jobProgress.estimated_end_time).toLocaleTimeString() : "Calculating..."}
            </span>
          </div>
        </div>
      )}

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
          {error && !generating && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300 animate-scale-in">
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
          {/* Video Models */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <ImageIcon size={16} />
              Video Models
            </h3>
            <div className="space-y-2">
              {videoModels.length > 0 ? videoModels.map((model) => {
                const selected = selectedModel === model.name;
                return (
                  <button
                    key={model.name}
                    onClick={() => setSelectedModel(model.name)}
                    className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${selected ? "border-purple-500 bg-purple-500/10" : "border-gray-600 bg-gray-700 hover:border-gray-500"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate mr-2">{model.name.replace(".safetensors", "")}</span>
                      {selected && <span className="text-[10px] text-purple-400 shrink-0">Selected</span>}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">{model.description}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400">{model.type}</span>
                      <span className="text-[10px] text-gray-500">Best for: {model.bestFor}</span>
                    </div>
                  </button>
                );
              }) : (
                <p className="text-xs text-gray-500">No video models found. Install video models in ComfyUI diffusion_models folder.</p>
              )}
            </div>
          </div>

          {/* Styles with Previews */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <Sparkles size={16} />
              Styles
            </h3>
            {styles.length > 0 ? (
              <div className="space-y-2">
                {styles.map((s: any) => {
                  const styleId = s.id || s.name;
                  const hasPreview = !!stylePreviews[styleId];
                  const isLoading = !!loadingPreviews[styleId];
                  return (
                    <div
                      key={styleId}
                      className={`rounded-lg border overflow-hidden transition-all duration-200 ${selectedStyle === styleId ? "border-purple-500 shadow-lg shadow-purple-500/20" : "border-gray-600 hover:border-gray-500"}`}
                    >
                      {/* Preview Image or Placeholder */}
                      <div
                        className="aspect-video bg-gray-900 relative cursor-pointer"
                        onClick={() => {
                          setSelectedStyle(styleId);
                          if (!hasPreview && !isLoading) {
                            // Show instant placeholder then lazy-load real preview
                            setStylePreviews((prev) => ({ ...prev, [styleId]: generateStylePlaceholder(styleId, s.name) }));
                            generateStylePreview(styleId);
                          }
                        }}
                      >
                        {hasPreview ? (
                          <img
                            src={stylePreviews[styleId].startsWith("data:") ? stylePreviews[styleId] : `data:image/png;base64,${stylePreviews[styleId]}`}
                            alt={s.name}
                            className="w-full h-full object-cover"
                          />
                        ) : isLoading ? (
                          <div className="w-full h-full flex items-center justify-center bg-gray-800">
                            <Loader2 size={20} className="text-purple-400 animate-spin" />
                          </div>
                        ) : (
                          <div
                            className="w-full h-full flex items-center justify-center"
                            style={{ background: STYLE_GRADIENTS[styleId] || "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}
                          >
                            <span className="text-white text-sm font-medium" style={{ textShadow: "1px 1px 2px rgba(0,0,0,0.5)" }}>Click to preview</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setSelectedStyle(styleId);
                          if (!hasPreview && !isLoading) {
                            setStylePreviews((prev) => ({ ...prev, [styleId]: generateStylePlaceholder(styleId, s.name) }));
                            generateStylePreview(styleId);
                          }
                        }}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-all duration-200 ${selectedStyle === styleId ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
                      >
                        <span>{s.name || s.id}</span>
                        {selectedStyle === styleId && <span className="text-[10px] text-purple-300">Selected</span>}
                      </button>
                    </div>
                  );
                })}
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
              <div className="space-y-2">
                {templates.map((t: any) => (
                  <button
                    key={t.id || t.name}
                    onClick={() => setSelectedTemplate(t.id || "")}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-all duration-200 flex items-center justify-between ${
                      selectedTemplate === t.id ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                    }`}
                  >
                    <span className="truncate">{t.name || t.id}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {t.sections && <span className="text-xs opacity-60">({t.sections.length})</span>}
                      {selectedTemplate === t.id && <span className="text-[10px] text-purple-300">Selected</span>}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No templates available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
