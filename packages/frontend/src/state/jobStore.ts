/**
 * Zustand store for job queue management.
 * Provides centralized job state with WebSocket real-time updates.
 */

import { create } from "zustand";
import { fetchPortConfig } from "../services/portConfig";
import {
  Job,
  QueueStats,
  fetchJobs,
  fetchQueueStats,
  createJob as apiCreateJob,
  cancelJob as apiCancelJob,
  retryJob as apiRetryJob,
  deleteJob as apiDeleteJob,
  clearCompletedJobs as apiClearCompletedJobs,
} from "../services/api";
import { JobStatus } from "@shared/types";
import { socketManager } from "../services/socketManager";

const AUTO_REFRESH_INTERVAL_MS = 5000;

// Socket subscriptions installed by connectWebSocket (released on disconnect).
let socketSubscriptions: {
  unsubMessage: () => void;
  unsubState: () => void;
} | null = null;

interface JobState {
  jobs: Job[];
  stats: QueueStats | null;
  currentJob: Job | null;
  isLoading: boolean;
  error: string | null;
  wsConnected: boolean;

  // Actions
  setJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJob: (jobId: string, updates: Partial<Job>) => void;
  removeJob: (jobId: string) => void;
  setStats: (stats: QueueStats) => void;
  fetchJobs: () => Promise<void>;
  createJob: (jobType: string, params: Record<string, unknown>, maxRetries?: number) => Promise<Job>;
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: [],
  stats: null,
  currentJob: null,
  isLoading: false,
  error: null,
  wsConnected: false,

  setJobs: (jobs: Job[]) => {
    // Find the currently running job
    const runningJob = jobs.find((j) => j.status === "running") || null;
    set({ jobs, currentJob: runningJob, error: null });
  },

  addJob: (job: Job) => {
    set((state) => ({
      jobs: [job, ...state.jobs],
      error: null,
    }));
  },

  updateJob: (jobId: string, updates: Partial<Job>) => {
    set((state) => {
      const updatedJobs = state.jobs.map((job) =>
        job.id === jobId ? { ...job, ...updates } : job
      );
      const updatedJob = updatedJobs.find((j) => j.id === jobId);
      const currentJob =
        updatedJob?.status === "running" ? updatedJob : state.currentJob;
      return { jobs: updatedJobs, currentJob, error: null };
    });
  },

  removeJob: (jobId: string) => {
    set((state) => ({
      jobs: state.jobs.filter((job) => job.id !== jobId),
      currentJob: state.currentJob?.id === jobId ? null : state.currentJob,
    }));
  },

  setStats: (stats: QueueStats) => {
    set({ stats, error: null });
  },

  fetchJobs: async () => {
    set({ isLoading: true, error: null });

    try {
      await fetchPortConfig();

      const [jobsData, statsData] = await Promise.all([
        fetchJobs(),
        fetchQueueStats(),
      ]);

      get().setJobs(jobsData);
      get().setStats(statsData);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch jobs",
      });
    } finally {
      set({ isLoading: false });
    }
  },

  createJob: async (
    jobType: string,
    params: Record<string, unknown>,
    maxRetries: number = 3
  ) => {
    set({ isLoading: true, error: null });

    try {
      const job = await apiCreateJob(jobType, params, maxRetries);
      get().addJob(job);
      // Refresh stats to reflect new pending job
      const stats = await fetchQueueStats();
      get().setStats(stats);
      return job;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to create job",
      });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  cancelJob: async (jobId: string) => {
    set({ isLoading: true, error: null });

    try {
      await apiCancelJob(jobId);
      // Optimistically update job status
      get().updateJob(jobId, { status: "cancelled" as JobStatus });
      // Refresh stats
      const stats = await fetchQueueStats();
      get().setStats(stats);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to cancel job",
      });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  retryJob: async (jobId: string) => {
    set({ isLoading: true, error: null });

    try {
      const job = await apiRetryJob(jobId);
      // Replace the failed job with the new queued job
      get().updateJob(jobId, job);
      // Refresh stats
      const stats = await fetchQueueStats();
      get().setStats(stats);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to retry job",
      });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteJob: async (jobId: string) => {
    set({ isLoading: true, error: null });

    try {
      await apiDeleteJob(jobId);
      get().removeJob(jobId);
      // Refresh stats
      const stats = await fetchQueueStats();
      get().setStats(stats);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete job",
      });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  clearCompleted: async () => {
    set({ isLoading: true, error: null });

    try {
      await apiClearCompletedJobs();
      // Refresh jobs and stats
      await get().fetchJobs();
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to clear completed jobs",
      });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  connectWebSocket: () => {
    const unsubMessage = socketManager.subscribe((message) => {
      handleWebSocketMessage(message, get, set);
    });
    const unsubState = socketManager.onStateChange((connected) => {
      set({ wsConnected: connected, ...(connected ? { error: null } : {}) });
    });

    // Store the unsubscribe closures so disconnect can release them.
    socketSubscriptions = { unsubMessage, unsubState };
    socketManager.connect();

    // Subscribe to job event channels
    if (socketManager.connected) {
      set({ wsConnected: true, error: null });
    }
  },

  disconnectWebSocket: () => {
    socketSubscriptions?.unsubMessage();
    socketSubscriptions?.unsubState();
    socketSubscriptions = null;
    socketManager.disconnect();
    set({ wsConnected: false });
  },
}));

