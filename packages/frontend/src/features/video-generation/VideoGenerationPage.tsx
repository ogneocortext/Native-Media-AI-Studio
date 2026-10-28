/**
 * VideoGenerationPage — text-to-video and image-to-video generation.
 *
 * Supports three modes:
 *  - Text-to-Video (T2V): prompt only, no input image
 *  - Image-to-Video (I2V): prompt + uploaded start image (Wan TI2V / LTX I2V)
 *
 * Main orchestrator — composes extracted components and delegates
 * stateful logic to custom hooks.
 */
import { useState, useCallback, useEffect } from "react";
import {
  Film,
  Wand2,
  Loader2,
  Download,
  RefreshCw,
  AlertTriangle,
  RectangleHorizontal,
  Image as ImageIcon,
  Play,
  SkipForward,
} from "lucide-react";
import { DS } from "../../styles/designSystem";
import { StatusBadge } from "../../components/common";
import { useVideoModels } from "./hooks/useVideoModels";
import { useJobProgress, useQueueStatus } from "./hooks";
import { QueueStatus } from "./components/QueueStatus";
import { JobProgress } from "./components/JobProgress";
import { ModelSelector } from "./components/ModelSelector";
import { AdvancedSettings } from "./components/AdvancedSettings";

interface VideoGenerationResult {
  job_id: string;
  status: string;
  output_path?: string;
  image_path?: string;
  mode?: "t2v" | "i2v";
}

interface ExamplePrompt {
  label: string;
  prompt: string;
}

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  { label: "Cinematic", prompt: "A cinematic shot of a futuristic city at sunset, volumetric lighting, 8k" },
  { label: "Nature", prompt: "A serene mountain landscape with a lake, golden hour, misty atmosphere" },
  { label: "Abstract", prompt: "Abstract flowing colors, liquid motion, psychedelic patterns, vibrant" },
  { label: "Cyberpunk", prompt: "Cyberpunk street scene, neon lights, rain, holographic advertisements" },
];

const RESOLUTION_PRESETS = [
  { label: "480p", w: 832, h: 480, vramSafe: true, desc: "8GB VRAM safe" },
  { label: "720p", w: 1280, h: 720, vramSafe: false, desc: "Needs 12GB+ VRAM" },
  { label: "1080p", w: 1920, h: 1080, vramSafe: false, desc: "Needs 16GB+ VRAM" },
];

/**
 * Main orchestrator for the video generation page.
 *
 * Responsibilities:
 * - Compose UI sections (mode toggle, model selector, form, results, queue)
 * - Delegate state management to hooks
 * - Handle cross-component coordination (e.g., progress polling)
 */
