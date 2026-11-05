/**
 * Shared helpers for MCP bridges.
 *
 * Consolidates logic previously copy-pasted across:
 * - tools/mcp/vision-mcp.mjs
 * - tools/mcp/unity-mcp-bridge.mjs
 * - tools/mcp/hyperframes-mcp.mjs
 *
 * Import these instead of defining them locally in each bridge.
 */

import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

export const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Lifecycle state machine for production MCP servers
// ---------------------------------------------------------------------------

export const LifecycleState = {
  INITIALIZING: "initializing",
  READY: "ready",
  ACTIVE: "active",
  DRAINING: "draining",
  TERMINATED: "terminated",
};

export class MCPLifecycle {
  constructor() {
    this._state = LifecycleState.INITIALIZING;
    this._onStateChange = [];
    this._cleanupHandlers = [];
    this._activeRequests = 0;
  }

  get state() {
    return this._state;
  }

  get isAccepting() {
    return this._state === LifecycleState.READY || this._state === LifecycleState.ACTIVE;
  }

  onStateChange(handler) {
    this._onStateChange.push(handler);
  }

  onCleanup(handler) {
    this._cleanupHandlers.push(handler);
  }

  _transition(to) {
    const validTransitions = {
      [LifecycleState.INITIALIZING]: [LifecycleState.READY],
      [LifecycleState.READY]: [LifecycleState.ACTIVE, LifecycleState.DRAINING, LifecycleState.TERMINATED],
      [LifecycleState.ACTIVE]: [LifecycleState.DRAINING, LifecycleState.TERMINATED],
      [LifecycleState.DRAINING]: [LifecycleState.TERMINATED],
      [LifecycleState.TERMINATED]: [],
    };

    if (!validTransitions[this._state]?.includes(to)) {
      throw new Error(`Invalid lifecycle transition: ${this._state} -> ${to}`);
    }

    const from = this._state;
    this._state = to;
    this._onStateChange.forEach((h) => h(from, to));

    if (to === LifecycleState.TERMINATED) {
      this._cleanupHandlers.forEach((h) => {
        try {
          h();
        } catch (e) {
          console.error(`[lifecycle] cleanup error: ${e.message}`);
        }
      });
    }
  }

  markReady() {
    if (this._state === LifecycleState.INITIALIZING) {
      this._transition(LifecycleState.READY);
    }
  }

  markActive() {
    if (this._state === LifecycleState.READY) {
      this._transition(LifecycleState.ACTIVE);
    }
  }

  startRequest() {
    this._activeRequests++;
    if (this._state === LifecycleState.READY) {
      this.markActive();
    }
  }

  endRequest() {
    this._activeRequests = Math.max(0, this._activeRequests - 1);
  }

  async drain() {
    if (this._state === LifecycleState.ACTIVE || this._state === LifecycleState.READY) {
      this._transition(LifecycleState.DRAINING);
      // Wait for active requests to complete
      while (this._activeRequests > 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
      this._transition(LifecycleState.TERMINATED);
    }
  }

  terminate() {
    if (this._state !== LifecycleState.TERMINATED) {
      this._transition(LifecycleState.TERMINATED);
    }
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown handler for stdio MCP servers
// ---------------------------------------------------------------------------

export function setupGracefulShutdown(server, lifecycle) {
  const shutdown = async (signal) => {
    console.error(`[shutdown] ${signal} received, draining...`);
    await lifecycle.drain();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle stdin EOF (primary graceful shutdown signal per MCP spec)
  process.stdin.on("end", () => {
    console.error("[shutdown] stdin EOF, draining...");
    lifecycle.drain().then(() => process.exit(0));
  });

  process.stdin.on("close", () => {
    console.error("[shutdown] stdin closed, draining...");
    lifecycle.drain().then(() => process.exit(0));
  });
}

// ---------------------------------------------------------------------------
// Bounded LRU cache for memory management
// ---------------------------------------------------------------------------

export class BoundedCache {
  constructor(maxSize = 1000, ttlMs = 300000) {
    this._cache = new Map();
    this._maxSize = maxSize;
    this._ttlMs = ttlMs;
  }

  get(key) {
    const entry = this._cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this._ttlMs) {
      this._cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this._cache.delete(key);
    this._cache.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    // Remove if exists to update position
    if (this._cache.has(key)) {
      this._cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this._cache.size >= this._maxSize) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }

    this._cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  delete(key) {
    this._cache.delete(key);
  }

  clear() {
    this._cache.clear();
  }

  get size() {
    return this._cache.size;
  }
}

// ---------------------------------------------------------------------------
// Request tracking for graceful shutdown
// ---------------------------------------------------------------------------

export class RequestTracker {
  constructor() {
    this._requests = new Map();
  }

  start(id, abortController) {
    this._requests.set(id, {
      controller: abortController,
      startTime: Date.now(),
    });
  }

  end(id) {
    this._requests.delete(id);
  }

  abortAll() {
    for (const [id, req] of this._requests) {
      req.controller.abort();
    }
    this._requests.clear();
  }

  get activeCount() {
    return this._requests.size;
  }

  get activeIds() {
    return Array.from(this._requests.keys());
  }
}

// ---------------------------------------------------------------------------
// Enhanced MCP server factory with lifecycle management
// ---------------------------------------------------------------------------

export function createMCPServer(name, version, toolDefs, toolHandlers) {
  const lifecycle = new MCPLifecycle();
  const requestTracker = new RequestTracker();

  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } }
  );

  // Track requests for graceful shutdown
  const originalCallHandler = server.setRequestHandler.bind(server);
  server.setRequestHandler = (method, handler) => {
    if (method === "tools/call") {
      return originalCallHandler(method, async (request) => {
        const requestId = `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const abortController = new AbortController();
        requestTracker.start(requestId, abortController);
        lifecycle.startRequest();

        try {
          const result = await handler(request);
          return result;
        } finally {
          requestTracker.end(requestId);
          lifecycle.endRequest();
        }
      });
    }
    return originalCallHandler(method, handler);
  };

  // Set up tool handlers
  server.setRequestHandler("tools/list", async () => ({
    tools: toolDefs.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      inputSchema: t.function.parameters,
    })),
  }));

  server.setRequestHandler("tools/call", async (request) => {
    const { name: toolName, arguments: args } = request.params;
    try {
      return await toolHandlers[toolName](args || {});
    } catch (e) {
      console.error(`[${name}] tool error: ${e.message}`);
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  });

  // Mark ready after server is set up
  lifecycle.markReady();

  return { server, lifecycle, requestTracker };
}

// ---------------------------------------------------------------------------
// Existing helpers (unchanged)
// ---------------------------------------------------------------------------

/** Fetch with an abort-based timeout and non-ok => thrown error. */
export async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function validateMcpToolCall(toolName, args, timeoutMs = 5000) {
  try {
    const res = await fetchWithTimeout(
      `${BACKEND_URL}/api/mcp/validate-tool`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_name: toolName, arguments: args }),
      },
      timeoutMs,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.valid) {
      throw new Error(`Invalid tool args for ${toolName}: ${data.error}`);
    }
    return data.arguments;
  } catch (err) {
    console.error(`[mcp-validate] ${toolName}: ${err.message}`);
    return null;
  }
}

export function logRequest(reqId, tool, detail) {
  console.error(`[${reqId}] ${tool} | ${detail}`);
}

export function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function textResponse(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}