import { useCallback, useState, useEffect } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";

function useQueueStatus() {
  const [queueInfo, setQueueInfo] = useState<{ running: number; pending: number } | null>(null);

  const fetchQueueStatus = useCallback(async () => {
    try {
      const res = await fetchWithTimeout("/api/health/queue", { timeout: 10000 });
      if (res.ok) {
        const data = await res.json();
        const stats = data.stats || data;
        setQueueInfo({
          running: stats.running ?? 0,
          pending: stats.pending ?? 0,
        });
      }
    } catch {
      // Queue status fetch failure — ignore
    }
  }, []);

  // Poll every 10 seconds
  useEffect(() => {
    fetchQueueStatus();
    const id = setInterval(fetchQueueStatus, 10000);
    return () => clearInterval(id);
  }, []);

  return { queueInfo, refetch: fetchQueueStatus };
}

export { useQueueStatus };
