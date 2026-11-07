/**
 * Frontend client for /api/integrations/config/settings — application settings.
 */

import { getJson, postJson } from "./typed-fetch";
import type { AppConfig } from "./types";

// Re-export AppConfig as AppSettings for backwards compatibility
export type AppSettings = AppConfig;

/**
 * Get current application settings.
 */
export async function getSettings(): Promise<AppSettings> {
  const base = "/api/integrations/config";
  return getJson<AppSettings>(`${base}/settings`, { timeout: 30000 });
}

/**
 * Update application settings (partial update supported).
 */
export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const base = "/api/integrations/config";
  return postJson<AppSettings>(`${base}/settings`, settings, { timeout: 30000 });
}