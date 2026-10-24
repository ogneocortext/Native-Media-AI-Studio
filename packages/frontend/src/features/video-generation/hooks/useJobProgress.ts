import { useState, useCallback, useRef, useEffect } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";

export interface JobProgress {
  job_id: string;
  status: string;
  progress: number;
  current_step: number;
  total_steps: number;
  current_frame: number;
  total_frames: number;
  elapsed_seconds: number;
  estimated_seconds: number;
  remaining_seconds: number;
  estimated_end_time: string;
  error: string | null;
}

export function useJobProgress() {
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const trackedJobIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const startProgressPolling = useCallback(
    async (jobId: string) => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }

      progressIntervalRef.current = setInterval(async () => {
        if (!isMountedRef.current) return;
        trackedJobIdsRef.current.add(jobId);
        try {
          const signal = abortControllerRef.current?.signal;
          const res = await fetchWithTimeout(
            `/api/integrations/music-video/job/${jobId}/progress`,
            { timeout: 15000, signal }
          );
          if (res.ok) {
            const data: JobProgress = await res.json();
            setJobProgress(data);
            if (
              data.status === "completed" ||
              data.status === "failed" ||
              data.status === "cancelled"
            ) {
              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
              }
              // Only clear when ALL tracked jobs are done
              if (trackedJobIdsRef.current.size === 0) {
                setJobProgress(null);
              }
            }
          }
        } catch {
          // Polling error — continue polling
        }
      }, 3000);
    },
    []
  );

  const stopProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  return {
    jobProgress,
    startProgressPolling,
    stopProgressPolling,
  };
}
