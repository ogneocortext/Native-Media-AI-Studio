/**
 * MayaPresence — app-shell presence chips fed by GET /api/logs/presence (v1.4).
 *
 * Renders one chip per configured person (roster order) in the topbar. Each
 * chip shows an avatar (or a letter circle in the person's color), name,
 * role · activity, a three-state dot (violet pulse = active, amber = recent,
 * gray = away) and -- for traffic-source people -- a "Last visit" line and a
 * hover panel with the last 3 journal entries.
 *
 * Traffic-source chips link to the Log Analytics Live Traffic view filtered to
 * that client (?client=<ip>). Commit-source chips never link, never toast.
 *
 * A one-time entrance toast fires when a traffic-source person starts a NEW
 * active session (session id not shown before, started <10 min ago); the shown
 * id is remembered in localStorage.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import {
  getLogPresence,
  getPresenceJournal,
  type PresencePerson,
  type PresenceRoster,
  type PresenceJournalEntry,
} from "../../services/api";

const POLL_MS = 15000;
const TOAST_GRACE_SECONDS = 600; // 10 minutes
const VIOLET = "#8b5cf6";
const AMBER = "#f59e0b";
const GRAY = "#9ca3af";

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

function lastVisitLine(person: PresencePerson): string | null {
  if (person.state === "active") return null;
  if (!person.session_started_ts || !person.last_seen_ts) return null;
  const start = formatLocalTime(person.session_started_ts).replace(/\s*(AM|PM)$/i, "");
  const end = formatLocalTime(person.last_seen_ts);
  if (!start || !end) return null;
  return `Last visit ${start}–${end}`;
}

function dotColor(state: PresencePerson["state"]): string {
  if (state === "active") return VIOLET;
  if (state === "recent") return AMBER;
  return GRAY;
}

function shownKey(person: PresencePerson): string {
  return `maya:shown-session:${person.name}`;
}

function readShown(person: PresencePerson): string {
  try {
    return localStorage.getItem(shownKey(person)) || "";
  } catch {
    return "";
  }
}

function writeShown(person: PresencePerson, ts: string): void {
  try {
    localStorage.setItem(shownKey(person), ts);
  } catch {
    /* localStorage unavailable — toast simply won't persist */
  }
}

function subtextFor(person: PresencePerson): string {
  if (person.source === "commits") {
    if (person.state === "away" || person.last_seen_ts == null) return "away";
    return `last built ${formatAgo(person.seconds_since)}`;
  }
  // traffic source
  const role = person.role || "";
  if (person.state === "away") {
    return role ? `${role} · away` : "away";
  }
  const activity = person.activity || "working in the Studio";
  return role ? `${role} · ${activity}` : activity;
}

