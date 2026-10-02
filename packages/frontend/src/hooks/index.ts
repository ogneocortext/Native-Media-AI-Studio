/**
 * Central export file for all custom hooks.
 * Import hooks from here instead of individual files.
 */

export { useJobs, useHealth } from "./useJobs";
export { useSSE } from "./useWebSocket";
export { useFileUpload } from "./useFileUpload";
export { usePolling } from "./usePolling";
export { useAudioLibrary } from "./useAudioLibrary";
export type { UseAudioLibraryResult } from "./useAudioLibrary";

// Re-export Zustand stores for convenience
export { useJobStore, startAutoRefresh, stopAutoRefresh } from "../state/jobStore";
export { useHealthStore } from "../state/healthStore";
export { useGPUStore, useGPUSnapshot, useGPULoading, useGPUError } from "../state/gpuStore";

// Audio media library — single source of truth for every audio selector.
export { useAudioLibraryStore, audioDisplayName, audioOptionLabel } from "../state/audioLibraryStore";
export type { AudioLibraryEntry, AudioLibraryFile } from "../state/audioLibraryStore";

// Re-export types from job store
export type { Job, QueueStats } from "../services/api";
