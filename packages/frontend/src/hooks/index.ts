/**
 * Central export file for all custom hooks.
 * Import hooks from here instead of individual files.
 */

export { useJobs, useHealth } from "./useJobs";
export { useSSE } from "./useWebSocket";
export { useFileUpload } from "./useFileUpload";

// Re-export Zustand stores for convenience
export { useJobStore, startAutoRefresh, stopAutoRefresh } from "../state/jobStore";
export { useHealthStore } from "../state/healthStore";
export { useGPUStore, useGPUSnapshot, useGPULoading, useGPUError } from "../state/gpuStore";

// Re-export types from job store
export type { Job, QueueStats } from "../services/api";
