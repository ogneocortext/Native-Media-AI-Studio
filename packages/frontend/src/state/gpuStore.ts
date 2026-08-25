/**
 * Zustand store for GPU snapshot data.
 * Shared across all components that need GPU monitoring.
 */

import { create } from "zustand";
import { getGPUSnapshot, type GPUSnapshot } from "../services/api";

interface GPUState {
  gpu: GPUSnapshot | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;

  // Actions
  fetchGPU: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export const useGPUStore = create<GPUState>((set, get) => ({
  gpu: null,
  isLoading: false,
  error: null,
  lastUpdated: null,

  fetchGPU: async () => {
    set({ isLoading: true, error: null });
    try {
      const gpu = await getGPUSnapshot();
      set({ gpu, isLoading: false, lastUpdated: new Date() });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to fetch GPU data",
      });
    }
  },

  startPolling: (intervalMs = 5000) => {
    if (pollingInterval) return;
    get().fetchGPU();
    pollingInterval = setInterval(() => {
      get().fetchGPU();
    }, intervalMs);
  },

  stopPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },
}));

// Selectors
export const useGPUSnapshot = () => useGPUStore((state) => state.gpu);
export const useGPULoading = () => useGPUStore((state) => state.isLoading);
export const useGPUError = () => useGPUStore((state) => state.error);
