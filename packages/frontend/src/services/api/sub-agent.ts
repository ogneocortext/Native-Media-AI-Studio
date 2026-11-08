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
import { postJson, getJson } from "./typed-fetch";
import type {
  SubAgentTask,
  SubAgentRunRequest,
  SubAgentRunResponse,
  SubAgentEvent,
} from "./types";

const BASE = "/api/sub-agent";

/**
 * Start a sub-agent task.
 */
export async function runSubAgentTask(request: SubAgentRunRequest): Promise<SubAgentRunResponse> {
  return postJson<SubAgentRunResponse>(`${BASE}/run`, request, { timeout: 10000 });
}

/**
 * Cancel a running sub-agent task.
 */
export async function cancelSubAgentTask(taskId: string): Promise<{ task_id: string; status: string }> {
  return postJson<{ task_id: string; status: string }>(`${BASE}/cancel/${taskId}`, {}, { timeout: 10000 });
}

/**
 * Get task status.
 */
export async function getSubAgentTaskStatus(taskId: string): Promise<SubAgentTask> {
  return getJson<SubAgentTask>(`${BASE}/status/${taskId}`, { timeout: 10000 });
}

/**
 * List all sub-agent tasks.
 */
export async function listSubAgentTasks(): Promise<{ tasks: SubAgentTask[] }> {
  return getJson<{ tasks: SubAgentTask[] }>(`${BASE}/tasks`, { timeout: 10000 });
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
  const url = `${base}${BASE}/stream/${taskId}`;

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
      eventSource.close();
    } catch (err) {
      onError?.(new Error(`Failed to parse agent_done event: ${err}`));
    }
  });

  eventSource.addEventListener("agent_error", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_error", data, timestamp: data.timestamp });
      eventSource.close();
    } catch (err) {
      onError?.(new Error(`Failed to parse agent_error event: ${err}`));
    }
  });

  eventSource.addEventListener("agent_cancelled", (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: "agent_cancelled", data, timestamp: data.timestamp });
      eventSource.close();
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

export type * from "./types";
