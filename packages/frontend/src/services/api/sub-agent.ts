/**
 * Sub-agent API client.
 *
 * Communicates with the backend sub-agent endpoints:
 *   POST   /api/sub-agent/run        - Start a task, returns { task_id }
 *   POST   /api/sub-agent/cancel/{task_id}  - Cancel a running task
 *   GET    /api/sub-agent/stream/{task_id}  - SSE stream of agent iterations
 *   GET    /api/sub-agent/status/{task_id}  - Get task status
 *   GET    /api/sub-agent/tasks      - List all tasks
 *
 * SSE Event Types:
 *   - agent_output: Agent iteration/tool result text
 *   - agent_done: Task completed successfully
 *   - agent_error: Task failed with error
 *   - agent_cancelled: Task was cancelled by user
 */

import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface SubAgentTask {
  task_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  error_detail?: string;
  created_at: string;
  model?: string;
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
  model?: string;
}

export interface SubAgentEvent {
  type: "agent_output" | "agent_done" | "agent_error" | "agent_cancelled";
  data: {
    task_id: string;
    text?: string;
    result?: string;
    error?: string;
    error_detail?: string;
    timestamp: string;
  };
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

export async function cancelSubAgentTask(
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/sub-agent/cancel/${taskId}`, {
    method: "POST",
    timeout: 10000,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to cancel sub-agent task (${res.status})`);
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
 * Subscribe to SSE stream for a sub-agent task.
 * Returns an EventSource that can be closed to stop receiving events.
 */
export function subscribeToSubAgentSSE(
  taskId: string,
  onEvent: (event: SubAgentEvent) => void,
  onError?: (error: Error) => void,
): EventSource {
  const base = getApiBase();
  const url = `${base}/api/sub-agent/stream/${taskId}`;

  const eventSource = new EventSource(url);

  eventSource.addEventListener("agent_output", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_output", data, timestamp: data.timestamp });
    } catch (err) {
      onError?.(new Error(`Failed to parse agent_output event: ${err}`));
    }
  });

  eventSource.addEventListener("agent_done", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_done", data, timestamp: data.timestamp });
      eventSource.close(); // Close on completion
    } catch (err) {
      onError?.(new Error(`Failed to parse agent_done event: ${err}`));
    }
  });

  eventSource.addEventListener("agent_error", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_error", data, timestamp: data.timestamp });
      eventSource.close(); // Close on error
    } catch (err) {
      onError?.(new Error(`Failed to parse agent_error event: ${err}`));
    }
  });

  eventSource.addEventListener("agent_cancelled", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_cancelled", data, timestamp: data.timestamp });
      eventSource.close(); // Close on cancellation
    } catch (err) {
      onError?.(new Error(`Failed to parse agent_cancelled event: ${err}`));
    }
  });

  eventSource.addEventListener("error", (e) => {
    onError?.(new Error(`SSE connection error: ${e}`));
    eventSource.close();
  });

  return eventSource;
}
