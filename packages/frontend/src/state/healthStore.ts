/**
 * Zustand store for health state management.
 * Provides real-time health updates via SSE (Server-Sent Events).
 * Also centralizes granular health polling so components don't run
 * competing intervals.
 */

import { create } from "zustand";
import { fetchPortConfig } from "../services/portConfig";
import {
  healthCheck,
  getSystemHealth,
  getServiceStatus,
  getGPUSnapshot,
  getGPUProcesses,
  getFFmpegStatus,
  getLoadedModels,
  getComfyUIStatus,
  AggregateHealth,
  AdapterHealth,
  SystemHealth,
  ServiceStatus,
  type ComfyUIStatus,
} from "../services/api";
import { sseService } from "../services/sseService";

interface GranularHealthData {
  gpu: { snapshot: Awaited<ReturnType<typeof getGPUSnapshot>> | null; processes: Awaited<ReturnType<typeof getGPUProcesses>>; error: string | null };
  ffmpeg: Awaited<ReturnType<typeof getFFmpegStatus>> | null;
  ollamaModels: Awaited<ReturnType<typeof getLoadedModels>> | null;
  comfyui: ComfyUIStatus | null;
  vram: Record<string, unknown> | null;
}

interface HealthState {
  backend: "online" | "offline";
  overall: "healthy" | "degraded" | "unhealthy";
  adapters: Record<string, AdapterHealth>;
  systemHealth: SystemHealth | null;
  serviceStatus: ServiceStatus | null;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
  sseConnected: boolean;
  granular: GranularHealthData;

  // Actions
  setHealth: (health: AggregateHealth) => void;
  fetchHealth: () => Promise<void>;
  fetchSystemStatus: () => Promise<void>;
  refreshAll: () => Promise<void>;
  connectSSE: () => void;
  disconnectSSE: () => void;
  fetchGPUData: () => Promise<void>;
  fetchFFmpegData: () => Promise<void>;
  fetchOllamaModels: () => Promise<void>;
  fetchComfyUIStatus: () => Promise<void>;
  fetchVRAMStatus: () => Promise<Record<string, unknown> | null>;
}

// SSE subscriptions installed by connectSSE (released on disconnect).
let healthSubscriptions: {
  unsubMessage: () => void;
  unsubState: () => void;
} | null = null;

const EMPTY_GRANULAR: GranularHealthData = {
  gpu: { snapshot: null, processes: { processes: [], count: 0 }, error: null },
  ffmpeg: null,
  ollamaModels: null,
  comfyui: null,
  vram: null,
};

