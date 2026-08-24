import { useHealthStore } from "../state/healthStore";

interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp: string;
}

/**
 * WebSocket connectivity view. The underlying socket is owned by the shared
 * `socketManager` singleton (driven wherever the Sidebar mounts), so this hook
 * must never open its own connection. The Dashboard previously opened a third
 * parallel socket; it now reads the shared connection state instead.
 */
export function useWebSocket() {
  const connected = useHealthStore((state) => state.wsConnected);
  return { connected, lastMessage: null as WebSocketMessage | null };
}
