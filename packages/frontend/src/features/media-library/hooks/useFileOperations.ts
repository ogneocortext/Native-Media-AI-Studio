import { useState } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";
import { probeMedia } from "../../../services/api";

export function useFileOperations() {
  const [isOperating, setIsOperating] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const handleDelete = async (
    _filename: string,
    relativePath: string
  ): Promise<boolean> => {
    setIsOperating(true);
    setOperationError(null);
    try {
      await fetchWithTimeout(`/api/outputs/${encodeURIComponent(relativePath)}`, {
        method: "DELETE",
      });
      return true;
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : "Delete failed");
      return false;
    } finally {
      setIsOperating(false);
    }
  };

  const handleBulkDelete = async (
    paths: string[]
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
      const data = await res.json();
      return { deleted: data.deleted ?? paths.length, failed: data.failed ?? 0 };
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
    newName: string
  ): Promise<boolean> => {
    setIsOperating(true);
    setOperationError(null);
    try {
      await fetchWithTimeout(
        `/api/outputs/${encodeURIComponent(relativePath)}/rename`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_name: newName }),
        }
      );
      return true;
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : "Rename failed");
      return false;
    } finally {
      setIsOperating(false);
    }
  };

  const handleProbe = async (filename: string): Promise<any> => {
    setIsOperating(true);
    setOperationError(null);
    try {
      const res = await probeMedia(filename);
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
    handleDelete,
    handleBulkDelete,
    handleRename,
    handleProbe,
  };
}
