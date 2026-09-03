import { useEffect, useRef } from "react";
import { updateMCPContext, type MCPContext } from "../../services/api";

let syncTimer: number | null = null;
const SYNC_INTERVAL_MS = 1000;

export function useMCPContextSync(patch: Partial<MCPContext>) {
  const pendingRef = useRef<Partial<MCPContext>>({});

  useEffect(() => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (syncTimer) return;
    syncTimer = window.setTimeout(async () => {
      syncTimer = null;
      const next = pendingRef.current;
      pendingRef.current = {};
      if (!next || Object.keys(next).length === 0) return;
      try {
        await updateMCPContext(next);
      } catch {
        // non-fatal: MCP context sync is best-effort
      }
    }, SYNC_INTERVAL_MS);
  }, [patch]);
}
