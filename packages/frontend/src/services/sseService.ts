/**
 * SSE (Server-Sent Events) service for real-time updates.
 *
 * Replaces WebSocket with a simpler, more reliable HTTP-based protocol.
 * Uses the browser's native EventSource API with automatic reconnection
 * and event resumption built-in.
 */

type MessageListener = (message: Record<string, unknown>) => void;

class SSEService {
  private eventSource: EventSource | null = null;
  private listeners = new Set<MessageListener>();
  private stateListeners = new Set<(connected: boolean) => void>();
  private wantsConnection = false;
  private subscriberCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  /** Subscribe to SSE messages. Returns an unsubscribe fn. */
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
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  /** Open the SSE connection. */
  connect(): void {
    this.subscriberCount += 1;
    this.wantsConnection = true;
    this.open();
  }

  /** Release one caller's interest; closes only when last. */
  disconnect(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount > 0) return;

    this.wantsConnection = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.emitState(false);
  }

  private scheduleReconnect(): void {
    if (!this.wantsConnection || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantsConnection && !this.eventSource) {
        this.open();
      }
    }, delay);
  }

  private open(): void {
    if (this.eventSource || !this.wantsConnection) return;

    // SSE uses regular HTTP, not WebSocket protocol
    const sseUrl = `${window.location.protocol}//${window.location.host}/api/events`;

    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onopen = () => {
      this.reconnectDelay = 1000;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.emitState(true);
    };

    this.eventSource.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // ignore non-JSON messages
      }
      this.listeners.forEach((listener) => {
        try {
          listener(message);
        } catch (error) {
          console.error("[SSE] listener error:", error);
        }
      });
    };

    // Handle named events
    this.eventSource.addEventListener("connected", (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse((event as MessageEvent).data);
        this.listeners.forEach((listener) => listener(message));
      } catch {
        // ignore
      }
    });

    this.eventSource.addEventListener("keepalive", () => {
      // Keepalive received - connection is alive
    });

    this.eventSource.onerror = () => {
      this.emitState(false);
      // EventSource auto-reconnects, but if it closed we schedule manual reconnect
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.eventSource.close();
        this.eventSource = null;
        this.scheduleReconnect();
      }
    };
  }

  private emitState(connected: boolean): void {
    this.stateListeners.forEach((listener) => listener(connected));
  }
}

/** Global singleton SSE connection. */
export const sseService = new SSEService();
