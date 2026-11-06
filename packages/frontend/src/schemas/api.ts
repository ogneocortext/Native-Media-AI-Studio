/**
 * Zod v3 Schemas for API Types
 * 
 * Single source of truth for runtime validation + TypeScript inference.
 * Use `z.infer<typeof Schema>` to get types, `Schema.safeParse()` for validation.
 * 
 * Note: Using Zod v3 compatible methods:
 * - z.string().uuid() instead of z.uuid()
 * - z.string().datetime() instead of z.iso.datetime()
 * - z.string().url() instead of z.url()
 * 
 * Note: Zod v3 doesn't have .validate() or .compile() - those are v4.6+ features.
 * For fast validation in v3, use .safeParse().success or compile schemas manually.
 */

import { z } from "zod";

// ─── Shared Base Types ────────────────────────────────────────────────────────

export const UUIDSchema = z.uuid();
export const TimestampSchema = z.iso.datetime();
export const URLSchema = z.url();

// ─── Health & System ──────────────────────────────────────────────────────────

export const AdapterHealthSchema = z.object({
  name: z.string(),
  status: z.enum(["online", "offline", "unknown"]),
  url: z.string().optional(),
  response_time_ms: z.number().optional(),
  error: z.string().optional(),
});

export const AggregateHealthSchema = z.object({
  backend: z.enum(["online", "offline"]),
  overall: z.enum(["healthy", "degraded", "unhealthy"]),
  adapters: z.record(z.string(), AdapterHealthSchema),
  timestamp: TimestampSchema,
});

export const SystemHealthSchema = z.object({
  status: z.string(),
  timestamp: TimestampSchema,
  platform: z.string(),
  platform_version: z.string(),
  cpu: z.object({
    usage_percent: z.number(),
    count: z.number(),
    count_logical: z.number(),
  }),
  memory: z.object({
    total_gb: z.number(),
    available_gb: z.number(),
    used_gb: z.number(),
    percent: z.number(),
  }),
  disk: z.object({
    total_gb: z.number().optional(),
    free_gb: z.number().optional(),
    percent: z.number().optional(),
    error: z.string().optional(),
  }),
});

export type AdapterHealth = z.infer<typeof AdapterHealthSchema>;
export type AggregateHealth = z.infer<typeof AggregateHealthSchema>;
export type SystemHealth = z.infer<typeof SystemHealthSchema>;

// ─── Jobs & Queue ─────────────────────────────────────────────────────────────

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "dead",
  "retrying",
]);

export const JobSchema = z.object({
  id: z.string(),
  job_type: z.string(),
  params: z.record(z.string(), z.unknown()),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100).default(0),
  message: z.string().optional(),
  error: z.string().optional(),
  started_at: TimestampSchema.optional(),
  completed_at: TimestampSchema.optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  output_path: z.string().optional(),
  max_retries: z.number().int().nonnegative().default(3),
  retry_count: z.number().int().nonnegative().default(0),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export const QueueStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  dead_letter: z.number().int().nonnegative(),
});

export const QueueMetricsSchema = z.object({
  processing_rate_per_min: z.number().nonnegative(),
  avg_wait_seconds: z.number().nonnegative(),
  avg_duration_seconds: z.number().nonnegative(),
  dead_letter_count: z.number().int().nonnegative(),
});

export type Job = z.infer<typeof JobSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type QueueStats = z.infer<typeof QueueStatsSchema>;
export type QueueMetrics = z.infer<typeof QueueMetricsSchema>;

// ─── Job API Request/Response ────────────────────────────────────────────────

export const CreateJobRequestSchema = z.object({
  job_type: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  max_retries: z.number().int().nonnegative().max(10).default(3),
});

export const CreateJobResponseSchema = JobSchema;

export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;
export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;

// ─── Remix / Mashup ───────────────────────────────────────────────────────────

export const StemNameSchema = z.enum(["vocals", "drums", "bass", "other"]);

export const RemixLayerSchema = z.object({
  track: z.string().min(1),
  stem: StemNameSchema,
  gain_db: z.number().default(0),
  key_shift_semitones: z.number().int().default(0),
  source_start_bar: z.number().int().nonnegative().default(0),
  lowpass_hz: z.number().positive().optional(),
  brightness_db: z.number().default(0),
});

