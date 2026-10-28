import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface AppSettings {
  comfyui_url: string;
  ollama_url: string;
  atomic_chat_url: string;
  atomic_chat_enabled: boolean;
  log_level: string;
  max_queue_workers: number;
  backend_port: number;
  frontend_port: number;
  default_model?: string;
}

export async function getSettings(): Promise<AppSettings> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/config/settings`, {
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to get settings");
  return res.json();
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/integrations/config/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}
