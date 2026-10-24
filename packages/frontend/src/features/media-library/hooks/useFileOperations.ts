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
          method: "PUT",
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
    handleRename,
    handleProbe,
  };
}