export const RemixSlotSchema = z.object({
  bars: z.number().int().positive().default(8),
  crossfade_bars: z.number().int().nonnegative().default(2),
  layers: z.array(RemixLayerSchema).min(1),
});

export const RemixRecipeSpecSchema = z.object({
  name: z.string().min(1).max(100),
  target_bpm: z.number().positive().max(300).default(120),
  slots: z.array(RemixSlotSchema).min(1),
  beats_per_bar: z.number().int().positive().default(4),
  overwrite: z.boolean().default(false),
});

export const RemixSourceSchema = z.object({
  track: z.string(),
  stems: z.record(StemNameSchema, z.boolean()),
  library_file: z.string().optional(),
  duration_sec: z.number().nonnegative().optional(),
  bpm: z.number().positive().optional(),
  key_advisory: z.string().optional(),
  key_confident: z.boolean().optional(),
});

export const RemixPreviewSchema = z.object({
  timeline: z.array(z.object({
    slot_index: z.number().int().nonnegative(),
    layers: z.array(z.object({
      track: z.string(),
      stem: StemNameSchema,
      gain_db: z.number(),
      key_shift_semitones: z.number().int(),
      source_start_bar: z.number().int().nonnegative(),
      duration_sec: z.number().nonnegative(),
      stretch_ratio: z.number().positive(),
    })),
  })),
  total_duration_sec: z.number().nonnegative(),
  target_bpm: z.number().positive(),
  warnings: z.array(z.object({
    type: z.string(),
    message: z.string(),
    slot_index: z.number().int().nonnegative().optional(),
    layer_index: z.number().int().nonnegative().optional(),
  })),
});

export const RemixBuildResultSchema = z.object({
  name: z.string(),
  duration_sec: z.number().nonnegative(),
  target_bpm: z.number().positive(),
  manifest: z.object({
    source_tracks: z.array(z.string()),
    stems: z.array(z.string()),
  }),
  stems: z.record(z.string(), z.string()),
  warnings: z.array(z.string()),
});

export const RemixSummarySchema = z.object({
  name: z.string(),
  duration_sec: z.number().nonnegative(),
  target_bpm: z.number().positive(),
  source_tracks: z.array(z.string()),
  stems: z.array(z.string()),
  has_enhanced: z.boolean(),
});

export const RemixVersionSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  target_bpm: z.number().positive(),
  recipe: RemixRecipeSpecSchema,
  created_at: TimestampSchema,
  current: z.boolean().default(false),
});

export type StemName = z.infer<typeof StemNameSchema>;
export type RemixLayer = z.infer<typeof RemixLayerSchema>;
export type RemixSlot = z.infer<typeof RemixSlotSchema>;
export type RemixRecipeSpec = z.infer<typeof RemixRecipeSpecSchema>;
export type RemixSource = z.infer<typeof RemixSourceSchema>;
export type RemixPreview = z.infer<typeof RemixPreviewSchema>;
export type RemixBuildResult = z.infer<typeof RemixBuildResultSchema>;
export type RemixSummary = z.infer<typeof RemixSummarySchema>;
export type RemixVersion = z.infer<typeof RemixVersionSchema>;

// ─── Audio ────────────────────────────────────────────────────────────────────

export const AudioStemsSchema = z.object({
  stems: z.record(StemNameSchema, z.url()),
});

export type AudioStems = z.infer<typeof AudioStemsSchema>;

// ─── Audio Analysis ───────────────────────────────────────────────────────────

export const AudioProbeSchema = z.object({
  duration_sec: z.number().nonnegative(),
  first_audible_sec: z.number().nonnegative().optional(),
  bpm: z.number().positive().optional(),
  key_advisory: z.string().optional(),
  key_confident: z.boolean().optional(),
});

export type AudioProbe = z.infer<typeof AudioProbeSchema>;

// ─── Generation (3D, Video, etc.) ─────────────────────────────────────────────