function Avatar({
  person,
  size,
  failed,
  onFail,
}: {
  person: PresencePerson;
  size: number;
  failed: boolean;
  onFail: () => void;
}) {
  const px = { width: size, height: size };
  if (person.avatar && !failed) {
    return (
      <img
        src={person.avatar}
        alt={person.name}
        draggable={false}
        onError={onFail}
        className="rounded-full object-cover object-top"
        style={px}
      />
    );
  }
  const initial = (person.name.trim()[0] || "?").toUpperCase();
  return (
    <span
      className="flex items-center justify-center rounded-full font-bold text-white"
      style={{ ...px, backgroundColor: person.color || VIOLET, fontSize: Math.round(size * 0.5) }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function PersonChip({
  person,
  journal,
  failed,
  onFail,
}: {
  person: PresencePerson;
  journal: PresenceJournalEntry[];
  failed: boolean;
  onFail: () => void;
}) {
  const dot = dotColor(person.state);
  const isActive = person.state === "active";
  const visit = lastVisitLine(person);
  const isTraffic = person.source === "traffic";
  const mine = journal.filter((j) => j.name === person.name).slice(0, 3);

  const inner = (
    <>
      <span className="relative flex shrink-0" style={{ width: 28, height: 28 }}>
        <Avatar person={person} size={28} failed={failed} onFail={onFail} />
        <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
          {isActive && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style={{ backgroundColor: dot }}
            />
          )}
          <span
            className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-background"
            style={{ backgroundColor: dot }}
          />
        </span>
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-semibold text-foreground">{person.name}</span>
        <span className="whitespace-nowrap text-[10px] text-muted">{subtextFor(person)}</span>
        {visit && (
          <span className="whitespace-nowrap text-[9px] text-muted/80">{visit}</span>
        )}
      </span>
    </>
  );

  const className =
    "group relative inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-card/60 py-0.5 pl-0.5 pr-2";

  const hoverPanel =
    isTraffic && mine.length > 0 ? (
      <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden w-max max-w-xs flex-col gap-0.5 rounded-lg border border-border bg-card p-2 text-left shadow-lg group-hover:flex">
        {mine.map((j) => (
          <span key={j.started_ts} className="whitespace-nowrap text-[10px] text-muted">
            {formatLocalTime(j.started_ts).replace(/\s*(AM|PM)$/i, "")}–
            {formatLocalTime(j.ended_ts)} · {Math.round(j.duration_seconds / 60)} min ·{" "}
            {j.areas.join(", ")}
          </span>
        ))}
      </span>
    ) : null;

  if (isTraffic && person.client_ip) {
    return (
      <Link
        to={`/system/log-analytics?client=${encodeURIComponent(person.client_ip)}`}
        className={className}
        title={`${person.name} · ${person.role} · ${subtextFor(person)}`}
      >
        {inner}
        {hoverPanel}
      </Link>
    );
  }
  return (
    <span className={className} title={`${person.name} · ${person.role} · ${subtextFor(person)}`}>
      {inner}
      {hoverPanel}
    </span>
  );
}

export function MayaPresence() {
  const [roster, setRoster] = useState<PresenceRoster | null>(null);
  const [journal, setJournal] = useState<PresenceJournalEntry[]>([]);
  const [toast, setToast] = useState<{ person: PresencePerson } | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const r = await getLogPresence();
      setRoster(r);
      // Entrance toast: new active session for a traffic-source person.
      for (const person of r.people) {
        if (person.source !== "traffic" || person.state !== "active" || !person.session_started_ts) {
          continue;
        }
        const startedMs = new Date(person.session_started_ts).getTime();
        const startedAgoSec = Number.isNaN(startedMs)
          ? Number.POSITIVE_INFINITY
          : (Date.now() - startedMs) / 1000;
        if (readShown(person) !== person.session_started_ts && startedAgoSec <= TOAST_GRACE_SECONDS) {
          setToast({ person });
          writeShown(person, person.session_started_ts);
        }
      }
      // Journal (for hover panels).
      try {
        const j = await getPresenceJournal(5);
        setJournal(j.entries);
      } catch {
        /* journal is optional */
      }
    } catch {
      /* backend briefly unavailable — keep last known roster */
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const markFailed = (name: string) =>
    setFailed((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });

  return (
    <>
      <span className="flex items-center gap-1">
        {roster?.people.map((person) => (
          <PersonChip
            key={person.name}
            person={person}
            journal={journal}
            failed={failed.has(person.name)}
            onFail={() => markFailed(person.name)}
          />
        ))}
      </span>

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-xl border border-border bg-card p-3 shadow-lg"
        >
          <span className="flex shrink-0" style={{ width: 40, height: 40 }}>
            <Avatar person={toast.person} size={40} failed={failed.has(toast.person.name)} onFail={() => markFailed(toast.person.name)} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-foreground">
              {toast.person.name} entered the Studio
              {toast.person.activity ? ` — ${toast.person.activity}` : ""}
            </span>
            <span className="text-xs text-muted">
              {formatLocalTime(new Date().toISOString())}
            </span>
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