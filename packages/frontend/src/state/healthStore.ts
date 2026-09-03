/**
 * Zustand store for health state management.
 * Provides real-time health updates via SSE (Server-Sent Events).
 */

import { create } from "zustand";
import { fetchPortConfig } from "../services/portConfig";
import {
  healthCheck,
  getSystemHealth,
  getServiceStatus,
  AggregateHealth,
  AdapterHealth,
  SystemHealth,
  ServiceStatus,
} from "../services/api";
import { sseService } from "../services/sseService";

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

  // Actions
  setHealth: (health: AggregateHealth) => void;
  fetchHealth: () => Promise<void>;
  fetchSystemStatus: () => Promise<void>;
  refreshAll: () => Promise<void>;
  connectSSE: () => void;
  disconnectSSE: () => void;
}

// SSE subscriptions installed by connectSSE (released on disconnect).
let healthSubscriptions: {
  unsubMessage: () => void;
  unsubState: () => void;
} | null = null;

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
      const [systemHealth, serviceStatus] = await Promise.all([
        getSystemHealth(),
        getServiceStatus(),
      ]);
      set({ systemHealth, serviceStatus, error: null });
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
