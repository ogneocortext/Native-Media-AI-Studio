import { useCallback, useEffect } from "react";
import { useJobStore } from "../state/jobStore";
import {
  useHealthStore,
  useSystemHealth,
  useServiceStatus,
} from "../state/healthStore";

/**
 * Jobs + stats view model backed by the shared jobStore.
 * The store owns polling/SSE refresh; this hook simply subscribes.
 */
export function useJobs() {
  const jobs = useJobStore((state) => state.jobs);
  const stats = useJobStore((state) => state.stats);
  const loading = useJobStore((state) => state.isLoading);
  const error = useJobStore((state) => state.error);

  const refreshJobs = useCallback(() => {
    return useJobStore.getState().fetchJobs();
  }, []);

  useEffect(() => {
    refreshJobs().catch(console.error);
  }, [refreshJobs]);

  return { jobs, stats, loading, error, refreshJobs };
}

/**
 * System + service health view backed by the shared healthStore.
 */
export function useHealth() {
  const health = useSystemHealth();
  const serviceStatus = useServiceStatus();
  const loading = useHealthStore((state) => state.isLoading);
  const error = useHealthStore((state) => state.error);

  const refresh = useCallback(async () => {
    await useHealthStore.getState().fetchSystemStatus();
  }, []);

  useEffect(() => {
    useHealthStore.getState().fetchHealth().catch(console.error);
    refresh().catch(console.error);
  }, [refresh]);

  return {
    health,
    serviceStatus,
    loading,
    error,
    refresh,
  };
}
