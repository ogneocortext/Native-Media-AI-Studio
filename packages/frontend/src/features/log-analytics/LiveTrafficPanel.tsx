/**
 * Live Traffic — real-time HTTP request stream for the Admin console.
 *
 * Polls GET /api/logs/traffic incrementally (since=<last_seq>) every ~1.5s and
 * renders every request the backend handled -- fast ones included, regardless
 * of the console log level. This is the "see all the requests as they happen"
 * view; health/SSE/this-polling-own-endpoint are excluded server-side so the
 * feed is signal, not noise.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Radio, Pause, Play, Trash2, X } from "lucide-react";
import { Card } from "../../components/common";
import { getLogTraffic, type LogTrafficEntry } from "../../services/api";

const MAX_ROWS = 200;
const POLL_MS = 1500;

function statusClass(status: number): string {
  if (status >= 500) return "text-error-text";
  if (status >= 400) return "text-warning";
  if (status >= 300) return "text-info";
  return "text-emerald-400";
}

function methodClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-info";
    case "POST":
      return "text-emerald-400";
    case "PUT":
    case "PATCH":
      return "text-warning";
    case "DELETE":
      return "text-error-text";
    default:
      return "text-muted";
  }
}

export function LiveTrafficPanel() {
  const [entries, setEntries] = useState<LogTrafficEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const lastSeqRef = useRef(0);
  const inFlightRef = useRef(false);

  const poll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await getLogTraffic(lastSeqRef.current, MAX_ROWS);
      lastSeqRef.current = res.latest_seq;
      if (res.entries.length > 0) {
        setEntries((prev) => {
          const bySeq = new Map<number, LogTrafficEntry>();
          for (const e of prev) bySeq.set(e.seq, e);
          for (const e of res.entries) bySeq.set(e.seq, e);
          return Array.from(bySeq.values())
            .sort((a, b) => a.seq - b.seq)
            .slice(-MAX_ROWS);
        });
      }
      setConnected(true);
      setError(null);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
      // Reset the cursor on failure so a reconnect cannot skip unseen entries.
      lastSeqRef.current = 0;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void poll();
    if (paused) return;
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [poll, paused]);

  // Read ?client= from the URL on load (Maya's chip links here to filter her traffic).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("client");
    if (c) setClientFilter(c);
  }, []);

  const clear = () => {
    setEntries([]);
    lastSeqRef.current = 0;
  };

  // Newest first for display, optionally narrowed to one client (from ?client=).
  const rows = [...entries].reverse().filter((e) => !clientFilter || e.client_ip === clientFilter);

  return (
    <Card className="mb-4 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Radio size={14} className={connected ? "text-emerald-400" : "text-muted"} />
          <span className="text-sm font-semibold">Live Traffic</span>
          <span className="text-[10px] text-muted tabular-nums">
            {entries.length} req{entries.length === 1 ? "" : "s"}
          </span>
          {clientFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
              client {clientFilter}
              <button
                type="button"
                onClick={() => setClientFilter(null)}
                title="Clear client filter"
                className="inline-flex"
              >
                <X size={10} />
              </button>
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px]">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                connected ? "bg-emerald-400" : error ? "bg-error-text" : "bg-muted"
              }`}
            />
            <span className="text-muted">
              {paused ? "paused" : connected ? "live" : error ? "disconnected" : "connecting"}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume live updates" : "Pause live updates"}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={clear} title="Clear view">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 text-[10px] text-error-text bg-error-text/10">
          {error}
        </div>
      )}

      <div className="overflow-auto" style={{ maxHeight: 320 }}>
        <table className="w-full text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-background/80 backdrop-blur">
            <tr className="text-muted text-left">
              <th className="px-3 py-1 font-medium">Time</th>
              <th className="px-2 py-1 font-medium">Method</th>
              <th className="px-2 py-1 font-medium">Path</th>
              <th className="px-2 py-1 font-medium">Status</th>
              <th className="px-2 py-1 font-medium text-right">ms</th>
              <th className="px-3 py-1 font-medium">Client</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  {paused ? "Paused." : "Waiting for requests..."}
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.seq} className="border-t border-border/40 hover:bg-white/5">
                <td className="px-3 py-0.5 text-muted whitespace-nowrap">
                  {e.ts.slice(11, 23)}
                </td>
                <td className={`px-2 py-0.5 font-semibold ${methodClass(e.method)}`}>
                  {e.method}
                </td>
                <td className="px-2 py-0.5 max-w-[380px] truncate" title={e.query ? `${e.path}?${e.query}` : e.path}>
                  {e.path}
                  {e.query ? <span className="text-muted">?{e.query}</span> : null}
                </td>
                <td className={`px-2 py-0.5 font-semibold ${statusClass(e.status)}`}>{e.status}</td>
                <td className="px-2 py-0.5 text-right text-muted">{e.duration_ms.toFixed(0)}</td>
                <td className="px-3 py-0.5 text-muted font-mono text-[10px]">{e.client_ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}