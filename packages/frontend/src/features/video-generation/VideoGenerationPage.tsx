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
import { fetchWithTimeout } from "../../services/fetchWithTimeout";

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
  path?: string;
  size_mb?: number;
  variant?: string;
  supports_8gb?: boolean;
  requires_cpu_offload?: boolean;
  vram_mb?: number;
}

interface RawVideoModel {
  name: string;
  variant?: string;
  size_mb?: number;
  path?: string;
  supports_8gb?: boolean;
  requires_cpu_offload?: boolean;
  vram_mb?: number;
}

interface RawJob {
  id?: string;
  status?: string;
  progress?: number;
  params?: Record<string, unknown>;
  error?: string;
}

function getVideoModelInfo(modelName: string, meta?: Partial<VideoModel>): VideoModel {
  const base = modelName.toLowerCase();
  const variant = meta?.variant || "";
  const vramMb = meta?.vram_mb;
  const supports8gb = meta?.supports_8gb ?? true;

  if (base.includes("mm_sd15") || base.includes("mm_sd_v15") || base.includes("mm-stabilized")) {
    return { name: modelName, description: "AnimateDiff motion module — adds temporal consistency to SD 1.5", type: "Motion Module", bestFor: "Required for AnimateDiff video generation", variant, size_mb: meta?.size_mb, path: meta?.path };
  }
  if (base.includes("v2_lora") || base.includes("motion_lora")) {
    return { name: modelName, description: "AnimateDiff motion LoRA — camera movements (zoom, pan)", type: "Motion LoRA", bestFor: "Camera motion effects", variant, size_mb: meta?.size_mb, path: meta?.path };
  }
  if (base.includes("wan") && (base.includes("1.3b") || base.includes("1_3b"))) {
    const isFun = base.includes("fun") && base.includes("inp");
    const vramNote = vramMb ? ` — ~${vramMb} MB VRAM` : "";
    if (isFun) {
      return {
        name: modelName,
        description: `Wan 2.1 Fun InP 1.3B — image-to-video for consistent identity${vramNote}`,
        type: "Image-to-Video (1.3B)",
        bestFor: supports8gb ? "Animate a still for consistent identity — 832×480 on 8GB" : "Image-to-video",
        variant: variant ?? "1.3B",
        size_mb: meta?.size_mb,
        path: meta?.path,
      };
    }
    return {
      name: modelName,
      description: `Wan 2.1 T2V 1.3B — 6GB class text-to-video${vramNote}`,
      type: "Text-to-Video (1.3B)",
      bestFor: supports8gb ? "832×480, 49–97 frames on 8GB — fastest iteration" : "Text-to-video",
      variant: variant ?? "1.3B",
      size_mb: meta?.size_mb,
      path: meta?.path,
    };
  }
  if (base.includes("wan") && base.includes("ti2v")) {
    const isGguf = variant === "gguf_q4" || variant === "gguf_q5" || base.includes("gguf") || base.includes("q4") || base.includes("q5");
    const vramNote = vramMb ? ` — ~${vramMb} MB VRAM` : "";
    if (isGguf) {
      return {
        name: modelName,
        description: `Wan 2.2 TI2V-5B GGUF — 8GB-safe quantized variant${vramNote}`,
        type: "Text-to-Video (GGUF)",
        bestFor: supports8gb ? "Short clips on 8GB GPUs (CPU T5 offload)" : "Short clips (requires more VRAM)",
        variant,
        size_mb: meta?.size_mb,
        path: meta?.path,
      };
    }
    return { name: modelName, description: "Wan 2.2 TI2V-5B — full-precision text-to-video (needs 16-24GB VRAM)", type: "Text-to-Video (FP16)", bestFor: "Short clips on high-VRAM GPUs", variant: "fp16", size_mb: meta?.size_mb, path: meta?.path };
  }
  if (base.includes("kandinsky")) {
    return { name: modelName, description: "Kandinsky 5 Lite — image-to-video model", type: "Image-to-Video", bestFor: "Animating still images", variant, size_mb: meta?.size_mb, path: meta?.path };
  }
  return { name: modelName, description: `Video model: ${modelName}`, type: "Video", bestFor: "Video generation", variant, size_mb: meta?.size_mb, path: meta?.path };
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
  const queueIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const trackedJobIdsRef = useRef<Set<string>>(new Set());
  const generatingRef = useRef(generating);
  const activeJobIdRef = useRef(activeJobId);
  const jobProgressRef = useRef<JobProgress | null>(null);
  const [comfyStatus, setComfyStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const [selectedMotionLora, setSelectedMotionLora] = useState<string>("");
  const [scheduler, setScheduler] = useState<string>("normal");
  const [seed, setSeed] = useState<number>(-1);
  const [fps, setFps] = useState<number>(8);
  const [resolution, setResolution] = useState<string>("480p");
  const [batchCount, setBatchCount] = useState<number>(1);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [queueInfo, setQueueInfo] = useState<{ running: number; pending: number } | null>(null);
  const [startImage, setStartImage] = useState<string>("");
  const [imageToVideoMode, setImageToVideoMode] = useState<boolean>(false);

  useEffect(() => {
    loadData();
    // Fetch video models from ComfyUI — single source is /video-models (covers
    // diffusion_models, animatediff, checkpoints). Checkpoints endpoint is legacy
    // and misses GGUF — don't merge a filtered subset on top.
    const fetchVideoModels = async () => {
      try {
        const vmRes = await fetchWithTimeout("/api/integrations/comfyui/video-models", { timeout: 15000 });
        if (!vmRes.ok) throw new Error(`video-models ${vmRes.status}`);
        const vmData = await vmRes.json();
        const raw: RawVideoModel[] = vmData?.video_models || [];
        // Deduplicate by name, prefer entries with variant metadata
        const byName = new Map<string, RawVideoModel>();
        for (const m of raw) {
          const existing = byName.get(m.name);
          if (!existing || (m.variant && !existing.variant)) byName.set(m.name, m);
        }
        const allModels: VideoModel[] = Array.from(byName.values()).map((m: RawVideoModel) =>
          getVideoModelInfo(m.name, {
            variant: m.variant,
            supports_8gb: m.supports_8gb,
            requires_cpu_offload: m.requires_cpu_offload,
            vram_mb: m.vram_mb,
            size_mb: m.size_mb,
            path: m.path,
          })
        );
        // Health probe — ComfyUI live check drives the generate-button disabled state
        try {
          const healthRes = await fetchWithTimeout("/api/services/comfyui/status", { timeout: 6000 });
          if (healthRes.ok) {
            const h = await healthRes.json();
            setComfyStatus(h.running ? "online" : "offline");
          }
        } catch {
          setComfyStatus("offline");
        }

        if (allModels.length > 0) {
          // Sort: 8GB-safe first, then by type
          allModels.sort((a, b) => {
            if ((a.supports_8gb ?? true) !== (b.supports_8gb ?? true)) return (a.supports_8gb ?? true) ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          setVideoModels(allModels);
          if (!selectedModel) {
            const preferred = allModels.find((m) => m.supports_8gb) || allModels[0];
            setSelectedModel(preferred.name);
          }
        }
      } catch (e) {
        console.error("Failed to fetch video models:", e);
        setComfyStatus("offline");
      }
    };
    fetchVideoModels();
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

  // Poll job progress — shared timeout, handles stalled backend without spinning forever
  const startProgressPolling = useCallback((jobId: string) => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    trackedJobIdsRef.current.add(jobId);

    progressIntervalRef.current = setInterval(async () => {
      if (!isMountedRef.current) return;
      try {
        const signal = abortControllerRef.current?.signal;
        const res = await fetchWithTimeout(`/api/integrations/music-video/job/${jobId}/progress`, { timeout: 15000, signal });
        if (res.ok) {
          const data: JobProgress = await res.json();
          setJobProgress(data);
          jobProgressRef.current = data;
          if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }
            trackedJobIdsRef.current.delete(jobId);
            // Only clear generating when ALL tracked jobs are done
            const stillRunning = Array.from(trackedJobIdsRef.current).some((id) => {
              const prog = jobProgressRef.current;
              return prog && prog.job_id === id && ["running", "queued", "pending"].includes(prog.status);
            });
            if (!stillRunning) {
              setGenerating(false);
              setActiveJobId(null);
            }
            if (data.status === "completed") {
              // Resolve real output path from /api/outputs (avoids guessing filenames)
              let outputPath = "";
              try {
                const or = await fetchWithTimeout(`/api/outputs?job_id=${jobId}`, { timeout: 8000, signal });
                if (or.ok) {
                  const od = await or.json();
                  const files: Array<{ relative_path?: string; path?: string }> = Array.isArray(od?.files) ? od.files : [];
                  const match = files.find((f) => f.path?.includes(jobId) || f.relative_path?.includes(jobId));
                  outputPath = match?.relative_path || match?.path || "";
                }
              } catch {
                // fallback: leave output_path empty
              }
              setResults((prev) => {
                // Deduplicate by job_id and cap at 50 entries
                const next = prev.filter((r) => r.job_id !== jobId);
                return [...next, { success: true, job_id: jobId, output_path: outputPath, section: "", error: null, message: "Completed" }].slice(-50);
              });
            }
            if (data.error) {
              setError(data.error);
            }
          }
        } else if (res.status === 404) {
          // Job expired from queue — stop polling instead of hammering 404s
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          trackedJobIdsRef.current.delete(jobId);
          const stillRunning = Array.from(trackedJobIdsRef.current).length > 0;
          if (!stillRunning) {
            setGenerating(false);
            setActiveJobId(null);
          }
          setError("Job not found — it may have expired from the queue.");
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
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
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopProgressPolling();
      if (queueIntervalRef.current) {
        clearInterval(queueIntervalRef.current);
        queueIntervalRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [stopProgressPolling]);

  // Sync refs with state so stable callbacks read current values
  useEffect(() => { generatingRef.current = generating; }, [generating]);
  useEffect(() => { activeJobIdRef.current = activeJobId; }, [activeJobId]);
  useEffect(() => { jobProgressRef.current = jobProgress; }, [jobProgress]);

  // Queue status poll — stable interval, reads current state from refs
  useEffect(() => {
    const fetchQueue = async () => {
      if (!isMountedRef.current) return;
      try {
        const signal = abortControllerRef.current?.signal;
        const res = await fetchWithTimeout("/api/jobs", { timeout: 8000, signal });
        if (res.ok && isMountedRef.current) {
          const jobs: RawJob[] = await res.json();
          const running = jobs.filter((j: RawJob) => j.status === "running" || j.status === "queued").length;
          setQueueInfo({ running, pending: Math.max(0, jobs.length - running) });
          // If we already have a tracked active job, don't override it
          if (activeJobIdRef.current) return;
          // Show any running job even if not started from this page
          const runningJob = jobs.find((j: RawJob) => j.status === "running");
          if (runningJob && runningJob.id) {
            setActiveJobId(runningJob.id);
            if (!generatingRef.current) setGenerating(true);
          }
        }
      } catch {
        // ignore fetch errors
      }
    };
    fetchQueue();
    queueIntervalRef.current = setInterval(fetchQueue, 3000);
    return () => {
      if (queueIntervalRef.current) {
        clearInterval(queueIntervalRef.current);
        queueIntervalRef.current = null;
      }
    };
  }, []);

  const handleCancelJob = async () => {
    const targets = activeJobId ? [activeJobId, ...Array.from(trackedJobIdsRef.current)] : Array.from(trackedJobIdsRef.current);
    const uniqueTargets = Array.from(new Set(targets)).filter(Boolean);
    if (uniqueTargets.length === 0) return;
    try {
      await Promise.allSettled(
        uniqueTargets.map((id) =>
          fetchWithTimeout(`/api/jobs/${id}/cancel`, { method: "POST", timeout: 15000 }).then((r) => {
            if (!r.ok) throw new Error(`Cancel failed for ${id}`);
          })
        )
      );
    } catch (e) {
      console.error("Cancel error:", e);
    } finally {
      stopProgressPolling();
      trackedJobIdsRef.current.clear();
      setGenerating(false);
      setActiveJobId(null);
      setJobProgress(null);
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
      const res = await fetchWithTimeout(`/api/integrations/music-video/style-preview?style_id=${styleId}`, {
        method: "POST",
        timeout: 30000,
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
    if (!prompt.trim()) {
      setError("Please enter a prompt.");
      return;
    }
    if (comfyStatus === "offline") {
      setError("ComfyUI is offline — start it from Health or via the backend before generating.");
      return;
    }
    console.log("[VideoGen] Starting generation...", { prompt, selectedModel, selectedMotionLora, selectedStyle, steps, cfgScale, duration });

    // Abort any in-flight requests from a previous generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Clear stale state from previous run
    stopProgressPolling();
    trackedJobIdsRef.current.clear();
    setGenerating(true);
    setError(null);
    setResults([]);
    setJobProgress(null);
    setActiveJobId(null);
    setQueueInfo(null);

    try {
      const selectedMeta = videoModels.find((m) => m.name === selectedModel);
      const mLower = selectedModel.toLowerCase();
      const metaVariant = (selectedMeta?.variant || "").toLowerCase();
      const baseBody: Record<string, unknown> = {
        prompt,
        negative_prompt: negativePrompt,
        steps: Math.max(5, Math.min(50, steps)),
        cfg_scale: cfgScale,
        model: selectedModel,
        duration: Math.max(1, Math.min(30, duration)),
        style: selectedStyle,
        scheduler,
        seed,
        fps,
        resolution,
        section: selectedSection || undefined,
        start_image: imageToVideoMode && startImage ? startImage : undefined,
      };
      const isWan1_3b = metaVariant === "1.3b" || mLower.includes("1.3b") || mLower.includes("1_3b");
      const isWanGguf = metaVariant === "gguf_q4" || metaVariant === "gguf_q5" || mLower.includes("wan") && (mLower.includes("gguf") || mLower.includes("q4") || mLower.includes("q5"));
      const isAnimateDiff = mLower.includes("mm_sd") || mLower.includes("mm-stabilized") || mLower.includes("animate") || mLower.includes("motion");
      if (isWanGguf) {
        baseBody.model_variant = metaVariant === "gguf_q5" ? "gguf_q5" : "gguf_q4";
        if (selectedMotionLora) baseBody.motion_lora = selectedMotionLora;
      } else if (isWan1_3b) {
        baseBody.model_variant = "standard";
        if (selectedMotionLora) baseBody.motion_lora = selectedMotionLora;
      } else if (isAnimateDiff && selectedMotionLora) {
        baseBody.motion_lora = selectedMotionLora;
        baseBody.motion_lora_strength = 0.8;
      }
      const count = Math.max(1, Math.min(10, batchCount));
      console.log(`[VideoGen] Queueing ${count} clip(s):`, baseBody);
      const jobIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const body = { ...baseBody, batch_index: i, batch_total: count };
        const res = await fetchWithTimeout(`/api/integrations/music-video/generate-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          timeout: 30000,
          signal: abortController.signal,
        });
        console.log(`[VideoGen] Clip ${i + 1}/${count} status:`, res.status);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: `Generation failed (${res.status})` }));
          const detail = (err as { detail?: string; error?: string; message?: string }).detail || (err as { error?: string }).error || (err as { message?: string }).message || `Generation failed (${res.status})`;
          console.error("[VideoGen] Error response:", err);
          throw new Error(detail);
        }
        const data = await res.json();
        console.log("[VideoGen] Success:", data);
        if (data.job_id) {
          jobIds.push(data.job_id);
          trackedJobIdsRef.current.add(data.job_id);
        }
        if (count > 1 && i < count - 1) await new Promise((r) => setTimeout(r, 400));
      }
      // Start polling for all batch jobs
      if (jobIds.length > 0) {
        setActiveJobId(jobIds[0]);
        startProgressPolling(jobIds[0]);
        // For additional jobs, poll less frequently to reduce backend load
        for (let i = 1; i < jobIds.length; i++) {
          setTimeout(() => startProgressPolling(jobIds[i]), i * 2000);
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // generation was superseded
      console.error("[VideoGen] Generation error:", err);
      setError(err instanceof Error ? err.message : "Generation failed");
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
            {comfyStatus !== "unknown" && (
              <span
                className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                  comfyStatus === "online"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-red-500/20 text-red-400 border border-red-500/30"
                }`}
                title={comfyStatus === "online" ? "ComfyUI is online" : "ComfyUI is offline — start it from Health"}
              >
                {comfyStatus === "online" ? "ComfyUI ●" : "ComfyUI ○ offline"}
              </span>
            )}
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

      {/* Real-time Progress Banner — now visible for any running job, not just local */}
      {(jobProgress && (generating || jobProgress.status === "running" || jobProgress.status === "queued")) && (
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

          {/* Queue status — previously hidden, now visible for overnight batches */}
          {queueInfo && (queueInfo.running > 0 || queueInfo.pending > 0) && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-gray-400">
                Queue: <span className="text-white font-medium">{queueInfo.running} running</span> • {queueInfo.pending} pending
              </span>
              <span className="text-gray-500">Queue clips overnight — walk away</span>
            </div>
          )}

          {/* Prompt Guide — one clear moving scene per clip */}
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-300">Prompt Guide</span>
              <span className="text-[10px] text-gray-500">subject + action + setting + mood</span>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              One visual theme per song section. Drop = more energetic than intro. Example: <span className="text-gray-300">cinematic, neon-lit city street at night, light trails, high detail</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {[
                ["intro", "Intro — calm"],
                ["verse", "Verse"],
                ["pre-chorus", "Pre-Chorus ↑"],
                ["chorus", "Chorus — energetic"],
                ["drop", "Drop — intense"],
                ["bridge", "Bridge — dreamy"],
                ["outro", "Outro — fade"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setSelectedSection(selectedSection === id ? "" : id)}
                  className={`px-2 py-1 rounded text-xs border ${
                    selectedSection === id
                      ? "bg-purple-600 border-purple-500 text-white"
                      : "bg-gray-700 border-gray-600 text-gray-400 hover:bg-gray-600"
                  }`}
                  title={id === "drop" ? "High energy, explosive motion" : id}
                >
                  {label}
                </button>
              ))}
            </div>
            {selectedSection && <p className="text-[11px] text-purple-300 mt-2">Section <span className="font-medium">{selectedSection}</span> will auto-append energy suffix to prompt.</p>}
          </div>

          {/* Advanced Settings — exposes hidden scheduler/seed/FPS/resolution/batch */}
          <div className="bg-gray-800 rounded-lg">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full px-4 py-2 flex items-center justify-between text-sm text-gray-300 hover:text-white"
            >
              <span className="flex items-center gap-2">
                <Settings size={14} /> Advanced Settings
                <span className="text-xs text-gray-500 ml-2">
                  {resolution} • {fps}fps • {scheduler} • seed {seed === -1 ? "random" : seed}
                  {batchCount > 1 ? ` • batch ×${batchCount}` : ""}
                </span>
              </span>
              <span className="text-xs text-gray-500">{showAdvanced ? "▲" : "▼"}</span>
            </button>
            {showAdvanced && (
              <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-gray-700">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Scheduler</label>
                  <select value={scheduler} onChange={(e) => setScheduler(e.target.value)} className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white">
                    <option value="normal">normal</option>
                    <option value="karras">karras</option>
                    <option value="exponential">exponential</option>
                    <option value="sgm_uniform">sgm_uniform</option>
                    <option value="simple">simple</option>
                    <option value="ddim_uniform">ddim_uniform</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Seed (-1 = random)</label>
                  <div className="flex gap-1">
                    <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white" />
                    <button onClick={() => setSeed(Math.floor(Math.random() * 2 ** 32))} className="px-2 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-400" title="Randomize">🎲</button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">FPS</label>
                  <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white">
                    <option value={8}>8 — draft</option>
                    <option value={12}>12</option>
                    <option value={16}>16 — balanced</option>
                    <option value={24}>24 — smooth</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Resolution</label>
                  <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white">
                    <option value="480p">480p — 832×480 (8GB safe)</option>
                    <option value="720p">720p — 1280×720 (needs 12GB+)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Batch (overnight queue)</label>
                  <input type="number" value={batchCount} onChange={(e) => setBatchCount(Math.max(1, Math.min(10, Number(e.target.value))))} min={1} max={10} className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white" />
                  <p className="text-[10px] text-gray-500 mt-1">Queue {batchCount} clips — walk away</p>
                </div>
                <div className="flex items-end">
                  <p className="text-[11px] text-gray-500">Tip: Start at <span className="text-gray-300">20 steps</span>, re-render keepers at 25–30. Length 49–97 frames (2–4s) per clip.</p>
                </div>
              </div>
            )}
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || comfyStatus === "offline"}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
            title={comfyStatus === "offline" ? "ComfyUI is offline" : batchCount > 1 ? `Queue ${batchCount} clips` : undefined}
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            {comfyStatus === "offline" ? "ComfyUI Offline" : generating ? "Generating..." : batchCount > 1 ? `Queue ${batchCount} Clips` : "Generate Video"}
          </button>
          {comfyStatus === "offline" && (
            <p className="text-xs text-amber-400 text-center">Start ComfyUI from the Health page before generating.</p>
          )}

          {/* Error */}
          {error && !generating && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300 animate-scale-in">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {/* Results — now with inline preview + download (previously just a path string) */}
          {results.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Results — {results.length} clip{results.length > 1 ? "s" : ""} queued</h3>
              <p className="text-xs text-gray-500 mb-3">Find all outputs in <span className="text-gray-300">output/previews</span> or <span className="text-gray-300">output/video</span>. Batch queue stays alive — walk away.</p>
              <div className="space-y-3">
                {results.map((r) => {
                  const videoUrl = r.output_path ? `/output/${r.output_path}` : null;
                  return (
                    <div key={r.job_id || r.section || Math.random().toString()} className={`p-3 rounded-lg ${r.success ? "bg-green-900/20 border border-green-700" : "bg-red-900/20 border border-red-700"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {r.success ? <CheckCircle size={16} className="text-green-400" /> : <XCircle size={16} className="text-red-400" />}
                           <span className="text-white text-sm font-medium truncate">{r.job_id ? r.job_id.slice(0, 8) : r.section || `Clip ${results.indexOf(r) + 1}`}</span>
                          <span className="text-xs text-gray-500">{r.message || (r.success ? "Queued" : "")}</span>
                        </div>
                        {r.job_id && <span className="text-[11px] text-gray-500 font-mono">{r.job_id.slice(0, 8)}</span>}
                      </div>
                      {videoUrl && r.success && (
                        <div className="mt-2">
                          <video src={videoUrl} controls className="w-full rounded bg-black max-h-64" onError={(e) => ((e.target as HTMLVideoElement).style.display = "none")} />
                          <div className="flex gap-2 mt-2">
                            <a href={videoUrl} download className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300">Download</a>
                             <a href="/library" target="_blank" className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-400">Browse outputs</a>
                          </div>
                        </div>
                      )}
                      {r.output_path && <p className="text-gray-500 text-xs mt-1 truncate">{r.output_path}</p>}
                      {r.error && <p className="text-red-400 text-sm mt-1">{r.error}</p>}
                    </div>
                  );
                })}
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
              {comfyStatus === "offline" && <span className="text-xs text-amber-400 font-normal">(ComfyUI offline)</span>}
            </h3>
            <div className="space-y-2">
              {videoModels.length > 0 ? videoModels.map((model) => {
                const selected = selectedModel === model.name;
                const is8Gb = model.supports_8gb ?? true;
                const vramMb = model.vram_mb;
                const variant = model.variant || "";
                return (
                  <button
                    key={model.name}
                    onClick={() => setSelectedModel(model.name)}
                    className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${selected ? "border-purple-500 bg-purple-500/10" : "border-gray-600 bg-gray-700 hover:border-gray-500"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate mr-2">{model.name.replace(".safetensors", "").replace(".ckpt", "").replace(".gguf", "")}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {is8Gb ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">8GB</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">16GB+</span>
                        )}
                        {variant && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-600 text-gray-300">{variant.toUpperCase()}</span>
                        )}
                        {selected && <span className="text-[10px] text-purple-400 shrink-0">Selected</span>}
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">{model.description}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400">{model.type}</span>
                      {vramMb && <span className="text-[10px] text-gray-500">~{vramMb} MB VRAM</span>}
                      {model.requires_cpu_offload && <span className="text-[10px] text-yellow-500">CPU T5 offload</span>}
                      <span className="text-[10px] text-gray-500">Best for: {model.bestFor}</span>
                    </div>
                  </button>
                );
              }) : (
                <p className="text-xs text-gray-500">No video models found. Install video models in ComfyUI diffusion_models folder.</p>
              )}
            </div>
          </div>

          {/* Motion LoRA — only relevant for AnimateDiff / Wan GGUF */}
          {(() => {
            const motionLoras = videoModels.filter((m) => m.type === "Motion LoRA");
            if (motionLoras.length === 0) return null;
            return (
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-white font-medium mb-2 text-sm">Camera Motion LoRA</h3>
                <p className="text-xs text-gray-500 mb-2">Optional — adds camera movement (Zoom/Pan/Tilt/Roll). Leave on None for static.</p>
                <select
                  value={selectedMotionLora}
                  onChange={(e) => setSelectedMotionLora(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                >
                  <option value="">None (static)</option>
                  {motionLoras.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name.replace(".ckpt", "").replace("v2_lora_", "")}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}

          {/* Image-to-Video — alternative for consistent identity (Fun InP 1.3B) */}
          {(() => {
            const isFunInP = selectedModel.toLowerCase().includes("fun") && selectedModel.toLowerCase().includes("inp");
            if (!isFunInP && !imageToVideoMode) {
              // Show toggle only when Fun InP is available or user wants I2V
              const hasFunInP = videoModels.some((m) => m.name.toLowerCase().includes("fun") && m.name.toLowerCase().includes("inp"));
              if (!hasFunInP) return null;
              return (
                <div className="bg-gray-800 rounded-lg p-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input type="checkbox" checked={imageToVideoMode} onChange={(e) => setImageToVideoMode(e.target.checked)} className="accent-purple-500" />
                    Animate a still (image-to-video)
                  </label>
                  <p className="text-[11px] text-gray-500 mt-1">Good for one consistent visual identity across the video (cover art → video).</p>
                </div>
              );
            }
            return (
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-white">Image-to-Video</h3>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input type="checkbox" checked={imageToVideoMode || isFunInP} onChange={(e) => setImageToVideoMode(e.target.checked)} className="accent-purple-500" />
                    {isFunInP ? "Fun InP mode" : "Enable"}
                  </label>
                </div>
                <p className="text-xs text-gray-500 mb-2">Pick a cover-art still to animate — keeps one identity across cuts.</p>
                <input
                  type="text"
                  value={startImage}
                  onChange={(e) => setStartImage(e.target.value)}
                  placeholder="Image path or URL (e.g. output/images/cover.png)"
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">Tip: Generate a still first, then paste its path here. Leave empty for pure text-to-video.</p>
                {isFunInP && !startImage && <p className="text-[11px] text-amber-400 mt-1">Fun InP works best with a start image — otherwise it falls back to T2V.</p>}
              </div>
            );
          })()}

          {/* Styles with Previews */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <Sparkles size={16} />
              Styles
            </h3>
            {styles.length > 0 ? (
              <div className="space-y-2">
                {styles.map((s) => {
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
                {templates.map((t) => (
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
