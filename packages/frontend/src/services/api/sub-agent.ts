/**
 * Sub-agent API client.
 *
 * Communicates with the backend sub-agent endpoints:
 *   POST   /api/sub-agent/run        - Start a task, returns { task_id }
 *   GET    /api/sub-agent/stream/{task_id}  - SSE stream of agent output
 *   GET    /api/sub-agent/status/{task_id}  - Get task status
 *   GET    /api/sub-agent/tasks      - List all tasks
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
 * Open an SSE stream for a sub-agent task. Yields parsed SSE events.
 * Caller is responsible for closing the EventSource.
 */
export function subscribeToSubAgentStream(
  taskId: string,
  onEvent: (event: SubAgentEvent) => void,
  onError?: (error: Event) => void,
): EventSource {
  const base = getApiBase();
  const es = new EventSource(`${base}/api/sub-agent/stream/${taskId}`);

  es.addEventListener("agent_output", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_output", data, timestamp: data.timestamp });
    } catch {
      onEvent({ type: "agent_output", data: e.data });
    }
  });

  es.addEventListener("agent_done", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_done", data, timestamp: data.timestamp });
    } catch {
      onEvent({ type: "agent_done", data: e.data });
    }
  });

  es.addEventListener("agent_error", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_error", data, timestamp: data.timestamp });
    } catch {
      onEvent({ type: "agent_error", data: e.data });
    }
  });

  es.addEventListener("error", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "error", data });
    } catch {
      onError?.(e);
    }
  });

  es.onerror = (err) => {
    onError?.(err as Event);
  };

  return es;
}
