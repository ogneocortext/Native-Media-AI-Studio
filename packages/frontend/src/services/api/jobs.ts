import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";
import type { Job, QueueStats } from "@shared/types";

export type { Job, QueueStats };

export async function fetchJobs(status?: string): Promise<Job[]> {
  const base = getApiBase();
  const url = status ? `${base}/api/jobs?status=${status}` : `${base}/api/jobs`;
  const res = await fetchWithTimeout(url, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function fetchJob(id: string): Promise<Job> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/${id}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to fetch job");
  return res.json();
}

export async function fetchQueueStats(): Promise<QueueStats> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/stats`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function createJob(
  jobType: string,
  params: Record<string, unknown>,
  maxRetries: number = 3,
): Promise<Job> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_type: jobType,
      params,
      max_retries: maxRetries,
    }),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to create job");
  return res.json();
}

export async function cancelJob(id: string): Promise<void> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/${id}/cancel`, { method: "POST", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to cancel job");
}

export async function retryJob(id: string): Promise<Job> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/${id}/retry`, { method: "POST", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to retry job");
  return res.json();
}

export async function deleteJob(id: string): Promise<void> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/${id}`, { method: "DELETE", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to delete job");
}

export async function clearCompletedJobs(): Promise<void> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/clear-completed`, {
    method: "POST",
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to clear completed jobs");
}

export async function clearFailedJobs(): Promise<void> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/jobs/clear-failed`, {
    method: "POST",
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to clear failed jobs");
}
