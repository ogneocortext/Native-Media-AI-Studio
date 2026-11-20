/**
 * MayaPresence — app-shell avatar chip fed by GET /api/logs/presence.
 *
 * Shows Maya's presence (active / recent / away) as a small chip in the topbar,
 * next to the notification bell. Polls every 15s (same cadence as the Live
 * Traffic panel). When a NEW session starts (a session_started_ts not shown
 * before) and she is active, a one-time entrance toast appears; the shown
 * session id is remembered in localStorage so it fires once per session. A
 * session that began more than 10 minutes before first observation is chip-only
 * (no toast).
 *
 * Never renders raw API paths or IPs — only the configured name/role and a
 * human "last seen" string.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { getLogPresence, type LogPresence } from "../../services/api";

const POLL_MS = 15000;
const TOAST_GRACE_SECONDS = 600; // 10 minutes
const LS_KEY = "maya:shown-session";
const VIOLET = "#8b5cf6";

function formatAgo(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "away";
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatLocalTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function readShownSession(): string {
  try {
    return localStorage.getItem(LS_KEY) || "";
  } catch {
    return "";
  }
}

function writeShownSession(ts: string): void {
  try {
    localStorage.setItem(LS_KEY, ts);
  } catch {
    /* localStorage unavailable (private mode) — toast simply won't persist */
  }
}

export function MayaPresence() {
  const [presence, setPresence] = useState<LogPresence | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [toast, setToast] = useState<{ ts: string } | null>(null);
  const firstObservationRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const p = await getLogPresence();
      setPresence(p);

      if (p.state === "active" && p.session_started_ts) {
        if (firstObservationRef.current === null) {
          firstObservationRef.current = Date.now();
        }
        const startedMs = new Date(p.session_started_ts).getTime();
        const startedAgoSec = Number.isNaN(startedMs)
          ? Number.POSITIVE_INFINITY
          : (Date.now() - startedMs) / 1000;
        const alreadyShown = readShownSession() === p.session_started_ts;
        if (!alreadyShown && startedAgoSec <= TOAST_GRACE_SECONDS) {
          setToast({ ts: p.session_started_ts });
          writeShownSession(p.session_started_ts);
        }
      }
    } catch {
      /* backend briefly unavailable — keep last known presence, retry next tick */
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  // Auto-dismiss the entrance toast after ~8s.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const name = presence?.name ?? "Maya";
  const role = presence?.role ?? "Manager";
  const avatar = presence?.avatar ?? "/maya-avatar.webp";
  const state = presence?.state ?? "away";
  const isActive = state === "active";
  const statusText = isActive
    ? "active"
    : state === "recent"
      ? formatAgo(presence?.seconds_since ?? null)
      : "away";

  const avatarNode = avatarFailed ? (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundColor: VIOLET }}
      aria-hidden
    >
      M
    </span>
  ) : (
    <img
      src={avatar}
      alt={name}
      draggable={false}
      onError={() => setAvatarFailed(true)}
      className="h-8 w-8 rounded-full object-cover object-top"
    />
  );

  return (
    <>
      <div
        className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-card/60 py-0.5 pl-0.5 pr-2"
        title={`${name} · ${role} · ${statusText}`}
      >
        <span className="relative flex h-8 w-8 shrink-0">
          {avatarNode}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
            {isActive && (
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                style={{ backgroundColor: VIOLET }}
              />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-background ${
                isActive ? "" : "bg-gray-400"
              }`}
              style={isActive ? { backgroundColor: VIOLET } : undefined}
            />
          </span>
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-semibold text-foreground">{name}</span>
          <span className="whitespace-nowrap text-[10px] text-muted">
            {role} · {statusText}
          </span>
        </span>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-xl border border-border bg-card p-3 shadow-lg"
        >
          <span className="flex h-10 w-10 shrink-0">
            {avatarFailed ? (
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full text-base font-bold text-white"
                style={{ backgroundColor: VIOLET }}
              >
                M
              </span>
            ) : (
              <img
                src={avatar}
                alt=""
                onError={() => setAvatarFailed(true)}
                className="h-10 w-10 rounded-full object-cover object-top"
              />
            )}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-foreground">
              {name} entered the Studio
            </span>
            <span className="text-xs text-muted">{formatLocalTime(toast.ts)}</span>
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToast(null)}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}