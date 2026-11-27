import { useState } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";
import { probeMedia, type MediaProbeResponse } from "../../../services/api";

export function useFileOperations() {
  const [isOperating, setIsOperating] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const handleBulkDelete = async (
    paths: string[],
  ): Promise<{ deleted: number; failed: number }> => {
    setIsOperating(true);
    setOperationError(null);
    try {
      const res = await fetchWithTimeout("/api/outputs/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) throw new Error(`bulk-delete ${res.status}`);
      const data = (await res.json()) as {
        deleted?: string[];
        failed?: { path: string; error: string }[];
        deleted_count?: number;
      };
      return {
        deleted: data.deleted_count ?? 0,
        failed: data.failed?.length ?? 0,
      };
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : "Bulk delete failed");
      return { deleted: 0, failed: paths.length };
    } finally {
      setIsOperating(false);
    }
  };

  const handleRename = async (
    _filename: string,
    relativePath: string,
    newName: string,
  ): Promise<boolean> => {
    setIsOperating(true);
    setOperationError(null);
    try {
      const res = await fetchWithTimeout(`/api/outputs/${encodeURIComponent(relativePath)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: newName }),
      });
      if (!res.ok) {
        let detail = `Rename failed (${res.status})`;
        try {
          const body = (await res.json()) as {
            detail?: string;
            error?: { message?: string };
          };
          detail = body.detail ?? body.error?.message ?? detail;
        } catch {
          // Non-JSON error body — keep the status-based message.
        }
        throw new Error(detail);
      }
      return true;
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : "Rename failed");
      return false;
    } finally {
      setIsOperating(false);
    }
  };

  const handleProbe = async (path: string): Promise<MediaProbeResponse | null> => {
    setIsOperating(true);
    setOperationError(null);
    try {
      const res = await probeMedia(path);
      return res;
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : "Probe failed");
      return null;
    } finally {
      setIsOperating(false);
    }
  };

  return {
    isOperating,
    operationError,
    handleBulkDelete,
    handleRename,
    handleProbe,
    setOperationError,
  };
}
