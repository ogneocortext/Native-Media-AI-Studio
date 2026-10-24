import { useState, useCallback, useEffect } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";
import { getVideoModelInfo } from "../utils/videoModelInfo";

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

export interface RawVideoModel {
  name: string;
  variant?: string;
  size_mb?: number;
  path?: string;
  supports_8gb?: boolean;
  requires_cpu_offload?: boolean;
  vram_mb?: number;
}

export function useVideoModels() {
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [comfyStatus, setComfyStatus] = useState<"unknown" | "online" | "offline">(
    "unknown"
  );
  const [error, setError] = useState<string | null>(null);

  const fetchVideoModels = useCallback(async () => {
    setLoadingModels(true);
    setError(null);
    try {
      const vmRes = await fetchWithTimeout(
        "/api/integrations/comfyui/video-models",
        { timeout: 15000 }
      );
      if (!vmRes.ok) throw new Error(`video-models ${vmRes.status}`);
      const vmData: { video_models?: RawVideoModel[] } = await vmRes.json();
      const raw: RawVideoModel[] = vmData?.video_models || [];

      // Deduplicate by name, prefer entries with variant metadata
      const byName = new Map<string, RawVideoModel>();
      for (const m of raw) {
        const existing = byName.get(m.name);
        if (!existing || (m.variant && !existing.variant)) {
          byName.set(m.name, m);
        }
      }

      const allModels: VideoModel[] = Array.from(byName.values()).map(
        (m: RawVideoModel) =>
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
        const healthRes = await fetchWithTimeout(
          "/api/services/comfyui/status",
          { timeout: 6000 }
        );
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
          if ((a.supports_8gb ?? true) !== (b.supports_8gb ?? true))
            return (a.supports_8gb ?? true) ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setVideoModels(allModels);
      }
    } catch (e) {
      console.error("Failed to fetch video models:", e);
      setComfyStatus("offline");
      setError(e instanceof Error ? e.message : "Failed to fetch models");
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    fetchVideoModels();
  }, []);

  // Retry on error
  useEffect(() => {
    const retryTimer = setTimeout(() => {
      if (error) fetchVideoModels();
    }, 2000);
    return () => clearTimeout(retryTimer);
  }, [error]);

  return {
    videoModels,
    loadingModels,
    comfyStatus,
    error,
    refetch: fetchVideoModels,
  };
}