export function VideoGenerationPage() {
  const {
    videoModels,
    loadingModels,
    comfyStatus,
    error: modelsError,
    refetch: refetchModels,
  } = useVideoModels();

  const { jobProgress, startProgressPolling } = useJobProgress();
  const { queueInfo } = useQueueStatus();

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(
    "blurry, low quality, distorted"
  );
  const [selectedModel, setSelectedModel] = useState("");
  const [duration, setDuration] = useState(10);
  const [verticalFirst, setVerticalFirst] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<VideoGenerationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scheduler, setScheduler] = useState("normal");
  const [fps, setFps] = useState(12);
  const [resolution, setResolution] = useState("480p");
  const [batchCount, setBatchCount] = useState(1);
  const [selectedAspect, setSelectedAspect] = useState("480p");
  const [mode, setMode] = useState<"t2v" | "i2v">("t2v");
  const [inputImagePreview, setInputImagePreview] = useState<string | null>(null);
  const [uploadedImagePath, setUploadedImagePath] = useState<string | null>(null);

  // Auto-select first 8GB-safe video model on load
  useEffect(() => {
    if (!selectedModel && videoModels.length > 0) {
      const safeModel = videoModels.find((m) => m.supports_8gb ?? true);
      if (safeModel) {
        setSelectedModel(safeModel.name);
      }
    }
  }, [videoModels, selectedModel]);

  // Pick up a pending I2V image sent from the Image Generation page
  useEffect(() => {
    try {
      const pending = localStorage.getItem("nma:i2v:image");
      if (pending && mode === "t2v") {
        setMode("i2v");
      }
    } catch {
      // localStorage unavailable — ignore and proceed without pending I2V image
    }
  }, []);

  // Upload image to backend ComfyUI input directory when mode switches to I2V
  const handleImageUpload = useCallback(async (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => setInputImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    const form = new FormData();
    form.append("image", file);
    try {
      const res = await fetch("/api/integrations/comfyui/upload-image", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`Image upload failed: ${res.status}`);
      const data = await res.json();
      setUploadedImagePath(data.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image upload failed");
    }
  }, []);

  const clearInputImage = useCallback(() => {
    setInputImagePreview(null);
    setUploadedImagePath(null);
  }, []);

  // Get selected model info for VRAM warning
  const selectedModelInfo = videoModels.find((m) => m.name === selectedModel);
  const vramWarning =
    selectedModelInfo &&
    (selectedModelInfo.supports_8gb === false ||
      (selectedModelInfo.vram_mb && selectedModelInfo.vram_mb > 8000));

  const estimatedSeconds = useCallback(() => {
    // Rough estimate: LTX ~210s for 25 frames, Wan ~300-600s
    const base = selectedModelInfo?.type?.includes("LTX") ? 210 : 400;
    return Math.round((base / 25) * (duration * (fps / 12)));
  }, [selectedModelInfo, duration, fps]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const body: Record<string, any> = {
        prompt,
        negative_prompt: negativePrompt,
        model: selectedModel,
        duration,
        vertical_first: verticalFirst,
        scheduler,
        fps,
        resolution,
        batch_count: batchCount,
        width: RESOLUTION_PRESETS.find((r) => r.label === selectedAspect)?.w || 832,
        height: RESOLUTION_PRESETS.find((r) => r.label === selectedAspect)?.h || 480,
        enrich_prompt: false,
      };
      // Pass image_path for I2V mode (already uploaded to ComfyUI input/)
      if (mode === "i2v" && uploadedImagePath) {
        body.image_path = uploadedImagePath;
      }

      const res = await fetch("/api/video/generate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      const data = await res.json();
      setResults((prev) => [
        ...prev,
        { ...data, status: "queued", mode },
      ]);
      startProgressPolling(data.job_id);
      setGenerating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setGenerating(false);
    }
  };

  const handleDownload = (jobId: string) => {
    const result = results.find((r) => r.job_id === jobId);
    if (result?.output_path) {
      const a = document.createElement("a");
      a.href = `/output/video/${result.output_path.split("/").pop()}`;
      a.download = `${jobId}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleRegenerate = () => {
    handleGenerate();
  };

  return (
    <div className={DS.page}>
      {modelsError && (
        <div className={DS.cardError}>
          <span>Failed to load models</span>
          <button
            onClick={refetchModels}
            className="text-xs underline text-red-200 hover:text-white"
          >
            Retry
          </button>
        </div>
      )}
      {error && (
        <div className={DS.cardError}>{error}</div>
      )}

      {/* VRAM Warning Banner */}
      {vramWarning && (
        <div className={DS.cardWarning}>
          <AlertTriangle size={16} />
          <span className="text-sm">
            {selectedModelInfo?.name} may exceed 8 GB VRAM. Generation could be slow or fail on this GPU.
          </span>
        </div>
      )}

      {/* Mode Toggle: T2V / I2V */}
      <div className={DS.card} style={{ padding: 16 }}>
        <div className="flex items-center gap-2 mb-3">
          <ImageIcon size={16} />
          <h3 className="text-sm font-semibold text-foreground">Generation Mode</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("t2v")}
            className={`p-3 rounded-lg border text-center transition-all font-medium ${
              mode === "t2v"
                ? "border-accent bg-violet-500/20 text-violet-400 shadow-sm"
                : "border-border bg-surface hover:border-border/80"
            }`}
          >
            <Play size={14} />
            <div className="mt-1 text-xs">Text → Video</div>
          </button>
          <button
            onClick={() => setMode("i2v")}
            className={`p-3 rounded-lg border text-center transition-all font-medium ${
              mode === "i2v"
                ? "border-accent bg-violet-500/20 text-violet-400 shadow-sm"
                : "border-border bg-surface hover:border-border/80"
            }`}
          >
            <ImageIcon size={14} />
            <div className="mt-1 text-xs">Image → Video</div>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Controls */}
        <div className="space-y-4">
          <ModelSelector
            models={videoModels}
            loading={loadingModels}
            status={comfyStatus}
            selected={selectedModel}
            onChange={setSelectedModel}
          />

          {/* Image upload (I2V only) */}
          {mode === "i2v" && (
            <div className={DS.card} style={{ padding: 16 }}>
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon size={16} />
                <h3 className="text-sm font-semibold text-foreground">Start Image</h3>
              </div>
              {inputImagePreview ? (
                <div className="space-y-2">
                  <img
                    src={inputImagePreview}
                    alt="Start image preview"
                    className="w-full h-48 object-cover rounded-lg border border-border bg-surface"
                  />
                  <button
                    onClick={clearInputImage}
                    className="text-xs text-destructive hover:text-destructive/80 underline"
                  >
                    Remove image
                  </button>
                </div>
              ) : (
                <label className="block cursor-pointer border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-accent/50 hover:bg-accent/5 transition-colors">
                  <ImageIcon size={24} className="mx-auto mb-2 text-muted" />
                  <p className="text-sm text-foreground font-medium mb-1">Click to upload image</p>
                  <p className="text-xs text-muted">
                    Uploaded to ComfyUI input directory for I2V
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                    }}
                  />
                </label>
              )}
            </div>
          )}

          <div className={DS.card} style={{ padding: 16 }}>
            <div className="flex items-center gap-2 mb-3">
              <Film size={16} />
              <h3 className="text-sm font-semibold text-foreground">Generation</h3>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your video..."
              className={`${DS.textarea} w-full`}
              rows={4}
            />
            <div className="mt-2 flex gap-2">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => setPrompt(ex.prompt)}
                  className="text-xs text-muted hover:text-violet-400 underline underline-offset-4"
                >
                  {ex.label}
                </button>
              ))}
            </div>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Negative prompt (optional)"
              className={`${DS.textarea} w-full mt-2`}
              rows={2}
            />
          </div>

          <AdvancedSettings
            show={showAdvanced}
            onToggle={() => setShowAdvanced((v) => !v)}
            duration={duration}
            onDurationChange={setDuration}
            verticalFirst={verticalFirst}
            onVerticalFirstChange={setVerticalFirst}
            scheduler={scheduler}
            onSchedulerChange={setScheduler}
            onRandomSeed={() => {}}
            fps={fps}
            onFpsChange={setFps}
            resolution={resolution}
            onResolutionChange={setResolution}
            batchCount={batchCount}
            onBatchCountChange={setBatchCount}
          />

          {/* Aspect Ratio / Resolution Presets */}
          <div className={DS.card} style={{ padding: 16 }}>
            <div className="flex items-center gap-2 mb-3">
              <RectangleHorizontal size={16} />
              <h3 className="text-sm font-semibold text-foreground">Resolution</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {RESOLUTION_PRESETS.map((r) => {
                const isActive = selectedAspect === r.label;
                return (
                  <button
                    key={r.label}
                    onClick={() => {
                      setSelectedAspect(r.label);
                      setResolution(r.label);
                    }}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isActive
                        ? "border-accent bg-violet-500/20 text-violet-400 shadow-sm"
                        : "border-border bg-surface hover:border-border/80"
                    }`}
                  >
                    <div className="text-xs font-semibold">{r.label}</div>
                    <div className="text-[10px] text-muted">{r.w}×{r.h}</div>
                    <div className="text-[10px] text-muted">{r.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={
              generating ||
              !prompt.trim() ||
              comfyStatus === "offline" ||
              (mode === "i2v" && !uploadedImagePath)
            }
            className={DS.btnFull}
          >
            {generating ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Generating...
              </>
            ) : (
              <>
                {mode === "i2v" ? (
                  <>
                    <SkipForward size={18} />
                    Image → Video
                  </>
                ) : (
                  <>
                    <Wand2 size={18} />
                    Generate Video
                  </>
                )}
              </>
            )}
          </button>

          {/* Estimated time */}
          <div className={DS.cardWarning}>
            <span className="text-xs text-muted">
              ⏱ Estimated: ~{estimatedSeconds()}s • Mode: {mode.toUpperCase()} • Model: {selectedModelInfo?.type || "unknown"}
            </span>
          </div>
        </div>

        {/* Right — Results & Queue */}
        <div className="space-y-4">
          <QueueStatus info={queueInfo} />

          <div className="space-y-2 flex-1">
            {results.length === 0 && (
              <div className="text-center py-12 animate-fade-in">
                <div className="mx-auto mb-4 text-muted/40 animate-float">
                  <Film size={48} />
                </div>
                <p className="text-muted text-base font-medium">No videos generated yet</p>
                <p className="text-muted/70 text-sm mt-2 max-w-md mx-auto">
                  Enter a prompt above and click Generate to create your first video
                </p>
              </div>
            )}
            {results.map((r: VideoGenerationResult, idx: number) => {
              const isCompleted = r.status === "completed";
              const isI2V = r.mode === "i2v";
              return (
                <div
                  key={r.job_id || idx}
                  className={DS.card}
                  style={{ padding: 16 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {r.job_id}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        isI2V ? "border-violet-500 text-violet-400 bg-violet-500/10" : "border-blue-500 text-blue-400 bg-blue-500/10"
                      }`}>
                        {isI2V ? "I2V" : "T2V"}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    {isCompleted && (
                      <button
                        onClick={() => handleDownload(r.job_id || "")}
                        className="btn btn-sm btn-secondary flex items-center gap-1"
                        title="Download MP4"
                      >
                        <Download size={14} />
                        Download
                      </button>
                    )}
                  </div>
                  {isCompleted && (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="aspect-video bg-surface rounded-lg border border-border overflow-hidden">
                        <video
                          src={`/output/video/${(r.output_path || r.job_id).split("/").pop()}`}
                          className="w-full h-full object-cover"
                          preload="metadata"
                          poster=""
                        />
                      </div>
                      <button
                        onClick={handleRegenerate}
                        className="btn btn-sm btn-ghost flex items-center gap-1"
                        title="Regenerate with same settings"
                      >
                        <RefreshCw size={14} />
                        Regenerate
                      </button>
                    </div>
                  )}
                  {jobProgress && <JobProgress progress={jobProgress} />}
                </div>
              );
            })}
            {jobProgress && <JobProgress progress={jobProgress} />}
          </div>
        </div>
      </div>
    </div>
  );
}
