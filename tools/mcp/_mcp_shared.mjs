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

export const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

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