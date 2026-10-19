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

export async function validateMcpToolCall(toolName, args) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/mcp/validate-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_name: toolName, arguments: args }),
    });
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