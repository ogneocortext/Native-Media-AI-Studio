/**
 * @module visualizerConfigSchema
 *
 * JSON-serializable configuration schema for visualizer modes.
 *
 * This is designed for AI agent consumption - an AI agent can generate
 * a complete visualizer config as JSON without writing TypeScript code.
 * The config is validated at runtime and applied to the visualizer.
 *
 * Example config:
 *
 * ```json
 * {
 *   "modeId": "bars",
 *   "params": {
 *     "barCount": 64,
 *     "barWidth": 4,
 *     "glowIntensity": 0.7
 *   },
 *   "overrides": {
 *     "bgColor": "#0a0a0a",
 *     "prefersReducedMotion": false
 *   }
 * }
 */

/**
 * 
 */
import type { VisualizerModeDef } from "./visualizerModeRegistry";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/**
 * User-facing config for a visualizer mode instance.
 * AI agents can generate this as JSON.
 */
export interface VisualizerConfig {
  /** Mode ID (must match a registered mode) */
  modeId: string;
  /** Override default parameters */
  params?: Record<string, number | string | boolean>;
  /** Override canvas background color */
  bgColor?: string;
  /** Reduced motion preference */
  prefersReducedMotion?: boolean;
  /** Perceptual frequency scale */
  perceptualScale?: "bark" | "erb" | "mel" | "linear" | "log";
  /** Optional label for the config */
  name?: string;
  /** Optional description */
  description?: string;
  /** Version for config migration */
  version: number;
}

/**
 * Validation result for a config.
 */
export interface VisualizerConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedConfig?: VisualizerConfig;
}

/**
 * Default config values.
 */
export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  modeId: "bars",
  params: {},
  bgColor: "#050505",
  prefersReducedMotion: false,
  perceptualScale: "log",
  version: 1,
};

/**
 * Validate and normalize a visualizer config.
 *
 * Returns validation result with any errors and a normalized config.
 * AI agents should call this before applying a config.
 */
export function validateVisualizerConfig(
  config: unknown,
  availableModeIds: string[],
): VisualizerConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config || typeof config !== "object") {
    return {
      valid: false,
      errors: ["Config must be an object"],
      warnings: [],
    };
  }

  const c = config as Record<string, unknown>;

  // Validate modeId
  if (typeof c.modeId !== "string" || !c.modeId) {
    errors.push("config.modeId is required and must be a string");
  } else if (!availableModeIds.includes(c.modeId)) {
    errors.push(
      `config.modeId "${c.modeId}" is not a registered mode. Available: ${availableModeIds.join(", ")}`,
    );
  }

  // Validate params
  if (c.params !== undefined && typeof c.params !== "object") {
    errors.push("config.params must be an object");
  }

  // Validate bgColor
  if (c.bgColor !== undefined && typeof c.bgColor !== "string") {
    errors.push("config.bgColor must be a string");
  }

  // Validate perceptualScale
  if (
    c.perceptualScale !== undefined &&
    !["bark", "erb", "mel", "linear", "log"].includes(
      String(c.perceptualScale),
    )
  ) {
    errors.push(
      "config.perceptualScale must be one of: bark, erb, mel, linear, log",
    );
  }

  // Validate version
  if (c.version !== undefined && typeof c.version !== "number") {
    errors.push("config.version must be a number");
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    normalizedConfig: valid
      ? {
          modeId: c.modeId as string,
          params: (c.params as Record<string, number | string | boolean>) || {},
          bgColor: (c.bgColor as string) || "#050505",
          prefersReducedMotion: (c.prefsReducedMotion as boolean) || false,
          perceptualScale: (c.perceptualScale as "bark" | "erb" | "mel" | "linear" | "log") || "log",
          version: (c.version as number) || 1,
          name: (c.name as string) || undefined,
          description: (c.description as string) || undefined,
        }
      : undefined,
  };
}

/**
 * Apply a config to a mode definition, returning the effective render params.
 * Merges mode defaults with config params (config takes precedence).
 */
export function applyConfigToMode(
  modeDef: VisualizerModeDef,
  config: VisualizerConfig,
): VisualizerModeDef & { resolvedParams: Record<string, number | string | boolean> } {
  const resolvedParams = { ...modeDef.defaultParams, ...config.params };

  return {
    ...modeDef,
    resolvedParams,
  };
}

/**
 * Parse a config from JSON string. Returns validation result.
 */
export function parseConfigFromJson(
  jsonString: string,
  availableModeIds: string[],
): VisualizerConfigValidation {
  try {
    const parsed = JSON.parse(jsonString);
    return validateVisualizerConfig(parsed, availableModeIds);
  } catch (err) {
    return {
      valid: false,
      errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
    };
  }
}

/**
 * Stringify a config to JSON.
 */
export function stringifyConfig(config: VisualizerConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * Create a minimal config from just a mode ID.
 */
export function createMinimalConfig(modeId: string): VisualizerConfig {
  return {
    modeId,
    params: {},
    bgColor: "#050505",
    prefersReducedMotion: false,
    perceptualScale: "log",
    version: 1,
  };
}

/**
 * Merge two configs (second overrides first).
 */
export function mergeConfigs(
  base: VisualizerConfig,
  override: Partial<VisualizerConfig>,
): VisualizerConfig {
  return {
    ...base,
    ...override,
    params: { ...base.params, ...(override.params || {}) },
  };
}
