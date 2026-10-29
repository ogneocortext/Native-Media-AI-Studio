/**
 * Hook to track network/connection metrics for SSE and long-running operations.
 */

import { useState, useCallback, useRef } from "react";

export interface NetworkMetrics {
  uptime: number; // ms
  reconnectionCount: number;
  averageLatency: number; // ms
  bytesReceived: number;
  bytesSent: number;
  messageDropRate: number; // percentage
  connected: boolean;
}

export function useNetworkMetrics() {
  const [metrics, setMetrics] = useState<NetworkMetrics>({
    uptime: 0,
    reconnectionCount: 0,
    averageLatency: 0,
    bytesReceived: 0,
    bytesSent: 0,
    messageDropRate: 0,
    connected: false,
  });

  const connectionStartTimeRef = useRef<number>(0);
  const latencySamplesRef = useRef<number[]>([]);
  const totalMessagesRef = useRef(0);
  const droppedMessagesRef = useRef(0);

  const connect = useCallback(() => {
    connectionStartTimeRef.current = Date.now();
    setMetrics((prev) => ({
      ...prev,
      connected: true,
      uptime: 0,
    }));
  }, []);

  const disconnect = useCallback(() => {
    setMetrics((prev) => ({
      ...prev,
      connected: false,
    }));
  }, []);

  const recordReconnection = useCallback(() => {
    setMetrics((prev) => ({
      ...prev,
      reconnectionCount: prev.reconnectionCount + 1,
    }));
  }, []);

  const recordLatency = useCallback((latency: number) => {
    latencySamplesRef.current.push(latency);
    if (latencySamplesRef.current.length > 100) {
      latencySamplesRef.current.shift();
    }
    const avgLatency =
      latencySamplesRef.current.reduce((a, b) => a + b, 0) / latencySamplesRef.current.length;
    setMetrics((prev) => ({
      ...prev,
      averageLatency: avgLatency,
    }));
  }, []);

  const recordBytes = useCallback((received: number, sent: number) => {
    setMetrics((prev) => ({
      ...prev,
      bytesReceived: prev.bytesReceived + received,
      bytesSent: prev.bytesSent + sent,
    }));
  }, []);

  const recordMessageDrop = useCallback(() => {
    droppedMessagesRef.current++;
    totalMessagesRef.current++;
    const dropRate = (droppedMessagesRef.current / totalMessagesRef.current) * 100;
    setMetrics((prev) => ({
      ...prev,
      messageDropRate: dropRate,
    }));
  }, []);

  const recordMessage = useCallback(() => {
    totalMessagesRef.current++;
  }, []);

  // Update uptime every second when connected
  const updateUptime = useCallback(() => {
    if (connectionStartTimeRef.current > 0) {
      const uptime = Date.now() - connectionStartTimeRef.current;
      setMetrics((prev) => ({
        ...prev,
        uptime,
      }));
    }
  }, []);

  return {
    metrics,
    connect,
    disconnect,
    recordReconnection,
    recordLatency,
    recordBytes,
    recordMessageDrop,
    recordMessage,
    updateUptime,
  };
}
