import { useState, useCallback, useEffect } from "react";
import { Image, Play, Clock, Settings2, Sparkles, Download, RefreshCw, Zap, Square, Gem, RectangleVertical, RectangleHorizontal, Crown } from "lucide-react";
import { Card, LoadingSpinner, EmptyState, StatusBadge } from "../../components/common";
import * as api from "../../services/api";
import { getLogger } from "../../services/logger";

const logger = getLogger("image-generation");

interface CheckpointModel {
  name: string;
  filename: string;
  path: string;
  size: number;
}

interface ModelInfo {
  description: string;
  type: string;
  bestFor: string;
}

function getModelInfo(modelName: string): ModelInfo {
  const baseName = modelName.replace(/\.(safetensors|ckpt|pt)$/i, "").toLowerCase();
  if (baseName.includes("hunyuan3d") || baseName.includes("3d")) {
    return { description: "3D model generation", type: "3D Generation", bestFor: "3D model creation, mesh generation, assets" };
  }
  if (baseName.includes("sdxl") || baseName.includes("xl")) {
    return { description: "Stable Diffusion XL — high-resolution image generation", type: "Image (SDXL)", bestFor: "High-res images, detailed portraits, landscapes" };
  }
  if (baseName.includes("sd") || baseName.includes("v1-5") || baseName.includes("v15")) {
    return { description: "Stable Diffusion 1.5 — versatile general-purpose image generation", type: "Image (SD 1.5)", bestFor: "General images, portraits, landscapes, concept art" };
  }
  if (baseName.includes("flux")) {
    return { description: "Flux — high-quality image generation with fast inference", type: "Image (Flux)", bestFor: "High-quality images, creative concepts, artistic styles" };
  }
  if (baseName.includes("wan")) {
    return { description: "Wan — video generation model", type: "Video", bestFor: "Video generation, motion synthesis" };
  }
  // Generic fallback for any model
  return { description: `AI model: ${modelName}`, type: "Image/Video", bestFor: "Image and video generation" };
}

interface GenerationOptions {
  prompt: string;
  negativePrompt: string;
  steps: number;
  cfgScale: number;
  width: number;
  height: number;
  seed: number;
  sampler: string;
  model: string;
}

const defaultOptions: GenerationOptions = {
  prompt: "",
  negativePrompt: "",
  steps: 20,
  cfgScale: 7.0,
  width: 512,
  height: 512,
  seed: -1,
  sampler: "Euler a",
  model: "",
};

interface GenerationPreset {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  settings: Pick<GenerationOptions, "steps" | "cfgScale" | "width" | "height" | "sampler">;
  color: string;
}

const presets: GenerationPreset[] = [
  {
    id: "quick",
    name: "Quick Preview",
    description: "Fast iteration, low quality",
    icon: <Zap size={16} />,
    settings: { steps: 10, cfgScale: 7, width: 512, height: 512, sampler: "Euler a" },
    color: "amber",
  },
  {
    id: "standard",
    name: "Standard",
    description: "Balanced speed and quality",
    icon: <Square size={16} />,
    settings: { steps: 20, cfgScale: 7, width: 512, height: 512, sampler: "Euler a" },
    color: "blue",
  },
  {
    id: "quality",
    name: "High Quality",
    description: "Detailed, slower generation",
    icon: <Gem size={16} />,
    settings: { steps: 30, cfgScale: 7, width: 768, height: 768, sampler: "DPM++ 2M" },
    color: "purple",
  },
  {
    id: "portrait",
    name: "Portrait",
    description: "512 x 768 — vertical images",
    icon: <RectangleVertical size={16} />,
    settings: { steps: 25, cfgScale: 7, width: 512, height: 768, sampler: "Euler a" },
    color: "pink",
  },
  {
    id: "landscape",
    name: "Landscape",
    description: "768 x 512 — wide images",
    icon: <RectangleHorizontal size={16} />,
    settings: { steps: 25, cfgScale: 7, width: 768, height: 512, sampler: "Euler a" },
    color: "emerald",
  },
  {
    id: "maximum",
    name: "Maximum",
    description: "Best quality, very slow",
    icon: <Crown size={16} />,
    settings: { steps: 50, cfgScale: 7, width: 1024, height: 1024, sampler: "DPM++ 2M" },
    color: "red",
  },
];

