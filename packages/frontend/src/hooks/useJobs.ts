import { useCallback, useEffect, useState, useRef } from "react";
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
  const storeLoading = useHealthStore((state) => state.isLoading);
  const error = useHealthStore((state) => state.error);
  const [initialLoading, setInitialLoading] = useState(true);
  const didInitRef = useRef(false);

  const refresh = useCallback(async () => {
    await useHealthStore.getState().fetchSystemStatus();
  }, []);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    let cancelled = false;
    setInitialLoading(true);

    Promise.all([
      useHealthStore.getState().fetchHealth().catch(() => {}),
      useHealthStore.getState().fetchSystemStatus().catch(() => {}),
    ]).finally(() => {
      if (!cancelled) setInitialLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const loading = initialLoading || storeLoading;

  return {
    health,
    serviceStatus,
    loading,
    error,
    refresh,
  };
}
