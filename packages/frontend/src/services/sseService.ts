/**
 * SSE (Server-Sent Events) service for real-time updates.
 *
 * Replaces WebSocket with a simpler, more reliable HTTP-based protocol.
 * Uses the browser's native EventSource API with automatic reconnection
 * and event resumption built-in.
 */

import { getEventsUrl } from "./portConfig";

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
  private lastEventId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10; // Give up after 10 failed attempts (covers optional Go dashboard)
  private syncChannel: BroadcastChannel | null = null;
  private offlineQueue: Array<Record<string, unknown>> = [];

  // Track connection state for UI indicators
  private _connectionState: "connected" | "reconnecting" | "disconnected" = "disconnected";
  get connectionState(): "connected" | "reconnecting" | "disconnected" {
    return this._connectionState;
  }

  /** Current length of the offline event queue. */
  get offlineQueueLength(): number {
    return this.offlineQueue.length;
  }

  /** Enqueue a message for later delivery when the connection restores. */
  enqueueOffline(message: Record<string, unknown>): void {
    this.offlineQueue.push(message);
  }

  /** Drain and return the queued offline messages, clearing the queue. */
  drainOfflineQueue(): Array<Record<string, unknown>> {
    const queued = this.offlineQueue;
    this.offlineQueue = [];
    return queued;
  }

  /** Subscribe to SSE messages. Returns an unsubscribe fn. */
  subscribe(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Feed a synthetic SSE message to all listeners (used by test harnesses).
   * Mirrors what `onmessage` does after JSON-parsing an inbound event.
   */
  feedMessage(message: Record<string, unknown>): void {
    this.listeners.forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        console.error("[SSE] listener error:", error);
      }
    });
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
    this.reconnectAttempts = 0; // Reset on new connection attempt
    this._initSyncChannel();
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
    this._connectionState = "disconnected";
    this.emitState(false);
    this._closeSyncChannel();
  }

  private _initSyncChannel(): void {
    if (this.syncChannel) return;
    try {
      this.syncChannel = new BroadcastChannel("notifications");
      this.syncChannel.onmessage = (event) => {
        if (event.data?.type === "sse_event" && event.data?.message) {
          this._dispatchToListeners(event.data.message);
        } else if (event.data?.type === "connection_state" && event.data?.state) {
          this._connectionState = event.data.state;
          this.emitState(this._connectionState === "connected");
        }
      };
    } catch {
      // BroadcastChannel not supported; skip cross-tab sync
    }
  }

  private _closeSyncChannel(): void {
    if (this.syncChannel) {
      this.syncChannel.close();
      this.syncChannel = null;
    }
  }

  private _broadcastToSyncChannel(message: Record<string, unknown>): void {
    if (!this.syncChannel) return;
    try {
      this.syncChannel.postMessage({ type: "sse_event", message });
    } catch {
      // Channel closed or unavailable
    }
  }

  private _broadcastStateToSyncChannel(state: "connected" | "reconnecting" | "disconnected"): void {
    if (!this.syncChannel) return;
    try {
      this.syncChannel.postMessage({ type: "connection_state", state });
    } catch {
      // Channel closed or unavailable
    }
  }

  private scheduleReconnect(): void {
    if (!this.wantsConnection || this.reconnectTimer) return;
    
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.warn(`[SSE] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Stopping reconnection. Server may be unavailable (optional Go dashboard).`);
      this._connectionState = "disconnected";
      this.emitState(false);
      this._broadcastStateToSyncChannel("disconnected");
      return;
    }
    
    this._connectionState = "reconnecting";
    this._broadcastStateToSyncChannel("reconnecting");
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

    // The proxy URL is same-origin, so it is the only one that works when the
    // page is served from a public tunnel: getEventsUrl() returns an absolute
    // 127.0.0.1 address, which inside a sandbox VM resolves to the *agent's
    // machine rather than this host. So in tunnel mode the proxy wins
    // immediately instead of failing once and falling back.
    //
    // The proxy is ALSO the right primary outside tunnel mode. getEventsUrl()
    // reflects the backend's advertised events_url, which points at the
    // optional Go dashboard (port 3847). That dashboard is frequently not
    // running, and the browser's EventSource retries a refused connection on
    // its own — firing onerror in a CONNECTING state that our reconnect cap
    // never sees — so preferring it floods the console with ERR_CONNECTION_REFUSED
    // and never falls back. The backend's own /api/events is the canonical
    // realtime transport (see app/core/config.py) and is always available when
    // the backend runs, so it is primary; the configured URL is a fallback.
    const proxyUrl = `${window.location.protocol}//${window.location.host}/api/events`;
    const configuredUrl = getEventsUrl();
    const primaryUrl = proxyUrl;
    const fallbackUrl =
      configuredUrl && configuredUrl !== proxyUrl ? configuredUrl : null;

    const attempt = (url: string) => {
      // Build URL with Last-Event-ID for replay on reconnect
      const urlWithReplay = this.lastEventId
        ? `${url}?lastEventId=${encodeURIComponent(this.lastEventId)}`
        : url;
      this.eventSource = new EventSource(urlWithReplay);

      this.eventSource.onopen = () => {
        this.reconnectDelay = 1000;
        this.reconnectAttempts = 0; // Reset on successful connection
        this._connectionState = "connected";
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.emitState(true);
        this._broadcastStateToSyncChannel("connected");
        const queued = this.drainOfflineQueue();
        for (const message of queued) {
          this._dispatchToListeners(message);
          this._broadcastToSyncChannel(message);
        }
      };

      this.eventSource.onmessage = (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(event.data);
        } catch {
          return; // ignore non-JSON messages
        }
        // Capture Last-Event-ID for replay
        if (event.lastEventId) {
          this.lastEventId = event.lastEventId;
        }
        this._dispatchToListeners(message);
        this._broadcastToSyncChannel(message);
      };

      // Handle named events
      this.eventSource.addEventListener("connected", (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse((event as MessageEvent).data);
          this._dispatchToListeners(message);
        } catch {
          // ignore
        }
      });

      this.eventSource.addEventListener("keepalive", () => {
        // Keepalive received - connection is alive
      });

      this.eventSource.onerror = () => {
        const es = this.eventSource;
        // Ignore stale errors: the browser's EventSource fires onerror from
        // its own internal retry loop, and once we have closed the source
        // (or it is already CLOSED) further errors from it are duplicates
        // that would otherwise spawn extra reconnect attempts.
        if (!es || es.readyState === EventSource.CLOSED) {
          return;
        }

        // Close immediately so the browser's built-in retry stops.
        // Reconnection is owned by scheduleReconnect(), which honours
        // maxReconnectAttempts — leaving the source open lets the browser
        // retry the (often optional) endpoint forever, bypassing our cap.
        es.close();
        this.eventSource = null;

        this._connectionState = "reconnecting";
        this._broadcastStateToSyncChannel("reconnecting");

        const wasUsingPrimary = url === primaryUrl;
        if (wasUsingPrimary && fallbackUrl && fallbackUrl !== primaryUrl) {
          console.warn(
            `[SSE] ${url} unreachable, falling back to ${fallbackUrl}`,
          );
          attempt(fallbackUrl);
        } else {
          this.scheduleReconnect();
        }

        // Queue listeners for redispatch when the connection restores.
        for (const listener of this.listeners) {
          try {
            listener({ __offline: true });
          } catch {
            // ignore listener errors during shutdown
          }
        }
      };
    };

    attempt(primaryUrl);
  }

  private _dispatchToListeners(message: Record<string, unknown>): void {
    this.listeners.forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        console.error("[SSE] listener error:", error);
      }
    });
  }

  private emitState(connected: boolean): void {
    this.stateListeners.forEach((listener) => listener(connected));
  }
}

/** Global singleton SSE connection. */
export const sseService = new SSEService();
