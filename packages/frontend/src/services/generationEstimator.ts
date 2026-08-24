/**
 * Generation Time & Frame Estimator
 *
 * Calculates estimates for:
 * - Total frames needed based on audio duration and FPS
 * - Image generation time based on resolution, steps, and GPU
 * - Video generation time for full music videos
 * - VRAM usage estimates
 */

export interface GenerationEstimate {
  frames: number;
  estimatedTimeSeconds: number;
  estimatedTimeFormatted: string;
  vramUsageMB: number;
  outputResolution: { width: number; height: number };
  warnings: string[];
}

export interface VideoGenerationEstimate {
  totalFrames: number;
  keyframeCount: number;
  keyframeInterval: number;
  estimatedKeyframeTimeSeconds: number;
  estimatedInterpolationTimeSeconds: number;
  estimatedTotalTimeSeconds: number;
  estimatedTotalTimeFormatted: string;
  estimatedOutputSizeMB: number;
  warnings: string[];
}

// GTX 1070 Ti performance baseline (seconds per image at various settings)
const GPU_PERFORMANCE = {
  // Resolution -> seconds per step (approximate for GTX 1070 Ti)
  "256x256": 0.15,
  "512x512": 0.4,
  "768x768": 0.8,
  "1024x1024": 1.5,
  "1280x720": 1.2,
  "1920x1080": 3.0,
  "2560x1440": 5.5,
};

// Interpolation time per frame (for video generation)
const INTERPOLATION_TIME_PER_FRAME = 0.05;

// Average output sizes (MB per frame at various resolutions)
const OUTPUT_SIZE_PER_FRAME = {
  "720p": 0.8,
  "1080p": 1.5,
  "1440p": 2.5,
  "4k": 5.0,
};

/**
 * Estimate image generation time.
 */
export function estimateImageGeneration(options: {
  width: number;
  height: number;
  steps: number;
  cfg?: number;
  batchCount?: number;
}): GenerationEstimate {
  const { width, height, steps, batchCount = 1 } = options;
  const warnings: string[] = [];

  // Calculate base time per image
  const resolutionKey = `${width}x${height}`;
  let timePerStep = GPU_PERFORMANCE[resolutionKey as keyof typeof GPU_PERFORMANCE];

  if (!timePerStep) {
    // Interpolate for non-standard resolutions
    const pixelCount = width * height;
    timePerStep = 0.4 * (pixelCount / (512 * 512));
  }

  const timePerImage = timePerStep * steps;
  const totalTime = timePerImage * batchCount;

  // Estimate VRAM usage
  const pixelCount = width * height;
  const vramMB = Math.round((pixelCount * 4 * 3) / (1024 * 1024) + 500); // Base + buffer

  // Warnings
  if (vramMB > 7000) {
    warnings.push(`High VRAM usage (~${vramMB}MB). May cause out-of-memory on 8GB GPU.`);
  }
  if (width > 1280 || height > 1280) {
    warnings.push("Large resolution may be slow on GTX 1070 Ti. Consider 1024x1024 or smaller.");
  }
  if (steps > 30) {
    warnings.push(`High step count (${steps}) will increase generation time significantly.`);
  }
  if (totalTime > 300) {
    warnings.push("Generation will take over 5 minutes. Consider reducing resolution or steps.");
  }

  return {
    frames: batchCount,
    estimatedTimeSeconds: Math.round(totalTime),
    estimatedTimeFormatted: formatDuration(totalTime),
    vramUsageMB: vramMB,
    outputResolution: { width, height },
    warnings,
  };
}

/**
 * Estimate video generation time for a full music video.
 */
