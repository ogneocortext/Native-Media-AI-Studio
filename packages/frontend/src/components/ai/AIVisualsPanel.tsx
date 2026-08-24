/**
 * AI Visuals Panel — Generate AI images/video for music videos using ComfyUI.
 */

import { useState, useCallback } from "react";
import {
  Sparkles,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Loader2,
  Palette,
  Clock,
  Eye,
} from "lucide-react";
import {
  generateText2Image,
  getImage,
  isComfyUIAlive,
  type ComfyUIImage,
} from "../../services/comfyui";
import {
  estimateImageGeneration,
  estimateVideoGeneration,
  formatDuration,
  calculateFrameCount,
} from "../../services/generationEstimator";

interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
}

interface StylePreview {
  styleId: string;
  styleLabel: string;
  url: string | null;
  isLoading: boolean;
  error?: string;
}

export interface AIVisualsPanelProps {
  onSelectImage?: (imageUrl: string) => void;
  defaultPrompt?: string;
  negativePrompt?: string;
}

interface PromptStyle {
  id: string;
  label: string;
  description: string;
  icon: string;
  buildPrompt: (trackName: string) => string;
}

const PROMPT_STYLES: PromptStyle[] = [
  {
    id: "auto",
    label: "Auto (Audio Analysis)",
    description: "Analyzes BPM, energy, and beat density",
    icon: "🎯",
    buildPrompt: (trackName) =>
      `Music video visual for "${trackName}" — adaptive style based on audio characteristics. Abstract visuals with synchronized light trails, particle systems, and color shifts that react to the beat. Deep vibrant colors, volumetric lighting, lens flares, motion blur, 4K, ultra detailed, professional music video aesthetic, audio-reactive elements, synchronized to rhythm`,
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Film-like, dramatic lighting, epic scale",
    icon: "🎬",
    buildPrompt: (trackName) =>
      `Cinematic music video visual for "${trackName}" — dramatic volumetric lighting, anamorphic lens flares, film grain, shallow depth of field, rich contrast, moody atmosphere, epic scale, sweeping camera movements, teal and orange color grading, 35mm film aesthetic, photorealistic, 4K, ultra detailed, professional cinematography`,
  },
  {
    id: "abstract",
    label: "Abstract",
    description: "Particle systems, fluid simulations, color fields",
    icon: "🎨",
    buildPrompt: (trackName) =>
      `Abstract music video visual for "${trackName}" — fluid simulations, particle systems, ink in water, color field painting, morphing shapes, iridescent surfaces, chromatic aberration, generative art, procedural animation, vibrant saturated colors, 4K, ultra detailed, gallery-quality abstract art`,
  },
  {
    id: "geometric",
    label: "Geometric",
    description: "Wireframes, grids, neon shapes, symmetry",
    icon: "💠",
    buildPrompt: (trackName) =>
      `Geometric music video visual for "${trackName}" — wireframe structures, neon grid landscapes, symmetric patterns, floating polygons, holographic surfaces, chrome reflections, synthwave aesthetic, retro-futuristic, glowing edges, dark background with vibrant neon accents, 4K, ultra detailed`,
  },
  {
    id: "nature",
    label: "Nature",
    description: "Landscapes, water, organic motion, soft light",
    icon: "🌿",
    buildPrompt: (trackName) =>
      `Nature-inspired music video visual for "${trackName}" — flowing water, aurora borealis, bioluminescent organisms, organic particle motion, soft diffused light, ethereal fog, underwater caustics, gentle wind motion, pastel and earth tones, dreamlike atmosphere, 4K, ultra detailed, nature documentary aesthetic`,
  },
  {
    id: "glitch",
    label: "Glitch",
    description: "Datamoshing, RGB splits, digital artifacts",
    icon: "⚡",
    buildPrompt: (trackName) =>
      `Glitch art music video visual for "${trackName}" — datamoshing, RGB channel splits, pixel sorting, scan line artifacts, corrupted data aesthetics, digital distortion, stuttering motion, neon against black, harsh contrast, cyberpunk atmosphere, 4K, ultra detailed, experimental video art`,
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Clean shapes, subtle motion, monochromatic",
    icon: "◯",
    buildPrompt: (trackName) =>
      `Minimalist music video visual for "${trackName}" — clean geometric shapes, subtle smooth motion, monochromatic palette with single accent color, negative space, elegant typography, soft gradients, zen-like simplicity, breathing animations, modern design aesthetic, 4K, ultra clean, high-end commercial look`,
  },
  {
    id: "surreal",
    label: "Surreal",
    description: "Dreamlike, impossible physics, melting forms",
    icon: "🌀",
    buildPrompt: (trackName) =>
      `Surreal music video visual for "${trackName}" — dreamlike impossible physics, melting clocks aesthetic, floating objects, Escher-like architecture, morphing landscapes, soft pastel sky, clouds indoors, gravity-defying water, symbolic imagery, Salvador Dali inspired, 4K, ultra detailed, fine art photography`,
  },
];

