/**
 * VideoGenerationPage — text-to-video and image-to-video generation.
 *
 * Supports three modes:
 *  - Text-to-Video (T2V): prompt only, no input image
 *  - Image-to-Video (I2V): prompt + uploaded start image (Wan TI2V / LTX I2V)
 *
 * Design follows Oct 2026 AI video generation UI best practices:
 *  - Sources, motion, format, duration, cost remain visible as separate decisions
 *  - Progress shown as named stages (queued → uploading → planning → rendering → ready)
 *  - Credit cost shown before rendering
 *  - Input validation checklist before upload
 *  - Result gallery with variation support
 *  - Inspiration gallery in empty state
 *
 * Main orchestrator — composes extracted components and delegates
 * stateful logic to custom hooks.
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Film,
  Wand2,
  Loader2,
  Download,
  AlertTriangle,
  RectangleHorizontal,
  Image as ImageIcon,
  Play,
  SkipForward,
  PlayCircle,
  RefreshCcw,
  Sparkles,
  Grid,
  CreditCard,
  Clock,
  Camera,
  ArrowRight,
} from "lucide-react";
import { DS } from "../../styles/designSystem";
import { StatusBadge } from "../../components/common";
import { Link } from "react-router-dom";
import { useVideoModels } from "./hooks/useVideoModels";
import { useJobProgress, useQueueStatus } from "./hooks";
import { QueueStatus } from "./components/QueueStatus";
import { ModelSelector } from "./components/ModelSelector";
import { AdvancedSettings } from "./components/AdvancedSettings";

interface VideoGenerationResult {
  job_id: string;
  status: string;
  output_path?: string;
  image_path?: string;
  mode?: "t2v" | "i2v";
  created_at?: number;
  estimatedCredits?: number;
}

interface ExamplePrompt {
  label: string;
  prompt: string;
  thumbnail?: string;
}

interface InspirationItem {
  id: string;
  label: string;
  prompt: string;
  thumbnail: string;
  mode: "t2v" | "i2v";
}

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  { label: "Cinematic", prompt: "A cinematic shot of a futuristic city at sunset, volumetric lighting, 8k" },
  { label: "Nature", prompt: "A serene mountain landscape with a lake, golden hour, misty atmosphere" },
  { label: "Abstract", prompt: "Abstract flowing colors, liquid motion, psychedelic patterns, vibrant" },
  { label: "Cyberpunk", prompt: "Cyberpunk street scene, neon lights, rain, holographic advertisements" },
];

const INSPIRATION_GALLERY: InspirationItem[] = [
  {
    id: "cinematic-city",
    label: "Cinematic City",
    prompt: "A cinematic shot of a futuristic city at sunset, volumetric lighting, 8k",
    thumbnail: "https://images.unsplash.com/photo-1536147518-57116d4173bb?w=400&h=225&fit=crop",
    mode: "t2v",
  },
  {
    id: "mountain-lake",
    label: "Mountain Lake",
    prompt: "A serene mountain landscape with a lake, golden hour, misty atmosphere",
    thumbnail: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&h=225&fit=crop",
    mode: "t2v",
  },
  {
    id: "cyberpunk-street",
    label: "Cyberpunk Street",
    prompt: "Cyberpunk street scene, neon lights, rain, holographic advertisements",
    thumbnail: "https://images.unsplash.com/photo-1518637306423-7825e9428b1e?w=400&h=225&fit=crop",
    mode: "t2v",
  },
  {
    id: "abstract-liquid",
    label: "Abstract Liquid",
    prompt: "Abstract flowing colors, liquid motion, psychedelic patterns",
    thumbnail: "https://images.unsplash.com/photo-1550684838-f32a687403d3?w=400&h=225&fit=crop",
    mode: "t2v",
  },
];

const RESOLUTION_PRESETS = [
  { label: "480p", w: 832, h: 480, vramSafe: true, desc: "8GB VRAM safe" },
  { label: "720p", w: 1280, h: 720, vramSafe: false, desc: "Needs 12GB+ VRAM" },
  { label: "1080p", w: 1920, h: 1080, vramSafe: false, desc: "Needs 16GB+ VRAM" },
];

const CAMERA_MOTION_OPTIONS = [
  { label: "None", value: "none", desc: "Static camera" },
  { label: "Push In", value: "push_in", desc: "Slow dolly toward subject" },
  { label: "Pull Out", value: "pull_out", desc: "Slow dolly away from subject" },
  { label: "Pan Left", value: "pan_left", desc: "Camera pans to the left" },
  { label: "Pan Right", value: "pan_right", desc: "Camera pans to the right" },
  { label: "Tilt Up", value: "tilt_up", desc: "Camera tilts upward" },
  { label: "Tilt Down", value: "tilt_down", desc: "Camera tilts downward" },
  { label: "Zoom In", value: "zoom_in", desc: "Optical zoom toward subject" },
  { label: "Orbit", value: "orbit", desc: "Camera orbits around subject" },
];

const IMAGE_ROLE_OPTIONS = [
  { label: "First Frame", value: "first_frame", desc: "Animate this image as the starting frame" },
  { label: "Inspiration", value: "inspiration", desc: "Use image as style reference only" },
  { label: "Editing Target", value: "editing_target", desc: "Modify elements within this image" },
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

  const { startProgressPolling } = useJobProgress();
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
  const [imageRole, setImageRole] = useState("first_frame");
  const [cameraMotion, setCameraMotion] = useState("none");
  const [motionStrength, setMotionStrength] = useState(5);
  const [promptEnhance, setPromptEnhance] = useState(true);
  const [selectedResult, setSelectedResult] = useState<string | null>(null);

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

  // Credit cost estimate based on duration, resolution, model type
  const estimatedCredits = useMemo(() => {
    const w = RESOLUTION_PRESETS.find((r) => r.label === selectedAspect)?.w || 832;
    const h = RESOLUTION_PRESETS.find((r) => r.label === selectedAspect)?.h || 480;
    const megapixels = (w * h) / 1_000_000;
    const modelMultiplier = selectedModelInfo?.type?.includes("LTX") ? 0.8 : 1.2;
    const motionMultiplier = 1 + motionStrength / 20;
    const baseCredits = duration * megapixels * modelMultiplier * motionMultiplier;
    return Math.ceil(baseCredits * 10) / 10;
  }, [duration, selectedAspect, selectedModelInfo, motionStrength]);

  // Map job status to named stage for progress display
  const stageForStatus = useCallback((status: string | undefined): string => {
    switch (status) {
      case "queued":
        return "Queued";
      case "uploading":
        return "Uploading image";
      case "planning":
        return "Planning motion";
      case "generating":
        return "Rendering frames";
      case "encoding":
        return "Encoding video";
      case "completed":
        return "Ready";
      case "failed":
        return "Failed";
      default:
        return "Queued";
    }
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const body = {
        prompt: promptEnhance ? `[enhanced] ${prompt}` : prompt,
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
        enrich_prompt: promptEnhance,
        // I2V-specific fields
        image_path: mode === "i2v" && uploadedImagePath ? uploadedImagePath : undefined,
        image_role: mode === "i2v" ? imageRole : undefined,
        camera_motion: cameraMotion,
        motion_strength: motionStrength,
        estimated_credits: estimatedCredits,
      };

      const res = await fetch("/api/video/generate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      const data = await res.json();
      setResults((prev) => [
        ...prev,
        { ...data, status: "queued", mode, created_at: Date.now(), estimatedCredits },
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

  const handleVariation = () => {
    // Create a variation: same prompt, slight motion strength change
    setMotionStrength(Math.min(10, motionStrength + 1));
    handleGenerate();
  };

  const handleSelectResult = (jobId: string) => {
    setSelectedResult(selectedResult === jobId ? null : jobId);
  };

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    if (!prompt.trim()) issues.push("Enter a description of your video");
    if (mode === "i2v" && !uploadedImagePath) issues.push("Upload a start image");
    if (duration < 1 || duration > 30) issues.push("Duration must be between 1 and 30 seconds");
    if (!selectedModel) issues.push("Select a video model");
    if (comfyStatus === "offline") issues.push("ComfyUI is offline — start it first");
    return issues;
  }, [prompt, mode, uploadedImagePath, duration, selectedModel, comfyStatus]);

  return (
    <div className={DS.page}>
      {/* ComfyUI Offline Banner — prominent placement at top */}
      {comfyStatus === "offline" && (
        <div className={DS.cardError}>
          <AlertTriangle size={20} />
          <div>
            <div className="text-sm font-semibold text-red-300">ComfyUI is offline</div>
            <div className="text-xs text-red-200">
              Video generation requires ComfyUI to be running. Start it first, then return here to generate.
            </div>
          </div>
          <button
            onClick={refetchModels}
            className="text-xs underline text-red-200 hover:text-white ml-auto"
          >
            Retry
          </button>
        </div>
      )}
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

      {/* View context breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-muted mb-4">
        <span className="text-violet-400">Video Generation</span>
        <span className="text-muted">/</span>
        <Link
          to="/library"
          className="text-violet-400 hover:underline hover:text-violet-300"
          title="Go to Media Library"
        >
          Media Library
        </Link>
      </nav>

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
            disabled={comfyStatus === "offline"}
            className={`p-3 rounded-lg border text-center transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === "i2v"
                ? "border-accent bg-violet-500/20 text-violet-400 shadow-sm"
                : comfyStatus === "offline"
                  ? "border-border bg-surface/50 text-muted"
                  : "border-border bg-surface hover:border-border/80"
            }`}
            title={comfyStatus === "offline" ? "ComfyUI is offline — start it first" : undefined}
          >
            <ImageIcon size={14} />
            <div className="mt-1 text-xs">Image → Video</div>
          </button>
        </div>
      </div>

      {/* Credit Estimator Banner */}
      <div className={DS.card} style={{ padding: 12 }}>
        <div className="flex items-center gap-3">
          <CreditCard size={16} className="text-violet-400" />
          <div className="flex-1">
            <div className="text-xs font-semibold text-foreground mb-0.5">Estimated cost</div>
            <div className="text-sm font-mono text-foreground">
              {estimatedCredits} credits
            </div>
            <div className="text-[10px] text-muted">
              ~{estimatedSeconds()}s render • {selectedModelInfo?.type || "unknown"} model
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-foreground">Duration</div>
            <div className="text-sm font-mono text-foreground">{duration}s</div>
          </div>
        </div>
        {validationIssues.length > 0 && (
          <div className="mt-2 flex items-center gap-1">
            <AlertTriangle size={12} className="text-amber-400" />
            <span className="text-xs text-amber-300">{validationIssues.join(", ")}</span>
          </div>
        )}
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
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-foreground">Image role</label>
                    <select
                      value={imageRole}
                      onChange={(e) => setImageRole(e.target.value)}
                      className="text-xs rounded border border-border bg-surface px-2 py-1"
                    >
                      {IMAGE_ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted">{IMAGE_ROLE_OPTIONS.find((o) => o.value === imageRole)?.desc}</p>
                  </div>
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
                    className="text-xs text-muted hover:text-violet-400 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 rounded"
                  >
                    {ex.label}
                  </button>
              ))}
              <button
                onClick={() => setPromptEnhance((v) => !v)}
                className={`text-xs ${promptEnhance ? "text-violet-400" : "text-muted"} hover:text-violet-400 flex items-center gap-1`}
              >
                <Sparkles size={12} />
                {promptEnhance ? "Enhance ON" : "Enhance OFF"}
              </button>
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

          {/* Camera Motion Controls */}
          <div className={DS.card} style={{ padding: 16 }}>
            <div className="flex items-center gap-2 mb-3">
              <Camera size={16} />
              <h3 className="text-sm font-semibold text-foreground">Camera Motion</h3>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {CAMERA_MOTION_OPTIONS.map((opt) => {
                const isActive = cameraMotion === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setCameraMotion(opt.value)}
                    className={`whitespace-nowrap px-3 py-1.5 rounded-lg border text-xs transition-all ${
                      isActive
                        ? "border-accent bg-violet-500/20 text-violet-400 shadow-sm"
                        : "border-border bg-surface hover:border-border/80"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-muted mb-1">
                <span>Motion Strength</span>
                <span>{motionStrength}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={motionStrength}
                onChange={(e) => setMotionStrength(Number(e.target.value))}
                className="w-full accent-violet-400"
              />
            </div>
          </div>

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
              validationIssues.length > 0
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
              <Clock size={12} className="mr-1" />
              ⏱ Estimated: ~{estimatedSeconds()}s • Mode: {mode.toUpperCase()} • Model: {selectedModelInfo?.type || "unknown"}
            </span>
          </div>
        </div>

        {/* Right — Results & Queue */}
        <div className="space-y-4">
          <QueueStatus info={queueInfo} />

          {/* Inspiration Gallery (shown when no results) */}
          {results.length === 0 && !generating && (
            <div className={DS.card} style={{ padding: 16 }}>
              <div className="flex items-center gap-2 mb-3">
                <Grid size={16} />
                <h3 className="text-sm font-semibold text-foreground">Inspiration Gallery</h3>
              </div>
              <p className="text-xs text-muted mb-3">
                Click an example to load it into the prompt field
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {INSPIRATION_GALLERY.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setPrompt(item.prompt);
                      setMode(item.mode);
                    }}
                    className="group relative rounded-xl overflow-hidden border border-border bg-surface hover:border-accent/60 hover:shadow-lg hover:shadow-violet-500/20 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                  >
                    <img
                      src={item.thumbnail}
                      alt={item.label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center group-hover:bg-black/60 transition-colors duration-300">
                      <PlayCircle size={24} className="text-white/95 bg-black/70 rounded-full p-2 shadow-lg" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 via-transparent to-transparent">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white">{item.label}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${
                          item.mode === "i2v" ? "border-violet-500 text-violet-400 bg-violet-500/20" : "border-blue-500 text-blue-400 bg-blue-500/20"
                        }`}>
                          {item.mode.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Generation Progress */}
          {generating && (
            <div className={DS.card} style={{ padding: 16 }}>
              <div className="flex items-center gap-2 mb-3">
                <Loader2 size={16} className="animate-spin text-violet-400" />
                <h3 className="text-sm font-semibold text-foreground">Generating</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Stage</span>
                  <span className="text-foreground font-medium">Planning motion</span>
                </div>
                <div className="w-full bg-surface rounded-full h-2">
                  <div className="bg-violet-500 h-2 rounded-full" style={{ width: "30%" }} />
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>Estimated time remaining</span>
                  <span>{estimatedSeconds()}s</span>
                </div>
              </div>
            </div>
          )}

          {/* Results Gallery */}
          <div className="space-y-2 flex-1">
            {results.length === 0 && !generating && (
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
              const isSelected = selectedResult === r.job_id;
              return (
                <div
                  key={r.job_id || idx}
                  onClick={() => handleSelectResult(r.job_id || "")}
                  className={`cursor-pointer rounded-lg border p-3 transition-all ${
                    isSelected ? "ring-2 ring-accent bg-violet-500/10" : "border-border hover:border-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">
                        {r.job_id}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                        isI2V ? "border-violet-500 text-violet-400 bg-violet-500/10" : "border-blue-500 text-blue-400 bg-blue-500/10"
                      }`}>
                        {isI2V ? "I2V" : "T2V"}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    {isCompleted && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(r.job_id || "");
                          }}
                          className="btn btn-xs btn-secondary flex items-center gap-1"
                          title="Download MP4"
                        >
                          <Download size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVariation();
                          }}
                          className="btn btn-xs btn-ghost flex items-center gap-1"
                          title="Create variation"
                        >
                          <RefreshCcw size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  {isCompleted && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="aspect-video bg-surface rounded border border-border overflow-hidden flex-shrink-0">
                        <video
                          src={`/output/video/${(r.output_path || r.job_id).split("/").pop()}`}
                          className="w-32 h-20 object-cover"
                          preload="metadata"
                          poster=""
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted">Duration</span>
                          <span className="text-foreground">{duration}s</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted">Credits</span>
                          <span className="font-mono">{r.estimatedCredits}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {!isCompleted && r.status !== "failed" && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted">{stageForStatus(r.status)}</span>
                        <span className="text-violet-400">{r.status}</span>
                      </div>
                      <div className="w-full bg-surface rounded-full h-1">
                        <div className="bg-violet-500 h-1 rounded-full" style={{ width: "50%" }} />
                      </div>
                    </div>
                  )}
                  {r.status === "failed" && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle size={12} />
                      <span>Generation failed</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected Result Detail */}
          {selectedResult && results.some((r) => r.job_id === selectedResult) && (
            <div className={DS.card} style={{ padding: 16 }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">Result Details</h3>
                <button
                  onClick={() => setSelectedResult(null)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Close <ArrowRight size={12} className="ml-1" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-lg p-2">
                    <div className="text-[10px] text-muted">Mode</div>
                    <div className="text-sm text-foreground">
                      {results.find((r) => r.job_id === selectedResult)?.mode?.toUpperCase()}
                    </div>
                  </div>
                  <div className="bg-surface rounded-lg p-2">
                    <div className="text-[10px] text-muted">Resolution</div>
                    <div className="text-sm text-foreground">
                      {RESOLUTION_PRESETS.find((r) => r.label === selectedAspect)?.w}×{RESOLUTION_PRESETS.find((r) => r.label === selectedAspect)?.h}
                    </div>
                  </div>
                  <div className="bg-surface rounded-lg p-2">
                    <div className="text-[10px] text-muted">Duration</div>
                    <div className="text-sm text-foreground">{duration}s</div>
                  </div>
                  <div className="bg-surface rounded-lg p-2">
                    <div className="text-[10px] text-muted">Credits</div>
                    <div className="text-sm font-mono text-foreground">
                      {results.find((r) => r.job_id === selectedResult)?.estimatedCredits}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const r = results.find((x) => x.job_id === selectedResult);
                    if (r) handleDownload(r.job_id || "");
                  }}
                  className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                  <Download size={14} />
                  Download MP4
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}