/**
 * The Room — shared persistent space (scoping doc + knowledge standard).
 * Page chrome: camera bookmarks, Arrival/Late lighting, actor selector,
 * presence chip, "since you were gone" diary feed, conflict banner.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { BOOKMARKS, RoomCanvas } from "./scene/RoomCanvas";
import { useRoomStore } from "./roomStore";
import type { RoomActor } from "./types";

const ACTORS: { id: RoomActor; label: string }[] = [
  { id: "nate", label: "Nate" },
  { id: "maya", label: "Maya" },
];

function fmtTs(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function RoomPage() {
  const [bookmark, setBookmark] = useState(0);
  const [feedOpen, setFeedOpen] = useState(false);

  const state = useRoomStore((s) => s.state);
  const connected = useRoomStore((s) => s.connected);
  const actor = useRoomStore((s) => s.actor);
  const presence = useRoomStore((s) => s.presence);
  const sinceYouWereGone = useRoomStore((s) => s.sinceYouWereGone);
  const recentEvents = useRoomStore((s) => s.recentEvents);
  const conflict = useRoomStore((s) => s.conflict);
  const notice = useRoomStore((s) => s.notice);
  const lightingState = state?.lighting.state ?? "arrival";

  const bootstrap = useRoomStore((s) => s.bootstrap);
  const connectStream = useRoomStore((s) => s.connectStream);
  const setActor = useRoomStore((s) => s.setActor);
  const setLightingState = useRoomStore((s) => s.setLightingState);
  const dismissConflict = useRoomStore((s) => s.dismissConflict);
  const dismissNotice = useRoomStore((s) => s.dismissNotice);

  useEffect(() => {
    void bootstrap();
    const disconnect = connectStream();
    return disconnect;
  }, []);

  const mayaPresence = presence?.maya.state ?? "away";
  const presenceColor =
    mayaPresence === "present"
      ? "#ffd9a0"
      : mayaPresence === "recently active"
        ? "#d8a86a"
        : "#5a4a6a";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#07070f]">
      <RoomCanvas bookmark={bookmark} />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-white/10 bg-black/55 px-3 py-2 backdrop-blur">
          <span className="text-sm font-semibold tracking-wide text-[#F7F1E5]">
            The Room
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-white/60"
            title={connected ? "live" : "reconnecting"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-500"}`}
            />
            {connected ? "live" : "offline"}
          </span>
          {/* Maya presence chip */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/70"
            title="Maya's presence in the room"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: presenceColor }}
            />
            Maya · {mayaPresence}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {/* lighting state — room state, persists across reloads */}
          <div className="flex overflow-hidden rounded-lg border border-white/10 bg-black/55 text-[11px] backdrop-blur">
            {(["arrival", "late"] as const).map((s) => (
              <button
                key={s}
                onClick={() => void setLightingState(s)}
                className={`px-3 py-2 capitalize transition-colors ${
                  lightingState === s
                    ? "bg-[#4A3566] text-[#F7F1E5]"
                    : "text-white/60 hover:text-white/90"
                }`}
              >
                {s === "late" ? "Late" : "Arrival"}
              </button>
            ))}
          </div>
          {/* actor selector — who is acting right now */}
          <div className="flex overflow-hidden rounded-lg border border-white/10 bg-black/55 text-[11px] backdrop-blur">
            {ACTORS.map((a) => (
              <button
                key={a.id}
                onClick={() => setActor(a.id)}
                className={`px-3 py-2 transition-colors ${
                  actor === a.id
                    ? "bg-[#5C3D2E] text-[#F7F1E5]"
                    : "text-white/60 hover:text-white/90"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* camera bookmarks */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto flex gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-1.5 backdrop-blur">
          {BOOKMARKS.map((b, i) => (
            <button
              key={b.name}
              onClick={() => setBookmark(i)}
              className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                bookmark === i
                  ? "bg-[#B08D57] text-black"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              {b.name}
            </button>
          ))}
          <button
            onClick={() => setFeedOpen((v) => !v)}
            className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
              feedOpen
                ? "bg-[#4A3566] text-[#F7F1E5]"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            Diary{sinceYouWereGone.length > 0 ? ` (${sinceYouWereGone.length})` : ""}
          </button>
        </div>
      </div>

      {/* since-you-were-gone + recent diary feed */}
      {feedOpen && (
        <div className="absolute bottom-16 right-4 top-16 w-80 overflow-y-auto rounded-xl border border-white/10 bg-black/70 p-4 backdrop-blur">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#B08D57]">
            Since you were gone
          </h3>
          {sinceYouWereGone.length === 0 ? (
            <p className="text-xs text-white/50">Nothing new — the room is as you left it.</p>
          ) : (
            <ul className="mb-4 space-y-1.5">
              {sinceYouWereGone.map((e, i) => (
                <li key={`g${i}`} className="text-xs leading-snug text-[#F7F1E5]/90">
                  <span className="text-white/40">{fmtTs(e.ts)}</span> — {e.description}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#B08D57]">
            Room diary
          </h3>
          <ul className="space-y-1.5">
            {[...recentEvents].reverse().slice(0, 30).map((e, i) => (
              <li key={`r${i}`} className="text-xs leading-snug text-white/70">
                <span className="text-white/35">
                  {e.actor} · v{e.version} · {fmtTs(e.ts)}
                </span>
                <br />
                {e.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 409 conflict banner — fresh state surfaced; human chooses again */}
      {conflict && (
        <div className="absolute left-1/2 top-16 w-[30rem] -translate-x-1/2 rounded-xl border border-amber-400/40 bg-black/80 p-4 backdrop-blur" role="alert">
          <p className="text-sm text-amber-100">{conflict.message}</p>
          <p className="mt-1 text-xs text-white/50">
            Room is now at version {conflict.version}. Your last action was not applied.
          </p>
          <button
            onClick={dismissConflict}
            className="mt-3 rounded-md bg-amber-500/80 px-3 py-1 text-xs font-medium text-black hover:bg-amber-400"
          >
            Show me the room
          </button>
        </div>
      )}
      {notice && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg border border-red-400/40 bg-black/80 px-4 py-2 text-xs text-red-200 backdrop-blur" role="alert">
          {notice}
          <button onClick={dismissNotice} className="ml-3 text-white/60 underline">
            dismiss
          </button>
        </div>
      )}

      {!state && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#B08D57]" />
        </div>
      )}
    </div>
  );
}
