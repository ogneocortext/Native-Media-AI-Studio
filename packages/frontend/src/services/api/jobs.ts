/**
 * Frontend client for /api/jobs — job queue management.
 */

import { getJson, postJson, fetchJson } from "./typed-fetch";
import type { Job, QueueStats, QueueMetrics, JobType } from "@shared/types";

const BASE = "/api/jobs";

/**
 * Fetch all jobs, optionally filtered by status.
 */
export async function fetchJobs(status?: string): Promise<Job[]> {
  const url = status ? `${BASE}?status=${encodeURIComponent(status)}` : BASE;
  return getJson<Job[]>(url, { timeout: 30000 });
}

/**
 * Fetch a single job by ID.
 */
export async function fetchJob(id: string): Promise<Job> {
  return getJson<Job>(`${BASE}/${id}`, { timeout: 30000 });
}

/**
 * Fetch queue statistics.
 */
export async function fetchQueueStats(): Promise<QueueStats> {
  return getJson<QueueStats>(`${BASE}/stats`, { timeout: 30000 });
}

/**
 * Fetch extended queue metrics (processing rate, wait times, dead letters).
 * Heavier query — only used by the health panel.
 */
export async function fetchQueueMetrics(): Promise<QueueMetrics> {
  return getJson<QueueMetrics>(`${BASE}/metrics`, { timeout: 30000 });
}

/**
 * Create a new job.
 */
export async function createJob(
  jobType: JobType,
  params: Record<string, unknown>,
  maxRetries = 3,
): Promise<Job> {
  return postJson<Job>(BASE, {
    job_type: jobType,
    params,
    max_retries: maxRetries,
  });
}

/**
 * Cancel a running/queued job.
 */
export async function cancelJob(id: string): Promise<void> {
  await fetchJson<void>(`${BASE}/${id}/cancel`, {
    method: "POST",
    timeout: 30000,
  });
}

/**
 * Retry a failed job.
 */
export async function retryJob(id: string): Promise<Job> {
  return postJson<Job>(`${BASE}/${id}/retry`, {}, { timeout: 30000 });
}

/**
 * Delete a job (only for terminal states).
 */
export async function deleteJob(id: string): Promise<void> {
  await fetchJson<void>(`${BASE}/${id}`, {
    method: "DELETE",
    timeout: 30000,
  });
}

/**
 * Clear all completed jobs from the queue.
 */
export async function clearCompletedJobs(): Promise<void> {
  await fetchJson<void>(`${BASE}/clear-completed`, {
    method: "POST",
    timeout: 30000,
  });
}

/**
 * Clear all failed jobs from the queue.
 */
export async function clearFailedJobs(): Promise<void> {
  await fetchJson<void>(`${BASE}/clear-failed`, {
    method: "POST",
    timeout: 30000,
  });
}