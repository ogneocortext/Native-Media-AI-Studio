/**
 * Shared WebSocket manager.
 *
 * Single connection to the backend /ws endpoint with automatic reconnection
 * and a subscriber model. Use instead of opening one socket per store.
 */
import { createWebSocket } from "./api";

type MessageListener = (message: Record<string, unknown>) => void;

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 3000;

class SocketManager {
  private ws: WebSocket | null = null;
  private listeners = new Set<MessageListener>();
  private stateListeners = new Set<(connected: boolean) => void>();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private wantsConnection = false;
  private subscriberCount = 0;

  /** Subscribe to parsed JSON messages broadcast on the socket. Returns an unsubscribe fn. */
  subscribe(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to connection-state changes. Returns an unsubscribe fn. */
  onStateChange(listener: (connected: boolean) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.connected);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Open the socket. Each caller should call disconnect() when done. */
  connect(): void {
    this.subscriberCount += 1;
    this.wantsConnection = true;
    this.reconnectAttempts = 0;
    this.open();
  }

  /** Release one caller's interest; closes/reconnects-suppression only when last. */
  disconnect(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount > 0) return;

    this.wantsConnection = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
    this.emitState(false);
  }

  /** Send a JSON message if the socket is open. */
  send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private open(): void {
    if (this.ws || !this.wantsConnection) return;

    let ws: WebSocket;
    try {
      ws = createWebSocket();
    } catch (error) {
      console.error("[SocketManager] Failed to create socket:", error);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.wantsConnection = true;
      this.emitState(true);
    };

    ws.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return; // ignore non-JSON messages (e.g. heartbeat)
      }
      this.listeners.forEach((listener) => {
        try {
          listener(message);
        } catch (error) {
          console.error("[SocketManager] listener error:", error);
        }
      });
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.emitState(false);
      this.scheduleReconnect();
    };

    ws.onerror = (error) => {
      console.error("[SocketManager] WebSocket error:", error);
    };
  }

  private scheduleReconnect(): void {
    if (!this.wantsConnection) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts - 1),
      30000
    );
    console.log(
      `[SocketManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.open();
    }, delay);
  }

  private emitState(connected: boolean): void {
    this.stateListeners.forEach((listener) => listener(connected));
  }
}

/** Global singleton socket connection. */
export const socketManager = new SocketManager();