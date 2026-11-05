import { useEffect, useRef } from "react";
import { updateMCPContext, type MCPContext } from "../../services/api";

let syncTimer: number | null = null;
const SYNC_INTERVAL_MS = 1000;

export function useMCPContextSync(patch: Partial<MCPContext>) {
  const pendingRef = useRef<Partial<MCPContext>>({});
  // The caller passes a fresh object literal every render, so the effect below
  // fires on every render. Without this guard each fire POSTed
  // /api/health/context once a second for as long as the page was mounted.
  const lastSentRef = useRef("");

  useEffect(() => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (syncTimer) return;
    syncTimer = window.setTimeout(async () => {
      syncTimer = null;
      const next = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(next).length === 0) return;
      const key = JSON.stringify(next);
      if (key === lastSentRef.current) return;
      lastSentRef.current = key;
      try {
        await updateMCPContext(next);
      } catch {
        // non-fatal: MCP context sync is best-effort
        lastSentRef.current = "";
      }
    }, SYNC_INTERVAL_MS);
  }, [patch]);
}