const colorMap: Record<string, { bg: string; border: string; text: string; ring: string }> = {
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", ring: "ring-amber-500/20" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400", ring: "ring-blue-500/20" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", ring: "ring-purple-500/20" },
  pink: { bg: "bg-pink-500/10", border: "border-pink-500/30", text: "text-pink-400", ring: "ring-pink-500/20" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", ring: "ring-emerald-500/20" },
  red: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", ring: "ring-red-500/20" },
};

function getFriendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Failed to generate image";
  if (msg.includes("ECONNREFUSED") || msg.includes("Failed to fetch")) {
    return "Cannot connect to backend. Make sure the server is running.";
  }
  if (msg.includes("ComfyUI") && msg.includes("not available")) {
    return "ComfyUI is offline. Start ComfyUI or check the integrations page.";
  }
  if (msg.includes("timeout") || msg.includes("Timed out")) {
    return "Generation timed out. Try reducing steps or image size.";
  }
  return msg;
}

export function ImageGeneration() {
  const [options, setOptions] = useState<GenerationOptions>(defaultOptions);
  const [activePreset, setActivePreset] = useState<string>("standard");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ output_path: string; seed: number } | null>(null);
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState<string>("");
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(20);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [models, setModels] = useState<CheckpointModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  // Fetch available checkpoint models (filtered to image models only)
  useEffect(() => {
    fetch("/api/integrations/comfyui/checkpoints")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.checkpoints?.length) {
          // Filter to show only image generation models
          const imageModels = data.checkpoints.filter((name: string) => {
            const baseName = name.toLowerCase();
            // Exclude video/3D/motion models
            return !baseName.includes("wan") && 
                   !baseName.includes("animate") && 
                   !baseName.includes("motion") &&
                   !baseName.includes("hunyuan") &&
                   !baseName.includes("3d") &&
                   !baseName.includes("kandinsky");  // Kandinsky is also not SD
          });
          // If no models found, show all (fallback)
          const finalModels = imageModels.length > 0 ? imageModels : data.checkpoints;
          setModels(finalModels.map((name: string) => ({ name, filename: name, path: "", size: 0 })));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingModels(false));
  }, []);

  // Auto-select first model
  useEffect(() => {
    if (models.length > 0 && !options.model) {
      const firstName = typeof models[0] === "string" ? models[0] : models[0]?.name;
      if (firstName) setOptions((prev) => ({ ...prev, model: firstName }));
    }
  }, [models, options.model]);

  // Poll for progress and live preview when promptId changes
  useEffect(() => {
    if (!promptId || !generating) return;

    let cancelled = false;
    let lastPreviewFilename: string | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/integrations/comfyui/progress/${promptId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setProgress(data.progress || 0);
          setCurrentStep(data.step || 0);
          setTotalSteps(data.total_steps || options.steps);
          setProgressStatus(data.status || "running");

          if (data.status === "completed") {
            // Fetch the final result
            try {
              const resultRes = await fetch(`/api/integrations/comfyui/result/${promptId}`);
              if (resultRes.ok) {
                const resultData = await resultRes.json();
                if (resultData.status === "completed" && resultData.output_path) {
                  setResult({
                    output_path: resultData.output_path,
                    seed: resultData.seed || 0,
                  });
                  setProgress(100);
                  setProgressStatus("Completed");
                  setLivePreviewUrl(null);
                } else {
                  setError("Generation completed but no image was found");
                }
              }
            } catch {
              setError("Failed to fetch result");
            }
            setGenerating(false);
          } else if (data.status === "error") {
            setError("Generation failed");
            setGenerating(false);
          } else {
            // Fetch live preview from ComfyUI history
            try {
              const previewRes = await fetch(`/api/integrations/comfyui/preview/${promptId}`);
              if (previewRes.ok) {
                const previewData = await previewRes.json();
                if (previewData.filename && previewData.filename !== lastPreviewFilename) {
                  lastPreviewFilename = previewData.filename;
                  setLivePreviewUrl(`/api/integrations/comfyui/view/${encodeURIComponent(promptId)}/${encodeURIComponent(previewData.filename)}?t=${Date.now()}`);
                }
              }
            } catch {
              // Preview not available yet, continue polling
            }
            // Continue polling
            setTimeout(poll, 1500);
          }
        } else if (!cancelled) {
          setTimeout(poll, 1500);
        }
      } catch {
        if (!cancelled) {
          setTimeout(poll, 1500);
        }
      }
    };

    // Start polling after 1 second
    const timeout = setTimeout(poll, 1000);

    // Safety timeout - stop polling after 5 minutes
    const safetyTimeout = setTimeout(() => {
      cancelled = true;
      if (generating) {
        setGenerating(false);
        setProgressStatus("Timeout");
      }
    }, 300000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearTimeout(safetyTimeout);
    };
  }, [promptId, generating, options.steps]);

  const handleGenerate = async () => {
    if (!options.prompt.trim()) {
      setError("Please enter a prompt");
      logger.warn("Generation attempted with empty prompt");
      return;
    }

    logger.info("Starting image generation", { prompt: options.prompt.slice(0, 50), steps: options.steps, width: options.width, height: options.height });
    setGenerating(true);
    setError(null);
    setResult(null);
    setLivePreviewUrl(null);
    setProgress(0);
    setProgressStatus("Starting...");
    setCurrentStep(0);
    setTotalSteps(options.steps);
    setPromptId(null);

    try {
      // Submit the prompt and get prompt_id immediately
      const submitRes = await fetch(`/api/integrations/comfyui/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: options.prompt,
          negative_prompt: options.negativePrompt,
          steps: options.steps,
          cfg_scale: options.cfgScale,
          width: options.width,
          height: options.height,
          seed: options.seed,
          sampler: options.sampler,
          ckpt_name: options.model || undefined,
        }),
      });

      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({ detail: "Failed to submit prompt" }));
        throw new Error(err.detail || `Failed to submit prompt (${submitRes.status})`);
      }

      const submitData = await submitRes.json();
      setPromptId(submitData.prompt_id);
      setProgressStatus("Queued");
    } catch (e) {
      setError(getFriendlyError(e));
      logger.error("Image generation failed", { error: e instanceof Error ? e.message : String(e) });
      setGenerating(false);
    }
  };

  const handleQueueJob = useCallback(async () => {
    if (!options.prompt.trim()) {
      setError("Please enter a prompt");
      return;
    }

    setError(null);

    try {
      await api.queueImageJob(options.prompt, {
        negative_prompt: options.negativePrompt,
        steps: options.steps,
        cfg_scale: options.cfgScale,
        width: options.width,
        height: options.height,
        seed: options.seed,
        sampler: options.sampler,
        model: options.model,
      });
    } catch (e) {
      setError(getFriendlyError(e));
    }
  }, [options]);

  const handleReset = useCallback(() => {
    setOptions(defaultOptions);
    setActivePreset("standard");
    setResult(null);
    setLivePreviewUrl(null);
    setError(null);
    setProgress(0);
  }, []);

  const handleApplyPreset = useCallback((preset: GenerationPreset) => {
    setActivePreset(preset.id);
    setOptions((prev) => ({
      ...prev,
      ...preset.settings,
    }));
  }, []);

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="text-accent" size={24} />
            Image Generation
          </h1>
          <p className="text-muted mt-1">Create images with AI via ComfyUI</p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleReset}
          title="Reset all settings"
        >
          <RefreshCw size={14} />
          Reset
        </button>
      </div>

      <div className="grid grid-1 md:grid-cols-2 gap-6">
        {/* Generation Options */}
        <div className="space-y-4">
          <Card glow={!!options.prompt.trim()}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">1</span>
              Prompt
            </h3>
            <textarea
              className="input h-32 resize-none"
              placeholder="A futuristic city at sunset, cyberpunk style, highly detailed..."
              value={options.prompt}
              onChange={(e) => setOptions({ ...options, prompt: e.target.value })}
            />
            <div className="mt-2 text-xs text-muted">
              {options.prompt.length} characters
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-secondary/20 text-secondary text-xs flex items-center justify-center font-bold">2</span>
              Negative Prompt
            </h3>
            <textarea
              className="input h-24 resize-none"
              placeholder="blurry, low quality, distorted..."
              value={options.negativePrompt}
              onChange={(e) => setOptions({ ...options, negativePrompt: e.target.value })}
            />
          </Card>

          <Card title="Quick Presets" icon={<Sparkles size={18} />}>
            <p className="text-xs text-muted mb-3">Choose a starting point. You can still tweak individual settings below.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {presets.map((preset) => {
                const colors = colorMap[preset.color] || colorMap.blue;
                const isActive = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    className={`relative p-3 rounded-lg border text-left transition-all duration-200 ${
                      isActive
                        ? `${colors.bg} ${colors.border} ring-2 ${colors.ring} shadow-sm`
                        : "border-border bg-background hover:border-border/80 hover:bg-white/5"
                    }`}
                    onClick={() => handleApplyPreset(preset)}
                  >
                    <div className={`flex items-center gap-1.5 mb-1 ${isActive ? colors.text : "text-foreground"}`}
                    >
                      {preset.icon}
                      <span className="text-xs font-semibold">{preset.name}</span>
                    </div>
                    <p className="text-[10px] text-muted leading-tight">{preset.description}</p>
                    <div className="mt-1.5 flex items-center gap-1 text-[9px] text-muted/70">
                      <span>{preset.settings.steps} steps</span>
                      <span>·</span>
                      <span>{preset.settings.width}×{preset.settings.height}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Fine-Tune Settings" icon={<Settings2 size={18} />}>
            <div className="grid grid-2 gap-4">
              <div>
                <label className="label">Steps</label>
                <select
                  className="select"
                  value={options.steps}
                  onChange={(e) => setOptions({ ...options, steps: Number(e.target.value) })}
                >
                  <option value={10}>10 (fast)</option>
                  <option value={20}>20 (balanced)</option>
                  <option value={30}>30 (quality)</option>
                  <option value={50}>50 (max)</option>
                </select>
              </div>

              <div>
                <label className="label">CFG Scale</label>
                <select
                  className="select"
                  value={options.cfgScale}
                  onChange={(e) => setOptions({ ...options, cfgScale: Number(e.target.value) })}
                >
                  <option value={5}>5 (creative)</option>
                  <option value={7}>7 (balanced)</option>
                  <option value={10}>10 (precise)</option>
                  <option value={15}>15 (strict)</option>
                </select>
              </div>

              <div>
                <label className="label">Width</label>
                <select
                  className="select"
                  value={options.width}
                  onChange={(e) => setOptions({ ...options, width: Number(e.target.value) })}
                >
                  <option value={512}>512</option>
                  <option value={768}>768</option>
                  <option value={1024}>1024</option>
                </select>
              </div>

              <div>
                <label className="label">Height</label>
                <select
                  className="select"
                  value={options.height}
                  onChange={(e) => setOptions({ ...options, height: Number(e.target.value) })}
                >
                  <option value={512}>512</option>
                  <option value={768}>768</option>
                  <option value={1024}>1024</option>
                </select>
              </div>

              <div>
                <label className="label">Sampler</label>
                <select
                  className="select"
                  value={options.sampler}
                  onChange={(e) => setOptions({ ...options, sampler: e.target.value })}
                >
                  <option value="Euler a">Euler a</option>
                  <option value="Euler">Euler</option>
                  <option value="DPM++ 2M">DPM++ 2M</option>
                  <option value="DPM++ SDE">DPM++ SDE</option>
                </select>
              </div>

              <div>
                <label className="label">Seed (-1 for random)</label>
                <input
                  type="number"
                  className="input"
                  value={options.seed}
                  onChange={(e) => setOptions({ ...options, seed: Number(e.target.value) })}
                />
              </div>
            </div>
          </Card>

          {/* Progress */}
          {generating && (
            <Card>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{progressStatus === "completed" ? "Complete!" : "Generating..."}</span>
                <span className="text-sm text-muted">{Math.round(progress)}%</span>
              </div>
              <div className="progress-bar h-2 mb-2">
                <div
                  className="progress-fill progress-stripe"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Step {currentStep} / {totalSteps}</span>
                <span>{progressStatus}</span>
              </div>
            </Card>
          )}

          {/* Model Selector */}
          <Card>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">3</span>
              Model
            </h3>
            {loadingModels ? (
              <div className="flex items-center gap-2 text-sm text-muted py-2">
                <LoadingSpinner size="sm" />
                Loading models...
              </div>
            ) : models.length === 0 ? (
              <div className="text-sm text-muted py-2">No models found in checkpoints folder</div>
            ) : (
              <div className="space-y-2">
                {models.map((m) => {
                  const name = typeof m === "string" ? m : m.name || m.filename;
                  const info = getModelInfo(name);
                  const selected = options.model === name;
                  return (
                    <button
                      key={name}
                      className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${selected ? "border-accent bg-accent/10 shadow-sm" : "border-border bg-background hover:border-border/80 hover:bg-white/5"}`}
                      onClick={() => setOptions({ ...options, model: name })}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate mr-2">{name}</span>
                        {selected && <span className="text-xs text-accent shrink-0">Selected</span>}
                      </div>
                      {info && (
                        <div className="mt-1.5 space-y-1">
                          <p className="text-xs text-muted">{info.description}</p>
                          <div className="flex items-center gap-3 text-[10px]">
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{info.type}</span>
                            <span className="text-muted">Best for: {info.bestFor}</span>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Error */}
          {error && !generating && (
            <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error animate-scale-in">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              className="btn btn-primary flex-1 flex items-center justify-center gap-2"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <>
                  <LoadingSpinner size="sm" />
                  Generating...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Generate
                </>
              )}
            </button>

            <button
              className="btn btn-secondary flex items-center justify-center gap-2"
              onClick={handleQueueJob}
              disabled={generating}
            >
              <Clock size={16} />
              Queue
            </button>
          </div>
        </div>

        {/* Preview */}
        <div>
          <Card title={generating ? "Live Preview" : "Preview"} className="h-full min-h-[500px]" glow={!!result || generating}>
            {generating && livePreviewUrl ? (
              <div className="space-y-4 animate-fade-in">
                <div className="relative aspect-square bg-background rounded-lg overflow-hidden border border-border">
                  <img
                    src={livePreviewUrl}
                    alt="Generating preview"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 bg-black/70 rounded-full text-[10px] text-white font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>Step {currentStep} / {totalSteps}</span>
                    <span>{progressStatus}</span>
                  </div>
                  <div className="progress-bar h-2">
                    <div
                      className="progress-fill progress-stripe"
                      style={{ width: `${Math.max(progress, 5)}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : result ? (
              <div className="space-y-4 animate-scale-in">
                <div className="aspect-square bg-background rounded-lg overflow-hidden border border-border">
                  <img
                    src={`/output/images/${result.output_path.split(/[/\\]/).pop()}`}
                    alt="Generated"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = result.output_path;
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Seed: {result.seed}</span>
                  <StatusBadge status="completed" />
                </div>
                <div className="flex gap-2">
                  <a
                    href={`/output/images/${result.output_path.split(/[/\\]/).pop()}`}
                    download
                    className="btn btn-sm btn-secondary flex-1 flex items-center justify-center gap-1"
                  >
                    <Download size={14} />
                    Download
                  </a>
                  <button
                    className="btn btn-sm btn-ghost flex items-center justify-center gap-1"
                    onClick={handleGenerate}
                  >
                    <RefreshCw size={14} />
                    Regenerate
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No image generated"
                description="Enter a prompt and click Generate to create your first image"
                icon={<Image size={48} />}
                action={
                  options.prompt.trim() && !generating
                    ? { label: "Generate", onClick: handleGenerate, icon: <Play size={14} /> }
                    : undefined
                }
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