export function estimateVideoGeneration(options: {
  audioDurationSeconds: number;
  fps: number;
  width: number;
  height: number;
  steps: number;
  keyframeInterval?: number; // frames between keyframes
  interpolationEnabled?: boolean;
}): VideoGenerationEstimate {
  const {
    audioDurationSeconds,
    fps,
    width,
    height,
    steps,
    keyframeInterval = 15,
    interpolationEnabled = true,
  } = options;

  const warnings: string[] = [];

  // Calculate total frames
  const totalFrames = Math.ceil(audioDurationSeconds * fps);

  // Calculate keyframes
  const keyframeCount = Math.ceil(totalFrames / keyframeInterval);

  // Estimate keyframe generation time
  const imageEstimate = estimateImageGeneration({
    width,
    height,
    steps,
    batchCount: keyframeCount,
  });

  const estimatedKeyframeTime = imageEstimate.estimatedTimeSeconds;

  // Estimate interpolation time (if enabled)
  const interpolationFrames = interpolationEnabled
    ? totalFrames - keyframeCount
    : 0;
  const estimatedInterpolationTime = interpolationFrames * INTERPOLATION_TIME_PER_FRAME;

  const totalTime = estimatedKeyframeTime + estimatedInterpolationTime;

  // Estimate output size
  const resolution = width >= 2560 ? "4k" : width >= 1920 ? "1440p" : width >= 1280 ? "1080p" : "720p";
  const sizePerFrame = OUTPUT_SIZE_PER_FRAME[resolution as keyof typeof OUTPUT_SIZE_PER_FRAME];
  const estimatedOutputSizeMB = Math.round(totalFrames * sizePerFrame);

  // Warnings
  if (totalTime > 3600) {
    warnings.push("Generation will take over 1 hour. Consider shorter duration or lower FPS.");
  }
  if (totalTime > 7200) {
    warnings.push("Generation will take over 2 hours. Consider reducing keyframe interval or resolution.");
  }
  if (estimatedOutputSizeMB > 1000) {
    warnings.push(`Large output file (~${Math.round(estimatedOutputSizeMB / 1000)}GB). Ensure sufficient disk space.`);
  }
  if (totalFrames > 5000) {
    warnings.push(`High frame count (${totalFrames}). Generation will be very long.`);
  }
  if (fps > 30) {
    warnings.push("High FPS increases generation time. 30 FPS is recommended for most music videos.");
  }

  return {
    totalFrames,
    keyframeCount,
    keyframeInterval,
    estimatedKeyframeTimeSeconds: Math.round(estimatedKeyframeTime),
    estimatedInterpolationTimeSeconds: Math.round(estimatedInterpolationTime),
    estimatedTotalTimeSeconds: Math.round(totalTime),
    estimatedTotalTimeFormatted: formatDuration(totalTime),
    estimatedOutputSizeMB,
    warnings,
  };
}

/**
 * Calculate the number of frames for a given duration and FPS.
 */
export function calculateFrameCount(durationSeconds: number, fps: number): number {
  return Math.ceil(durationSeconds * fps);
}

/**
 * Calculate the duration in seconds from frame count and FPS.
 */
export function calculateDurationFromFrames(frames: number, fps: number): number {
  return Math.round((frames / fps) * 100) / 100;
}

/**
 * Format seconds into human-readable duration.
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 1) {
    return "< 1 second";
  }
  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds)} seconds`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Get recommended settings based on available VRAM and desired quality.
 */
export function getRecommendedSettings(options: {
  availableVRAMMB?: number;
  priority?: "speed" | "balanced" | "quality";
  targetDuration?: number;
}): {
  resolution: { width: number; height: number };
  steps: number;
  cfg: number;
  keyframeInterval: number;
  fps: number;
} {
  const { availableVRAMMB = 8000, priority = "balanced", targetDuration = 180 } = options;

  // Base settings
  let width = 1024;
  let height = 1024;
  let steps = 20;
  let cfg = 7;
  let keyframeInterval = 15;
  let fps = 30;

  // Adjust based on priority
  if (priority === "speed") {
    width = 512;
    height = 512;
    steps = 15;
    keyframeInterval = 10;
  } else if (priority === "quality") {
    width = 1280;
    height = 720;
    steps = 25;
    keyframeInterval = 20;
  }

  // Adjust for VRAM constraints
  if (availableVRAMMB < 6000) {
    width = Math.min(width, 768);
    height = Math.min(height, 768);
    steps = Math.min(steps, 20);
  } else if (availableVRAMMB < 4000) {
    width = 512;
    height = 512;
    steps = 15;
  }

  // Adjust for long durations
  if (targetDuration && targetDuration > 300) {
    keyframeInterval = Math.min(keyframeInterval + 5, 30);
    if (priority !== "quality") {
      fps = 24;
    }
  }

  return { resolution: { width, height }, steps, cfg, keyframeInterval, fps };
}

/**
 * Estimate VRAM usage for given settings.
 */
export function estimateVRAMUsage(width: number, height: number, batchSize: number = 1): number {
  const pixelCount = width * height;
  // Rough estimate: 4 bytes per pixel * 3 (RGB) + model overhead + buffer
  const imageMB = (pixelCount * 4 * 3) / (1024 * 1024);
  const modelOverheadMB = 1500; // SD 1.5 model
  const bufferMB = 500; // Working buffer
  return Math.round((imageMB * batchSize) + modelOverheadMB + bufferMB);
}

export default {
  estimateImageGeneration,
  estimateVideoGeneration,
  calculateFrameCount,
  calculateDurationFromFrames,
  formatDuration,
  getRecommendedSettings,
  estimateVRAMUsage,
};
