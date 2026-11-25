/**
 * Presence — app-shell presence chips fed by GET /api/logs/presence.
 *
 * Renders one chip per configured worker (roster order) in the topbar. Each
 * chip shows an avatar (or a letter circle in the worker's color), the
 * worker's label, sub-line, an optional availability note, and a three-state
 * dot:
 *   - working (violet pulse) -- real activity within the last 15 minutes
 *   - idle (amber)           -- has a signal, but nothing recent
 *   - unavailable (gray)     -- flagged unavailable in the presence config
 *
 * Activity comes from the real signals the backend presence computation can
 * already reach (live request log for traffic-source workers, git commit
 * trailers for commit-source workers). A worker with no reliable signal is
 * shown idle -- activity is never fabricated.
 *
 * Per-worker label / sublabel / note / unavailable come from the presence
 * config (config/logging.json -> presence.people), so editing that file and
 * reloading updates the badges with no code change. The Kilo worker's label is
 * the current-model field (the model currently loaded in Kilo); it is read
 * from config, never hardcoded here.
 *
 * Tooltip: "<Label> · <sublabel> · <status text>", each element exactly once.
 */

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  getPresenceJournal,
  type PresencePerson,
  type PresenceJournalEntry,
} from "../../services/api";
import {
  usePresenceRoster,
  presenceStatusFor,
} from "./usePresenceRoster";

const JOURNAL_POLL_MS = 15000;
const TOAST_GRACE_SECONDS = 600; // 10 minutes
const VIOLET = "#8b5cf6";
const AMBER = "#f59e0b";
const GRAY = "#9ca3af";

type Status = "working" | "idle" | "unavailable";

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
  const end = formatLocalTime(person.last_seen_ts).replace(/\s*(AM|PM)$/i, "");
  if (!start || !end) return null;
  return `Last visit ${start}–${end}`;
}

function dotColor(status: Status): string {
  if (status === "working") return VIOLET;
  if (status === "idle") return AMBER;
  return GRAY;
}

function statusText(status: Status): string {
  if (status === "working") return "Working";
  if (status === "idle") return "Idle";
  return "Unavailable";
}

function statusFor(person: PresencePerson): Status {
  return presenceStatusFor(person);
}

function shownKey(name: string): string {
  return `presence:shown-session:${name}`;
}

function readShown(name: string): string {
  try {
    return localStorage.getItem(shownKey(name)) ?? "";
  } catch {
    return "";
  }
}

function writeShown(name: string, ts: string): void {
  try {
    localStorage.setItem(shownKey(name), ts);
  } catch {
    /* localStorage unavailable — toast simply won't persist */
  }
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
      style={{ ...px, backgroundColor: person.color ?? VIOLET, fontSize: Math.round(size * 0.5) }}
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
  const status = statusFor(person);
  const dot = dotColor(status);
  const isActive = status === "working";
  const visit = lastVisitLine(person);
  const isTraffic = person.source === "traffic";
  const mine = journal.filter((j) => j.name === person.name).slice(0, 3);

  const label = person.label ?? person.name;
  const sublabel = person.sublabel ?? person.role;
  const note = person.note;

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
      <span
        className={`flex min-w-0 flex-col leading-tight ${status === "unavailable" ? "opacity-60" : ""}`}
      >
        <span className="truncate text-xs font-semibold text-foreground">{label}</span>
        <span className="whitespace-nowrap text-[10px] text-muted">{sublabel}</span>
        {note && (
          <span className="whitespace-nowrap text-[9px] text-muted/70">{note}</span>
        )}
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

  const tooltip = `${label} · ${sublabel} · ${statusText(status)}`;

  if (isTraffic && person.client_ip) {
    return (
      <Link
        to={`/system/log-analytics?client=${encodeURIComponent(person.client_ip)}`}
        className={className}
        title={tooltip}
      >
        {inner}
        {hoverPanel}
      </Link>
    );
  }
  return (
    <span className={className} title={tooltip}>
      {inner}
      {hoverPanel}
    </span>
  );
}

export function Presence() {
  const roster = usePresenceRoster();
  const [journal, setJournal] = useState<PresenceJournalEntry[]>([]);
  const [toast, setToast] = useState<{ person: PresencePerson } | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(
    typeof document !== "undefined" ? !document.hidden : true,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Entrance toast: new active session for a traffic-source worker.
  // Runs whenever the shared roster updates (single poller upstream).
  useEffect(() => {
    if (!roster) return;
    for (const person of roster.people) {
      if (person.source !== "traffic" || person.state !== "active" || !person.session_started_ts) {
        continue;
      }
      const startedMs = new Date(person.session_started_ts).getTime();
      const startedAgoSec = Number.isNaN(startedMs)
        ? Number.POSITIVE_INFINITY
        : (Date.now() - startedMs) / 1000;
      if (readShown(person.name) !== person.session_started_ts && startedAgoSec <= TOAST_GRACE_SECONDS) {
        setToast({ person });
        writeShown(person.name, person.session_started_ts);
      }
    }
  }, [roster]);

  // Journal (for hover panels) — independent of the roster poll.
  const pollJournal = useCallback(async () => {
    if (!visible) return;
    try {
      const j = await getPresenceJournal(5);
      setJournal(j.entries);
    } catch {
      /* journal is optional */
    }
  }, [visible]);

  useEffect(() => {
    void pollJournal();
    const id = window.setInterval(() => void pollJournal(), JOURNAL_POLL_MS);
    return () => window.clearInterval(id);
  }, [pollJournal]);

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
      <span className="flex max-w-[46rem] flex-wrap items-center justify-end gap-1">
        {roster?.people.map((person) => (
          <PersonChip
            key={person.id ?? person.name}
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
            <Avatar
              person={toast.person}
              size={40}
              failed={failed.has(toast.person.name)}
              onFail={() => markFailed(toast.person.name)}
            />
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

export default Presence;
