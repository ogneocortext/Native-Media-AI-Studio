import { useHealthStore } from "../state/healthStore";

interface SSEMessage {
  type: string;
  data: unknown;
  timestamp: string;
}

/**
 * SSE connectivity view. The underlying connection is owned by the shared
 * `sseService` singleton (driven wherever the Sidebar mounts), so this hook
 * must never open its own connection.
 */
export function useSSE() {
  const connected = useHealthStore((state) => state.sseConnected);
  return { connected, lastMessage: null as SSEMessage | null };
}
