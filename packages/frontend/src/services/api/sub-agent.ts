/**
 * Sub-agent API client.
 *
 * Communicates with the backend sub-agent endpoints:
 *   POST   /api/sub-agent/run        - Start a task, returns { task_id }
 *   GET    /api/sub-agent/status/{task_id}  - Get task status
 *   GET    /api/sub-agent/tasks      - List all tasks
 *
 * Uses HTTP polling instead of SSE/EventSource for reliability: EventSource
 * connections from React components can be fragile due to StrictMode
 * remounting, CORS preflight, and Vite dev-proxy buffering of long-lived
 * streams. Polling is simpler and more robust for local development.
 */

import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface SubAgentTask {
  task_id: string;
  status: "running" | "completed" | "failed";
  result?: string;
  error?: string;
  created_at: string;
  has_result?: boolean;
  has_error?: boolean;
}

export interface SubAgentRunRequest {
  task: string;
  model?: string;
}

export interface SubAgentRunResponse {
  task_id: string;
  status: string;
}

export interface SubAgentEvent {
  type: string;
  data: unknown;
  timestamp?: string;
}

export async function runSubAgentTask(
  request: SubAgentRunRequest,
): Promise<SubAgentRunResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/sub-agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    timeout: 10000,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to start sub-agent task (${res.status})`);
  }
  return res.json();
}

export async function getSubAgentTaskStatus(
  taskId: string,
): Promise<SubAgentTask> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/sub-agent/status/${taskId}`, {
    timeout: 10000,
  });
  if (!res.ok) {
    throw new Error(`Failed to get task status (${res.status})`);
  }
  return res.json();
}

export async function listSubAgentTasks(): Promise<{ tasks: SubAgentTask[] }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/sub-agent/tasks`, {
    timeout: 10000,
  });
  if (!res.ok) {
    throw new Error(`Failed to list tasks (${res.status})`);
  }
  return res.json();
}

/**
 * Poll the task status endpoint at regular intervals, invoking onEvent
 * with each status change. Returns an interval id that can be passed to
 * clearInterval to stop polling.
 */
export function subscribeToSubAgentPoll(
  taskId: string,
  onEvent: (event: SubAgentEvent) => void,
  onError?: (error: Error) => void,
  intervalMs: number = 2000,
): ReturnType<typeof setInterval> {
  let lastStatus: string | undefined;

  const poll = async () => {
    try {
      const task = await getSubAgentTaskStatus(taskId);
      if (task.status !== lastStatus) {
        lastStatus = task.status;
        onEvent({
          type: task.status as "agent_output" | "agent_done" | "agent_error",
          data: task,
          timestamp: task.created_at,
        });
      }
      if (task.status === "completed" || task.status === "failed") {
        clearInterval(intervalId);
      }
    } catch (err) {
      onError?.(err as Error);
    }
  }

  poll(); // Run immediately
  const intervalId = setInterval(poll, intervalMs);
  return intervalId;
}
