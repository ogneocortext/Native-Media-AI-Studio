import { useEffect, useState } from "react";

export interface DetectedModel {
  name: string;
  url: string;
  size_bytes: number;
  modified: number;
  source: string;
}

/**
 * GLB/GLTF inventory from GET /api/threestudio/models — every model the
 * backend can serve (output/ tree + bundled public/models). Fetched once
 * per mount; the Inspector's model picker consumes it so users never
 * have to type a path by hand.
 */
export function useDetectedModels() {
  const [models, setModels] = useState<DetectedModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/threestudio/models");
        const data = res.ok ? ((await res.json()) as { models?: DetectedModel[] }) : {};
        if (!cancelled) setModels(data.models ?? []);
      } catch {
        if (!cancelled) setModels([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading };
}