const DEFAULT_NEGATIVE_PROMPT =
  "blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, text, logo, oversaturated, underexposed, noisy, grainy, jpeg artifacts, compression artifacts, cropped, out of frame, duplicate, morbid, mutilated, extra fingers, mutated hands, poorly drawn, poorly drawn hands, poorly drawn face, mutation, dehydrated, bad proportions, gross proportions, cloned face, disfigured, malformed limbs, missing arms, missing legs, extra arms, extra legs, fused fingers, too many fingers, long neck, username, artist name";

export function AIVisualsPanel({
  onSelectImage,
  defaultPrompt = "",
  negativePrompt: initialNegativePrompt = "",
}: AIVisualsPanelProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [negativePrompt, setNegativePrompt] = useState(
    initialNegativePrompt || DEFAULT_NEGATIVE_PROMPT
  );
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(20);
  const [cfg, setCfg] = useState(7);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAlive, setIsAlive] = useState<boolean | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string>("auto");
  const [previews, setPreviews] = useState<StylePreview[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [showPreviews, setShowPreviews] = useState(false);

  const checkConnection = useCallback(async () => {
    const alive = await isComfyUIAlive();
    setIsAlive(alive);
    return alive;
  }, []);

  const generateStylePreviews = useCallback(async () => {
    if (!defaultPrompt) {
      setError("Upload audio first to generate style previews");
      return;
    }

    setError(null);
    setIsPreviewing(true);
    setShowPreviews(true);

    const alive = await checkConnection();
    if (!alive) {
      setError("ComfyUI is not running. Start it first.");
      setIsPreviewing(false);
      return;
    }

    // Extract track name from default prompt
    const trackMatch = defaultPrompt.match(/for "(.+?)"/);
    const trackName = trackMatch ? trackMatch[1] : "music track";

    // Initialize previews as loading
    const initialPreviews: StylePreview[] = PROMPT_STYLES.filter(
      (s) => s.id !== "auto"
    ).map((style) => ({
      styleId: style.id,
      styleLabel: style.label,
      url: null,
      isLoading: true,
    }));
    setPreviews(initialPreviews);

    // Generate previews for each style in parallel (low quality for speed)
    const previewPromises = PROMPT_STYLES.filter(
      (s) => s.id !== "auto"
    ).map(async (style) => {
      try {
        const stylePrompt = style.buildPrompt(trackName);
        const result = await generateText2Image({
          prompt: stylePrompt,
          negativePrompt: negativePrompt.trim() || DEFAULT_NEGATIVE_PROMPT,
          width: 256,
          height: 256,
          steps: 8,
          cfg: 5,
        });

        // Poll for completion (shorter timeout for previews)
        let completed = false;
        let attempts = 0;
        const maxAttempts = 60; // 1 minute for previews

        while (!completed && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000));
          attempts++;

          try {
            const historyRes = await fetch(
              `http://127.0.0.1:8188/history/${result.prompt_id}`
            );
            if (historyRes.ok) {
              const history = await historyRes.json();
              if (history[result.prompt_id]?.outputs) {
                const outputs = history[result.prompt_id].outputs;
                for (const nodeId of Object.keys(outputs)) {
                  const nodeOutput = outputs[nodeId];
                  if (nodeOutput.images && nodeOutput.images.length > 0) {
                    const imgInfo: ComfyUIImage = nodeOutput.images[0];
                    const url = await getImage(
                      imgInfo.filename,
                      imgInfo.subfolder,
                      imgInfo.type
                    );
                    setPreviews((prev) =>
                      prev.map((p) =>
                        p.styleId === style.id
                          ? { ...p, url, isLoading: false }
                          : p
                      )
                    );
                    completed = true;
                  }
                }
              }
            }
          } catch {
            // Continue polling
          }
        }

        if (!completed) {
          setPreviews((prev) =>
            prev.map((p) =>
              p.styleId === style.id
                ? { ...p, isLoading: false, error: "Timeout" }
                : p
            )
          );
        }
      } catch (err) {
        setPreviews((prev) =>
          prev.map((p) =>
            p.styleId === style.id
              ? {
                  ...p,
                  isLoading: false,
                  error: err instanceof Error ? err.message : "Failed",
                }
              : p
          )
        );
      }
    });

    await Promise.all(previewPromises);
    setIsPreviewing(false);
  }, [defaultPrompt, negativePrompt, checkConnection]);

  const handleStyleChange = useCallback(
    (styleId: string) => {
      setSelectedStyle(styleId);
      const style = PROMPT_STYLES.find((s) => s.id === styleId);
      if (style && defaultPrompt) {
        // Extract track name from the auto-style prompt or use raw defaultPrompt
        const trackMatch = defaultPrompt.match(/for "(.+?)"/);
        const trackName = trackMatch ? trackMatch[1] : defaultPrompt;
        setPrompt(style.buildPrompt(trackName));
      }
    },
    [defaultPrompt]
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError("Please enter a prompt");
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      const alive = await checkConnection();
      if (!alive) {
        setError("ComfyUI is not running. Start it first.");
        setIsGenerating(false);
        return;
      }

      const result = await generateText2Image({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        width,
        height,
        steps,
        cfg,
      });

      // Poll for completion (simplified — in production use WebSocket)
      let completed = false;
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes

      while (!completed && attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000));
        attempts++;

        try {
          const historyRes = await fetch(
            `http://127.0.0.1:8188/history/${result.prompt_id}`
          );
          if (historyRes.ok) {
            const history = await historyRes.json();
            if (history[result.prompt_id]?.outputs) {
              const outputs = history[result.prompt_id].outputs;
              for (const nodeId of Object.keys(outputs)) {
                const nodeOutput = outputs[nodeId];
                if (nodeOutput.images && nodeOutput.images.length > 0) {
                  const imgInfo: ComfyUIImage = nodeOutput.images[0];
                  const url = await getImage(
                    imgInfo.filename,
                    imgInfo.subfolder,
                    imgInfo.type
                  );
                  const newImage: GeneratedImage = {
                    id: `${result.prompt_id}_${nodeId}`,
                    url,
                    prompt: prompt.trim(),
                    timestamp: Date.now(),
                  };
                  setImages((prev) => [newImage, ...prev]);
                  completed = true;
                }
              }
            }
          }
        } catch {
          // Continue polling
        }
      }

      if (!completed) {
        setError("Generation timed out. Check ComfyUI for results.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, negativePrompt, width, height, steps, cfg, checkConnection]);

  const handleSelectImage = useCallback(
    (imageUrl: string) => {
      setSelectedImage(imageUrl);
      onSelectImage?.(imageUrl);
    },
    [onSelectImage]
  );

  return (
    <div className="ai-visuals-panel space-y-4">
      {/* Connection Status */}
      <div className="flex items-center gap-2 text-sm">
        {isAlive === null ? (
          <button
            onClick={checkConnection}
            className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Check ComfyUI
          </button>
        ) : isAlive ? (
          <span className="text-green-400 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            ComfyUI Connected
          </span>
        ) : (
          <span className="text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            ComfyUI Offline
          </span>
        )}
      </div>

      {/* Style Selector */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-300 flex items-center gap-1">
          <Palette className="w-3 h-3" />
          Visual Style
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {PROMPT_STYLES.map((style) => (
            <button
              key={style.id}
              onClick={() => handleStyleChange(style.id)}
              title={style.description}
              className={`px-2.5 py-1.5 rounded text-xs text-left transition-colors border ${
                selectedStyle === style.id
                  ? "bg-blue-600/30 border-blue-500 text-blue-200"
                  : "bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-600 hover:bg-gray-800"
              }`}
            >
              <span className="mr-1">{style.icon}</span>
              {style.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {PROMPT_STYLES.find((s) => s.id === selectedStyle)?.description}
        </p>
      </div>

      {/* Preview Styles Button */}
      <button
        onClick={generateStylePreviews}
        disabled={isPreviewing || !defaultPrompt}
        className="w-full py-1.5 px-3 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-600/50 text-purple-200 rounded text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
      >
        {isPreviewing ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            Generating Previews...
          </>
        ) : (
          <>
            <Eye className="w-3 h-3" />
            Preview All Styles
          </>
        )}
      </button>

      {/* Style Previews Grid */}
      {showPreviews && previews.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-300">Style Previews</h4>
          <div className="grid grid-cols-4 gap-1.5">
            {previews.map((preview) => (
              <div
                key={preview.styleId}
                onClick={() => {
                  if (preview.url) {
                    handleStyleChange(preview.styleId);
                  }
                }}
                className={`relative rounded overflow-hidden border-2 transition-colors cursor-pointer ${
                  selectedStyle === preview.styleId
                    ? "border-blue-500"
                    : "border-transparent hover:border-gray-600"
                }`}
              >
                {preview.isLoading ? (
                  <div className="w-full h-16 bg-gray-800 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                  </div>
                ) : preview.url ? (
                  <img
                    src={preview.url}
                    alt={preview.styleLabel}
                    className="w-full h-16 object-cover"
                  />
                ) : (
                  <div className="w-full h-16 bg-red-900/20 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5">
                  <p className="text-[9px] text-gray-300 truncate">
                    {preview.styleLabel}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500">
            Low-res previews (256x256, 8 steps). Click to select a style.
          </p>
        </div>
      )}

      {/* Estimate Display */}
      {prompt.trim() && (
        <div className="p-2 bg-gray-800/50 border border-gray-700 rounded text-xs space-y-1">
          <div className="flex items-center gap-1 text-gray-400">
            <Clock className="w-3 h-3" />
            <span>Estimate</span>
          </div>
          {(() => {
            const imageEstimate = estimateImageGeneration({
              width,
              height,
              steps,
              cfg,
            });
            return (
              <>
                <div className="flex justify-between text-gray-300">
                  <span>Time per image:</span>
                  <span className="text-blue-300">{imageEstimate.estimatedTimeFormatted}</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>VRAM usage:</span>
                  <span className={imageEstimate.vramUsageMB > 7000 ? "text-red-400" : "text-green-300"}>
                    ~{imageEstimate.vramUsageMB} MB
                  </span>
                </div>
                {imageEstimate.warnings.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {imageEstimate.warnings.map((w, i) => (
                      <p key={i} className="text-yellow-400 text-[10px]">⚠ {w}</p>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Prompt Input */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-300">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the visual style for your music video..."
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500"
          rows={3}
        />
      </div>

      {/* Negative Prompt */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-300">
          Negative Prompt
        </label>
        <input
          type="text"
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Settings Row */}
      <div className="grid grid-cols-4 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Width</label>
          <select
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
          >
            <option value={512}>512</option>
            <option value={768}>768</option>
            <option value={1024}>1024</option>
            <option value={1280}>1280</option>
            <option value={1920}>1920</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Height</label>
          <select
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
          >
            <option value={512}>512</option>
            <option value={768}>768</option>
            <option value={1024}>1024</option>
            <option value={1080}>1080</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Steps</label>
          <input
            type="number"
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
            min={1}
            max={50}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">CFG</label>
          <input
            type="number"
            value={cfg}
            onChange={(e) => setCfg(Number(e.target.value))}
            min={1}
            max={20}
            step={0.5}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
          />
        </div>
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || !prompt.trim()}
        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-medium flex items-center justify-center gap-2 transition-colors"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Generate AI Visual
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Generated Images Grid */}
      {images.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-300">
            Generated Images ({images.length})
          </h4>
          <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {images.map((img) => (
              <div
                key={img.id}
                className={`relative group cursor-pointer rounded overflow-hidden border-2 transition-colors ${
                  selectedImage === img.url
                    ? "border-blue-500"
                    : "border-transparent hover:border-gray-600"
                }`}
                onClick={() => handleSelectImage(img.url)}
              >
                <img
                  src={img.url}
                  alt={img.prompt}
                  className="w-full h-20 object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Download className="w-4 h-4 text-white" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default AIVisualsPanel;
