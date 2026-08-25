import { useState, useCallback, useEffect } from "react";
import { Image, Play, Clock, Settings2, Sparkles, Download, RefreshCw } from "lucide-react";
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

const MODEL_INFO: Record<string, ModelInfo> = {
  "v1-5-pruned-emaonly": {
    description: "Stable Diffusion 1.5 — versatile general-purpose image generation model",
    type: "Image (SD 1.5)",
    bestFor: "General images, portraits, landscapes, concept art",
  },
  "hunyuan3d-dit-v2-mini": {
    description: "Hunyuan3D — generates 3D models from text prompts in mini/fast variant",
    type: "3D Generation",
    bestFor: "3D model creation, mesh generation, assets",
  },
};

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
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ output_path: string; seed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [models, setModels] = useState<CheckpointModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  // Fetch available checkpoint models (filtered to image models only)
  useEffect(() => {
    fetch("/api/integrations/comfyui/checkpoints")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.checkpoints?.length) {
          // Filter to only show image generation models
          const imageModels = data.checkpoints.filter((name: string) => {
            const baseName = name.replace(/\.(safetensors|ckpt|pt)$/i, "");
            return !!MODEL_INFO[baseName];
          });
          setModels(imageModels.map((name: string) => ({ name, filename: name, path: "", size: 0 })));
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

  const handleGenerate = useCallback(async () => {
    if (!options.prompt.trim()) {
      setError("Please enter a prompt");
      logger.warn("Generation attempted with empty prompt");
      return;
    }

    logger.info("Starting image generation", { prompt: options.prompt.slice(0, 50), steps: options.steps, width: options.width, height: options.height });
    setGenerating(true);
    setError(null);
    setResult(null);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 15, 90));
    }, 500);

    try {
      const res = await api.generateImage(options.prompt, {
        negativePrompt: options.negativePrompt,
        steps: options.steps,
        cfgScale: options.cfgScale,
        width: options.width,
        height: options.height,
        seed: options.seed,
        sampler: options.sampler,
        model: options.model,
      });
      setProgress(100);
      setResult(res);
      logger.info("Image generated successfully", { seed: res.seed, output: res.output_path });
    } catch (e) {
      setError(getFriendlyError(e));
      logger.error("Image generation failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      clearInterval(progressInterval);
      setGenerating(false);
    }
  }, [options]);

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
    setResult(null);
    setError(null);
    setProgress(0);
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

          <Card title="Generation Settings" icon={<Settings2 size={18} />}>
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
                <span className="text-sm font-medium">Generating...</span>
                <span className="text-sm text-muted">{Math.round(progress)}%</span>
              </div>
              <div className="progress-bar h-2">
                <div
                  className="progress-fill progress-stripe"
                  style={{ width: `${progress}%` }}
                />
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
                  const baseName = name.replace(/\.(safetensors|ckpt|pt)$/i, "");
                  const info = MODEL_INFO[baseName];
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
          <Card title="Preview" className="h-full min-h-[500px]" glow={!!result}>
            {result ? (
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
