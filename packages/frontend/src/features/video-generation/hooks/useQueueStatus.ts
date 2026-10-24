import { useCallback, useState, useEffect } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";

function useQueueStatus() {
  const [queueInfo, setQueueInfo] = useState<{ running: number; pending: number } | null>(null);

  const fetchQueueStatus = useCallback(async () => {
    try {
      const res = await fetchWithTimeout("/api/integrations/music-video/queue", { timeout: 10000 });
      if (res.ok) {
        const data = await res.json();
        setQueueInfo(data);
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
