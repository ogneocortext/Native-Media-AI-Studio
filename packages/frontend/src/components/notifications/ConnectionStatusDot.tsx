import { useJobStore } from "../../state/jobStore";

const DOT_CLASS: Record<string, string> = {
  connected: "connection-dot--connected",
  reconnecting: "connection-dot--reconnecting",
  disconnected: "connection-dot--disconnected",
};

export function ConnectionStatusDot() {
  const sseConnected = useJobStore((s) => s.sseConnected);

  // The health store also tracks SSE state; fall back to a best-effort label.
  const label = sseConnected ? "Connected" : "Disconnected";
  const className = `connection-dot ${DOT_CLASS[sseConnected ? "connected" : "disconnected"]}`;

  return (
    <span
      className={className}
      title={`Real-time updates: ${label}`}
      aria-label={`Real-time updates: ${label}`}
    />
  );
}