export const GenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negative_prompt: z.string().max(2000).optional(),
  width: z.number().int().positive().max(2048).default(1024),
  height: z.number().int().positive().max(2048).default(1024),
  steps: z.number().int().positive().max(100).optional(),
  guidance_scale: z.number().positive().max(20).optional(),
  seed: z.number().int().nonnegative().optional(),
});

export const GenerationResponseSchema = z.object({
  job_id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  result_url: z.url().optional(),
  error: z.string().optional(),
});

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
export type GenerationResponse = z.infer<typeof GenerationResponseSchema>;

// ─── Settings / Config ────────────────────────────────────────────────────────

export const PortConfigSchema = z.object({
  backend_url: z.url(),
  backend_port: z.number().int().positive(),
  frontend_port: z.number().int().positive(),
  ws_port: z.number().int().positive(),
  events_url: z.url().optional(),
  sse_url: z.url().optional(),
});

export const AppConfigSchema = z.object({
  backend_port: z.number().int().positive(),
  frontend_port: z.number().int().positive(),
  ws_port: z.number().int().positive(),
  backend_url: z.url(),
  frontend_url: z.url(),
  comfyui_url: z.url(),
  comfyui_port: z.number().int().positive(),
  video_editor_port: z.number().int().positive(),
  ollama_url: z.url(),
  atomic_chat_url: z.url(),
  atomic_chat_enabled: z.boolean(),
  go_dashboard_url: z.url(),
  go_media_url: z.url(),
  go_worker_url: z.url(),
  go_gateway_url: z.url(),
  go_ports_url: z.url(),
});

export type PortConfig = z.infer<typeof PortConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ─── Validation Helpers ────────────────────────────────────────────────────────

/**
 * Validate unknown data against a schema, returning typed result or throwing.
 * Use in API routes, form handlers, SSE handlers.
 * 
 * Throws on validation failure with formatted error.
 */
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten();
    throw new Error(`Validation failed: ${JSON.stringify(errors.fieldErrors)}`);
  }
  return result.data;
}

/**
 * Fast boolean validation using safeParse.
 * Note: Zod v3 doesn't have .validate() - that's v4.6+.
 * Use safeParse().success for boolean checks.
 */
export function isValid<T>(schema: z.ZodSchema<T>, data: unknown): boolean {
  return schema.safeParse(data).success;
}

/**
 * Async fast validation using safeParseAsync.
 */
export async function isValidAsync<T>(schema: z.ZodSchema<T>, data: unknown): Promise<boolean> {
  return (await schema.safeParseAsync(data)).success;
}

/**
 * Extract input type (before transforms) and output type (after transforms).
 * Useful for schemas with transforms/coercion.
 */
export type SchemaInput<T extends z.ZodSchema> = z.input<T>;
export type SchemaOutput<T extends z.ZodSchema> = z.output<T>;

// ─── Export All Schemas as Object for Convenience ────────────────────────────

export const schemas = {
  // Health
  adapterHealth: AdapterHealthSchema,
  aggregateHealth: AggregateHealthSchema,
  systemHealth: SystemHealthSchema,
  // Jobs
  job: JobSchema,
  jobStatus: JobStatusSchema,
  queueStats: QueueStatsSchema,
  queueMetrics: QueueMetricsSchema,
  createJobRequest: CreateJobRequestSchema,
  createJobResponse: CreateJobResponseSchema,
  // Remix
  stemName: StemNameSchema,
  remixLayer: RemixLayerSchema,
  remixSlot: RemixSlotSchema,
  remixRecipeSpec: RemixRecipeSpecSchema,
  remixSource: RemixSourceSchema,
  remixPreview: RemixPreviewSchema,
  remixBuildResult: RemixBuildResultSchema,
  remixSummary: RemixSummarySchema,
  remixVersion: RemixVersionSchema,
  // Audio
  audioStems: AudioStemsSchema,
  audioProbe: AudioProbeSchema,
  // Generation
  generationRequest: GenerationRequestSchema,
  generationResponse: GenerationResponseSchema,
  // Settings
  portConfig: PortConfigSchema,
  appConfig: AppConfigSchema,
} as const;