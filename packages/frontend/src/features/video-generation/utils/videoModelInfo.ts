/**
 * Raw model record as returned by the ComfyUI video-models endpoint.
 */
interface RawVideoModel {
  name: string;
  variant?: string;
  size_mb?: number;
  path?: string;
  supports_8gb?: boolean;
  requires_cpu_offload?: boolean;
  vram_mb?: number;
}

export interface VideoModel {
  name: string;
  description: string;
  type: string;
  bestFor: string;
  variant?: string;
  size_mb?: number;
  path?: string;
  supports_8gb?: boolean;
  requires_cpu_offload?: boolean;
  vram_mb?: number;
}

export function getVideoModelInfo(modelName: string, meta?: Partial<RawVideoModel>): VideoModel {
  const base = modelName.toLowerCase();
  const variant = meta?.variant || "";
  const vramMb = meta?.vram_mb;
  const supports8gb = meta?.supports_8gb ?? true;

  if (
    base.includes("mm_sd15") ||
    base.includes("mm_sd_v15") ||
    base.includes("mm-stabilized")
  ) {
    return {
      name: modelName,
      description: "AnimateDiff motion module — adds temporal consistency to SD 1.5",
      type: "Motion Module",
      bestFor: "Required for AnimateDiff video generation",
      variant,
      size_mb: meta?.size_mb,
      path: meta?.path,
    };
  }
  if (base.includes("v2_lora") || base.includes("motion_lora")) {
    return {
      name: modelName,
      description: "AnimateDiff motion LoRA — camera movements (zoom, pan)",
      type: "Motion LoRA",
      bestFor: "Camera motion effects",
      variant,
      size_mb: meta?.size_mb,
      path: meta?.path,
    };
  }
  if (base.includes("wan") && (base.includes("1.3b") || base.includes("1_3b"))) {
    const isFun = base.includes("fun") && base.includes("inp");
    const vramNote = vramMb ? ` — ~${vramMb} MB VRAM` : "";
    if (isFun) {
      return {
        name: modelName,
        description: `Wan 2.1 Fun InP 1.3B — image-to-video for consistent identity${vramNote}`,
        type: "Image-to-Video (1.3B)",
        bestFor: supports8gb
          ? "Animate a still for consistent identity — 832×480 on 8GB"
          : "Image-to-video",
        variant: variant ?? "1.3B",
        size_mb: meta?.size_mb,
        path: meta?.path,
      };
    }
    return {
      name: modelName,
      description: `Wan 2.1 T2V 1.3B — 6GB class text-to-video${vramNote}`,
      type: "Text-to-Video (1.3B)",
      bestFor: supports8gb
        ? "832×480, 49–97 frames on 8GB — fastest iteration"
        : "Text-to-video",
      variant: variant ?? "1.3B",
      size_mb: meta?.size_mb,
      path: meta?.path,
    };
  }
  if (base.includes("wan") && base.includes("ti2v")) {
    const isGguf =
      variant === "gguf_q4" ||
      variant === "gguf_q5" ||
      base.includes("gguf") ||
      base.includes("q4") ||
      base.includes("q5");
    const vramNote = vramMb ? ` — ~${vramMb} MB VRAM` : "";
    if (isGguf) {
      return {
        name: modelName,
        description: `Wan 2.2 TI2V-5B GGUF — 8GB-safe quantized variant${vramNote}`,
        type: "Text-to-Video (GGUF)",
        bestFor: supports8gb
          ? "Short clips on 8GB GPUs (CPU T5 offload)"
          : "Short clips (requires more VRAM)",
        variant,
        size_mb: meta?.size_mb,
        path: meta?.path,
      };
    }
    return {
      name: modelName,
      description: "Wan 2.2 TI2V-5B — full-precision text-to-video (needs 16-24GB VRAM)",
      type: "Text-to-Video (FP16)",
      bestFor: "Short clips on high-VRAM GPUs",
      variant: "fp16",
      size_mb: meta?.size_mb,
      path: meta?.path,
    };
  }
  if (base.includes("kandinsky")) {
    return {
      name: modelName,
      description: "Kandinsky 5 Lite — image-to-video model",
      type: "Image-to-Video",
      bestFor: "Animating still images",
      variant,
      size_mb: meta?.size_mb,
      path: meta?.path,
    };
  }
  if (base.includes("ltx")) {
    const vramNote = vramMb ? ` — ~${vramMb} MB VRAM` : "";
    return {
      name: modelName,
      description: `LTX 2.3 distilled — ~4× faster than Wan 2.2 Q4${vramNote}`,
      type: "Text-to-Video (LTX)",
      bestFor: supports8gb
        ? "Fast text-to-video on 8GB — 768×512, 25 frames at ~210s"
        : "Fast text-to-video (needs ~5GB VRAM)",
      variant: variant ?? "ltx_2_3",
      size_mb: meta?.size_mb,
      path: meta?.path,
      supports_8gb: true,
      vram_mb: vramMb ?? 4460,
    };
  }
  return {
    name: modelName,
    description: `Video model: ${modelName}`,
    type: "Video",
    bestFor: "Video generation",
    variant,
    size_mb: meta?.size_mb,
    path: meta?.path,
  };
}