/**
 * Handle incoming WebSocket messages for job events.
 */
function handleWebSocketMessage(
  message: Record<string, unknown>,
  get: () => JobState,
  set: (state: Partial<JobState>) => void
) {
  const eventType = message.type as string;
  const event = message.event as string;
  const data = message.data as Record<string, unknown> | undefined;

  // Handle both "type" and "event" message formats
  const eventName = eventType || event;

  // Skip if no data
  if (!data) return;

  // Backend broadcasts job events as { type: "job.*", data: { job: {...} } };
  // some legacy senders use { data: { job_id, ...fields } } or a bare job object.
  const nestedJob = data.job as Record<string, unknown> | undefined;
  const jobId =
    (data.job_id as string) ||
    (data.id as string) ||
    ((nestedJob?.id as string) ?? undefined);
  if (!jobId) return;

  switch (eventName) {
    case "job.queued":
    case "job.started":
    case "job.completed":
    case "job.failed":
    case "job.cancelled":
      {
        // Prefer the full nested job object when present, otherwise the flat fields
        const updates: Partial<Job> = nestedJob
          ? (nestedJob as Partial<Job>)
          : {
              status: data.status as JobStatus,
              progress: data.progress as number,
              message: data.message as string,
              error: data.error as string,
              started_at: data.started_at as string,
              completed_at: data.completed_at as string,
              result: data.result as Record<string, unknown>,
              output_path: data.output_path as string,
            };
        updates.id = jobId;

        // Update the job with the new data
        get().updateJob(jobId, updates);
      }

      // Refresh stats on status changes
      fetchQueueStats()
        .then((stats) => get().setStats(stats))
        .catch(console.error);
      break;

    case "job_update": {
      // Legacy shape: { type: "job_update", data: <job object> }
      get().updateJob(jobId, data as unknown as Partial<Job>);
      break;
    }

    case "job.progress":
      // Update progress only (more frequent updates)
      get().updateJob(jobId, {
        progress: data.progress as number,
        message: data.message as string,
      });
      break;

    default:
      // Unknown event, ignore
      break;
  }
}

// Auto-refresh interval ID (module-level to prevent garbage collection)
let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Zustand v5 Selectors — Fine-grained re-rendering
// ============================================================================

/** Subscribe to only the jobs array (prevents re-render on stats change) */
export const useJobs = () => useJobStore((state) => state.jobs);

/** Subscribe to only the current running job */
export const useCurrentJob = () => useJobStore((state) => state.currentJob);

/** Subscribe to only queue stats */
export const useQueueStats = () => useJobStore((state) => state.stats);

/** Subscribe to loading state only */
export const useJobLoading = () => useJobStore((state) => state.isLoading);

/** Subscribe to error state only */
export const useJobError = () => useJobStore((state) => state.error);

/** Subscribe to WebSocket connection state only */
export const useJobWsConnected = () => useJobStore((state) => state.wsConnected);

/** Subscribe to all job actions (stable reference, doesn't re-render on state change) */
export const useJobActions = () =>
  useJobStore((state) => ({
    fetchJobs: state.fetchJobs,
    createJob: state.createJob,
    cancelJob: state.cancelJob,
    retryJob: state.retryJob,
    deleteJob: state.deleteJob,
    clearCompleted: state.clearCompleted,
    connectWebSocket: state.connectWebSocket,
    disconnectWebSocket: state.disconnectWebSocket,
  }));

/**
 * Start auto-refresh for jobs (called by app initialization)
 */
export function startAutoRefresh() {
  if (autoRefreshInterval) return;

  autoRefreshInterval = setInterval(() => {
    const state = useJobStore.getState();
    // Only refresh if not currently loading and WebSocket is disconnected
    if (!state.isLoading && !state.wsConnected) {
      state.fetchJobs().catch(console.error);
    }
  }, AUTO_REFRESH_INTERVAL_MS);
}

/**
 * Stop auto-refresh
 */
export function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}