export const useHealthStore = create<HealthState>((set, get) => ({
  backend: "offline",
  overall: "unhealthy",
  adapters: {},
  systemHealth: null,
  serviceStatus: null,
  lastUpdated: null,
  isLoading: false,
  error: null,
  sseConnected: false,
  granular: EMPTY_GRANULAR,

  setHealth: (health: AggregateHealth) => {
    set({
      backend: health.backend,
      overall: health.overall,
      adapters: health.adapters,
      lastUpdated: new Date(),
      error: null,
    });
  },

  fetchHealth: async () => {
    set({ isLoading: true, error: null });

    try {
      await fetchPortConfig();
      const health = await healthCheck();
      get().setHealth(health);
    } catch (error) {
      set({
        backend: "offline",
        overall: "unhealthy",
        error: error instanceof Error ? error.message : "Health check failed",
      });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchSystemStatus: async () => {
    set({ isLoading: true, error: null });

    try {
      await fetchPortConfig();

      // Use timeouts so one slow endpoint doesn't block the whole page.
      // We allow up to 30s for each health slice; a partial result is better than a frozen UI.
      const systemHealthPromise = getSystemHealth().catch((err) => {
        console.warn("System health fetch failed:", err);
        return null;
      });
      const serviceStatusPromise = getServiceStatus().catch((err) => {
        console.warn("Service status fetch failed:", err);
        return null;
      });

      const [systemHealth, serviceStatus] = await Promise.all([
        systemHealthPromise,
        serviceStatusPromise,
      ]);

      const hasPartialData = systemHealth || serviceStatus;
      const hasErrors = !systemHealth || !serviceStatus;

      set({
        ...(systemHealth ? { systemHealth } : {}),
        ...(serviceStatus ? { serviceStatus } : {}),
        ...(hasPartialData ? { lastUpdated: new Date() } : {}),
        error: hasErrors
          ? hasPartialData
            ? "Some health data could not be loaded"
            : "Failed to fetch health data"
          : null,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch health",
      });
    } finally {
      set({ isLoading: false });
    }
  },

  refreshAll: async () => {
    await Promise.all([get().fetchHealth(), get().fetchSystemStatus()]);
  },

  connectSSE: () => {
    // Guard: prevent double-subscription if called multiple times
    if (healthSubscriptions) return;
    const unsubMessage = sseService.subscribe((message) => {
      // Handle health change events
      if (
        message.type === "system.health_changed" ||
        message.event === "health_changed"
      ) {
        const healthData = (message.data || message) as Record<string, unknown>;

        const health: AggregateHealth = {
          backend:
            (healthData.backend as "online" | "offline") ||
            (healthData.status as "online" | "offline") ||
            "offline",
          overall:
            (healthData.overall as AggregateHealth["overall"]) ||
            (healthData.status as AggregateHealth["overall"]) ||
            "unhealthy",
          adapters: (healthData.adapters as Record<string, AdapterHealth>) || {},
          timestamp:
            (healthData.timestamp as string | undefined) ||
            new Date().toISOString(),
        };

        get().setHealth(health);
      }
    });
    const unsubState = sseService.onStateChange((connected) => {
      set({ sseConnected: connected });
    });

    healthSubscriptions = { unsubMessage, unsubState };
    sseService.connect();
    set({ sseConnected: sseService.connected });
  },

  disconnectSSE: () => {
    healthSubscriptions?.unsubMessage();
    healthSubscriptions?.unsubState();
    healthSubscriptions = null;
    sseService.disconnect();
    set({ sseConnected: false });
  },

  // Granular data fetchers (centralized so components don't compete)
  fetchGPUData: async () => {
    try {
      const [snapshot, processes] = await Promise.all([
        getGPUSnapshot(),
        getGPUProcesses().catch(() => ({ processes: [], count: 0 })),
      ]);
      set((s) => ({
        granular: { ...s.granular, gpu: { snapshot, processes, error: null } },
      }));
    } catch (error) {
      set((s) => ({
        granular: {
          ...s.granular,
          gpu: { ...s.granular.gpu, error: error instanceof Error ? error.message : "GPU unavailable" },
        },
      }));
    }
  },

  fetchFFmpegData: async () => {
    try {
      const data = await getFFmpegStatus();
      set((s) => ({ granular: { ...s.granular, ffmpeg: data } }));
    } catch {
      set((s) => ({ granular: { ...s.granular, ffmpeg: null } }));
    }
  },

  fetchOllamaModels: async () => {
    try {
      const data = await getLoadedModels();
      set((s) => ({ granular: { ...s.granular, ollamaModels: data } }));
    } catch {
      set((s) => ({ granular: { ...s.granular, ollamaModels: { loaded: false, models: [], activity: {} } } }));
    }
  },

  fetchComfyUIStatus: async () => {
    try {
      const data = await getComfyUIStatus();
      set((s) => ({ granular: { ...s.granular, comfyui: data } }));
    } catch {
      set((s) => ({ granular: { ...s.granular, comfyui: null } }));
    }
  },

  fetchVRAMStatus: async () => {
    try {
      const base = (await import("../services/portConfig")).getBackendUrl();
      const res = await fetch(`${base}/api/integrations/vram/status`, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const data = await res.json();
        set((s) => ({ granular: { ...s.granular, vram: data } }));
        return data as Record<string, unknown>;
      } else {
        set((s) => ({ granular: { ...s.granular, vram: null } }));
        return null;
      }
    } catch {
      set((s) => ({ granular: { ...s.granular, vram: null } }));
      return null;
    }
  },
}));

// ============================================================================
// Zustand v5 Selectors — Fine-grained re-rendering
// ============================================================================

/** Subscribe to overall health status only */
export const useOverallHealth = () => useHealthStore((state) => state.overall);

/** Subscribe to backend online/offline status only */
export const useBackendStatus = () => useHealthStore((state) => state.backend);

/** Subscribe to adapter health map only */
export const useAdapterHealth = () => useHealthStore((state) => state.adapters);

/** Subscribe to health loading state only */
export const useHealthLoading = () => useHealthStore((state) => state.isLoading);

/** Subscribe to health error only */
export const useHealthError = () => useHealthStore((state) => state.error);

/** Subscribe to SSE connection state only */
export const useHealthSseConnected = () => useHealthStore((state) => state.sseConnected);

/** Subscribe to health actions (stable reference) */
export const useHealthActions = () =>
  useHealthStore((state) => ({
    fetchHealth: state.fetchHealth,
    refreshAll: state.refreshAll,
    connectSSE: state.connectSSE,
    disconnectSSE: state.disconnectSSE,
  }));

/** Subscribe to extended system-health (CPU/memory/disk) data only */
export const useSystemHealth = () =>
  useHealthStore((state) => state.systemHealth);

/** Subscribe to adapter service status only */
export const useServiceStatus = () =>
  useHealthStore((state) => state.serviceStatus);
