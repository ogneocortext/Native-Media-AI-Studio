import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Cpu, Play, Pause, Eye, RefreshCw, Music, Save, Trash2, FileMusic } from "lucide-react";
import { getApiBase } from "../../services/api/core";
import { DS } from "../../styles/designSystem";
import { Card, StatusBadge } from "../../components/common";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";

/* ------------------------------------------------------------------ */
/* Studio Console tokens (brand palette kit v0.1) - the Schism Tracker */
/* Info Page (F5) layout re-themed: console base, violet structure,    */
/* cyan/magenta energy accents only, flat inset panels, mono grid.     */
/* ------------------------------------------------------------------ */
const TK = {
  base: "#131826",
  panel: "#0B0E17",
  fg: "#E9EDF6",
  dim: "#8F9BB3",
  faint: "#3A4160",
  violet: "#5533A8",
  violetDeep: "#3A2270",
  cyan: "#22D3EE",
  magenta: "#E14E8A",
};
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace";

interface SystemInfo {
  name: string;
  label: string;
  voices: number;
}

interface ChannelMetrics {
  name: string;
  density: number;
  pitch_span_st: number;
}

interface PatternMetrics {
  note_density: number;
  rep_ratio: number;
  lead_unique_bars: number;
  channels: ChannelMetrics[];
}

interface RenderResult {
  system: string;
  wav?: string;
  roll?: string;
  errors?: string;
  metrics?: PatternMetrics;
}

interface RenderResponse {
  name: string;
  preview: boolean;
  results?: RenderResult[];
  errors?: { system: string; error: string }[];
}

/* ------------------------- .chip parsing -------------------------- */

interface ParsedPattern {
  parts: string[];
  rows: string[][]; // rows[row][partIndex] = token
}

interface ChipModel {
  system: string;
  tempo: number;
  order: string[];
  patterns: Partial<Record<string, ParsedPattern>>;
  partNames: string[];
}

function parseChip(text: string): ChipModel | null {
  let system = "nes";
  let tempo = 125;
  let order: string[] = [];
  const rawPatterns: Partial<Record<string, Partial<Record<string, string[]>>>> = {};
  const partNames: string[] = [];
  let current: string | null = null;

  const addPart = (pat: string, part: string, cells: string[]) => {
    const bucket = rawPatterns[pat] ?? {};
    bucket[part] = cells;
    rawPatterns[pat] = bucket;
    if (!partNames.includes(part)) partNames.push(part);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const patMatch = /^pattern\s+(\S+)\s*:$/i.exec(line);
    if (patMatch) {
      current = patMatch[1];
      rawPatterns[current] ??= {};
      continue;
    }
    const partMatch = /^([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line);
    if (partMatch && !/^(system|tempo|swing|order|wave|vibrato|filter|ringmod)$/i.test(partMatch[1])) {
      const cells = line
        .slice(line.indexOf(":") + 1)
        .split("|")
        .flatMap((bar) => bar.trim().split(/\s+/))
        .filter(Boolean);
      addPart(current ?? "main", partMatch[1], cells);
      continue;
    }
    const kv = line.split(/\s+/);
    if (kv[0] === "system" && kv[1]) system = kv[1];
    else if (kv[0] === "tempo" && kv[1]) tempo = parseFloat(kv[1]) || tempo;
    else if (kv[0] === "order") order = kv.slice(1);
  }

  const names = Object.keys(rawPatterns);
  if (!names.length) return null;
  if (!order.length) order = names;
  order = order.filter((n) => rawPatterns[n]);
  if (!order.length) order = names;

  const patterns: Partial<Record<string, ParsedPattern>> = {};
  for (const name of names) {
    const parts = partNames.filter((p) => rawPatterns[name]?.[p]);
    const rowsCount = Math.max(...parts.map((p) => rawPatterns[name]?.[p]?.length ?? 0), 0);
    const rows: string[][] = [];
    for (let r = 0; r < rowsCount; r++) {
      rows.push(partNames.map((p) => rawPatterns[name]?.[p]?.[r] ?? "."));
    }
    patterns[name] = { parts, rows };
  }
  return { system, tempo, order, patterns, partNames };
}

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteMidi(token: string): number | null {
  const m = /^([A-G])(#)?-(\d)/.exec(token);
  if (!m) return null;
  return 12 * (parseInt(m[3]) + 1) + SEMI[m[1]] + (m[2] ? 1 : 0);
}

function isOnset(token: string): boolean {
  return token !== "." && token !== "-" && token !== "";
}

function outUrl(api: string, path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/^output\//, "");
  return `${api}/output/${clean}`;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ------------------------------ page ------------------------------ */

export function ChiptunePage() {
  const api = getApiBase();
  const { refresh: refreshAudioLibrary } = useAudioLibrary();

  const [systems, setSystems] = useState<SystemInfo[]>([]);
  const [pattern, setPattern] = useState("");
  const [system, setSystem] = useState("file");
  const [name, setName] = useState("chiptune-demo");
  const [transpose, setTranspose] = useState(0);
  const [tempo, setTempo] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "render">("");
  const [error, setError] = useState("");
  const [rolls, setRolls] = useState<{ system: string; url: string }[]>([]);
  const [takes, setTakes] = useState<{ system: string; url: string }[]>([]);
  const [patterns, setPatterns] = useState<{ name: string }[]>([]);
  const [loadedPattern, setLoadedPattern] = useState("");
  const [saveName, setSaveName] = useState("");
  const [metrics, setMetrics] = useState<PatternMetrics | null>(null);

  /* playback (visual tracker transport, Schism F5 style) */
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // global row position across the order
  const [levels, setLevels] = useState<number[]>([]);
  const posRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const model = useMemo(() => parseChip(pattern), [pattern]);
  const effTempo = tempo ? parseFloat(tempo) || (model?.tempo ?? 125) : (model?.tempo ?? 125);
  const rowDur = 60 / effTempo / 4; // one cell = one 16th
  const totalRows = model ? model.order.reduce((n, p) => n + (model.patterns[p]?.rows.length ?? 0), 0) : 0;

  const rowDurRef = useRef(rowDur);
  rowDurRef.current = rowDur;
  const totalRowsRef = useRef(totalRows);
  totalRowsRef.current = totalRows;

  /* locate current pattern + row from the global position */
  const cursor = useMemo(() => {
    if (!model || !totalRows) return { orderIdx: 0, patName: "", row: 0, rowsInPat: 0 };
    let rest = Math.floor(pos) % totalRows;
    for (let i = 0; i < model.order.length; i++) {
      const patName = model.order[i];
      const rowsInPat = model.patterns[patName]?.rows.length ?? 0;
      if (rest < rowsInPat) return { orderIdx: i, patName, row: rest, rowsInPat };
      rest -= rowsInPat;
    }
    const firstPat = model.order.at(0) ?? "";
    return { orderIdx: 0, patName: firstPat, row: 0, rowsInPat: model.patterns[firstPat]?.rows.length ?? 0 };
  }, [model, pos, totalRows]);

  const curPattern: ParsedPattern | null =
    model && cursor.patName ? (model.patterns[cursor.patName] ?? null) : null;

  /* transport clock: rendered audio is the master when it is playing,
     otherwise a wall clock advances the row cursor (silent preview). */
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const a = audioRef.current;
      if (a && !a.paused && a.duration > 0) {
        posRef.current = a.currentTime / rowDurRef.current;
      } else {
        posRef.current += dt / rowDurRef.current;
      }
      if (totalRowsRef.current > 0) posRef.current %= totalRowsRef.current;
      setPos(posRef.current);
    }, 50);
    return () => clearInterval(id);
  }, [playing]);

  /* channel meters: level from the token under the cursor + decay */
  useEffect(() => {
    if (!model || !curPattern) {
      setLevels([]);
      return;
    }
    setLevels((prev) =>
      model.partNames.map((_, i) => {
        const token = curPattern.rows[cursor.row]?.[i] ?? ".";
        if (isOnset(token)) return 1;
        if (token === "-") return Math.max(0.62, (prev[i] ?? 0) * 0.92);
        return (prev[i] ?? 0) * 0.45;
      }),
    );
  }, [model, curPattern, cursor.row]);

  /* keep the playhead row visible in the pattern grid */
  useEffect(() => {
    document
      .getElementById(`chip-row-${cursor.row}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor.row, cursor.patName]);

  const togglePlay = useCallback(() => {
    setPlaying((was) => {
      const next = !was;
      const a = audioRef.current;
      if (a) {
        if (next) void a.play().catch(() => undefined);
        else a.pause();
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  /* --------------------------- data --------------------------- */

  const loadMeta = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetch(`${api}/api/chiptune/systems`).then(
          async (r) => (await r.json()) as { systems?: SystemInfo[] },
        ),
        fetch(`${api}/api/chiptune/demo`).then(
          async (r) => (await r.json()) as { pattern?: string },
        ),
      ]);
      setSystems(s.systems ?? []);
      setPattern(d.pattern ?? "");
      const p = (await fetch(`${api}/api/chiptune/patterns`).then(
        async (r) => (await r.json()) as { patterns?: { name: string }[] },
      ));
      setPatterns(p.patterns ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, [api]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const loadPattern = async (pname: string) => {
    if (!pname) return;
    try {
      const j = (await fetch(`${api}/api/chiptune/patterns/${pname}`).then(
        async (r) => (await r.json()) as { pattern?: string },
      ));
      setPattern(j.pattern ?? "");
      setLoadedPattern(pname);
      setSaveName(pname);
      setMetrics(null);
      posRef.current = 0;
      setPos(0);
    } catch (e) {
      setError(String(e));
    }
  };

  const savePattern = async () => {
    const target = saveName || loadedPattern || name;
    if (!target) return;
    try {
      const r = await fetch(`${api}/api/chiptune/patterns/${target}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      const j = (await r.json()) as { detail?: string };
      if (!r.ok) throw new Error(j.detail ?? r.statusText);
      setLoadedPattern(target);
      setSaveName(target);
      await loadMeta();
    } catch (e) {
      setError(String(e));
    }
  };

  const deletePattern = async () => {
    if (!loadedPattern) return;
    try {
      await fetch(`${api}/api/chiptune/patterns/${loadedPattern}`, { method: "DELETE" });
      setLoadedPattern("");
      await loadMeta();
    } catch (e) {
      setError(String(e));
    }
  };

  const importMidi = async (file: File) => {
    setBusy("preview");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${api}/api/chiptune/import-midi`, { method: "POST", body: fd });
      const j = (await r.json()) as { detail?: string; pattern?: string };
      if (!r.ok) throw new Error(j.detail ?? r.statusText);
      setPattern(j.pattern ?? "");
      setLoadedPattern("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const submit = async (preview: boolean) => {
    setBusy(preview ? "preview" : "render");
    setError("");
    try {
      const r = await fetch(`${api}/api/chiptune/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern,
          name,
          system,
          transpose,
          tempo: tempo ? parseFloat(tempo) : null,
          preview,
        }),
      });
      const j = (await r.json()) as RenderResponse & { detail?: string };
      if (!r.ok) throw new Error(j.detail ?? r.statusText);
      const items = (j.results ?? []).filter((x) => x.roll ?? x.wav);
      if (items[0]?.metrics) setMetrics(items[0].metrics);
      if (preview) {
        setRolls(items.map((x) => ({ system: x.system, url: outUrl(api, x.roll ?? "") })));
      } else {
        setTakes(
          items
            .filter((x) => x.wav)
            .map((x) => ({ system: x.system, url: outUrl(api, x.wav ?? "") })),
        );
        void refreshAudioLibrary();
      }
      if (j.errors?.length) {
        setError(j.errors.map((e) => `${e.system}: ${e.error}`).join("; "));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  /* ------------------------- derived UI ------------------------- */

  const effSystemName =
    system === "file" ? model?.system ?? "nes" : system === "all" ? "all" : system;
  const effSystem = systems.find((s) => s.name === effSystemName);
  const activeChannels = levels.filter((l) => l > 0.05).length;
  const masterLevel = levels.length ? Math.max(...levels) : 0;
  const songSeconds = totalRows * rowDur;
  const curSeconds = pos * rowDur;

  const msgLines: [string, string][] = model
    ? [
        ["01", `"${name}"`],
        ["02", `system: ${effSystem?.label ?? effSystemName}`],
        ["03", `order: ${model.order.join(" ")}`],
        ["04", `rows: ${totalRows} - length: ${fmtTime(songSeconds)} - tempo: ${effTempo}`],
        ["05", `parts: ${model.partNames.join(" / ")}`],
        ...(metrics
          ? ([
              ["07", `note density: ${(metrics.note_density * 100).toFixed(0)}% - repetition: ${(metrics.rep_ratio * 100).toFixed(0)}%`],
              ["08", `lead unique bars: ${metrics.lead_unique_bars}`],
              ["09", metrics.channels.map((c) => `${c.name} ${(c.density * 100).toFixed(0)}%/${c.pitch_span_st}st`).join(" - ")],
            ] as [string, string][])
          : ([["07", "preview or render to measure this pattern (preview-first)"]] as [string, string][])),
        ["11", "every note traceable to a decision"],
      ]
    : [["01", "no pattern loaded"]];

  const segBar = (level: number, segs = 24) => (
    <div className="flex gap-[2px] flex-1">
      {Array.from({ length: segs }, (_, i) => {
        const on = i < Math.round(level * segs);
        const color = !on ? "#232A44" : i >= segs - 3 ? TK.magenta : i >= segs - 8 ? TK.cyan : TK.violet;
        return <div key={i} style={{ background: color, height: 12, flex: 1 }} />;
      })}
    </div>
  );

  const labelCls = "text-[10px] uppercase tracking-widest";
  const barCls = "px-2 py-[3px] text-xs truncate";
  const barStyle = { background: TK.panel, border: `1px solid ${TK.faint}`, color: TK.fg } as const;
  const inputInBar = "w-full bg-transparent outline-none text-xs";

  /* ---------------------------- render ---------------------------- */

  return (
    <div className={DS.page}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={DS.pageTitle}>
            <Cpu size={24} className="text-accent" />
            Chiptune
          </h1>
          <p className={DS.pageSubtitle}>
            Tracker-pattern chip music - preview the roll before you listen (T-MUS-06)
          </p>
        </div>
        <button
          onClick={() => {
            void loadMeta();
          }}
          disabled={!!busy}
          className="btn btn-ghost"
          title="Reload"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ============ INFO PAGE (F5) - Schism layout, Studio Console ============ */}
      <div
        style={{
          background: TK.base,
          border: `2px solid ${TK.violet}`,
          color: TK.fg,
          fontFamily: MONO,
        }}
        className="p-3 select-none"
      >
        <div className="text-center text-sm tracking-[0.3em] uppercase">
          Studio Tracker <span style={{ color: TK.dim }}>- chiptune</span>
        </div>
        <div
          className="mt-2"
          style={{ height: 3, background: `linear-gradient(90deg, ${TK.violet}, ${TK.cyan}, ${TK.magenta})` }}
        />

        {/* metadata grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 mt-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>Song Name</span>
              <div className={barCls} style={{ ...barStyle, flex: 1 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputInBar} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>File Name</span>
              <div className={barCls} style={{ ...barStyle, flex: 1 }}>
                {loadedPattern ? `${loadedPattern}.chip` : "demo / unsaved"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>System</span>
              <div className={barCls} style={{ ...barStyle, flex: 1 }}>
                <select
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  className="w-full bg-transparent outline-none text-xs"
                  style={{ color: TK.fg }}
                >
                  <option value="file" style={{ color: "#000" }}>Pattern's own system</option>
                  <option value="all" style={{ color: "#000" }}>All systems (A/B)</option>
                  {systems.map((s) => (
                    <option key={s.name} value={s.name} style={{ color: "#000" }}>
                      {s.name} - {s.voices} voices
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>Transpose</span>
              <div className={barCls} style={{ ...barStyle, flex: 1 }}>
                <input
                  type="number"
                  value={transpose}
                  onChange={(e) => setTranspose(parseInt(e.target.value) || 0)}
                  className={inputInBar}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>Sample</span>
              <div className={barCls} style={{ ...barStyle, flex: 1 }}>
                01 - {effSystem?.label ?? effSystemName}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>Tempo</span>
              <div className={barCls} style={{ ...barStyle, flex: 1 }}>
                <input
                  type="number"
                  value={tempo}
                  onChange={(e) => setTempo(e.target.value)}
                  placeholder={String(model?.tempo ?? 125)}
                  className={inputInBar}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>Speed</span>
              <div className={barCls} style={{ ...barStyle, flex: 1 }}>006 - 16th rows</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 74 }}>Keys</span>
              <div className={barCls} style={{ ...barStyle, flex: 1, color: TK.dim }}>
                F2..Editor&nbsp; F5..Play&nbsp; Space..Play/Stop
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 52 }}>Master</span>
              {segBar(masterLevel, 28)}
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls} style={{ color: TK.dim, width: 52 }}>State</span>
              <div className={barCls} style={{ ...barStyle, flex: 1, color: playing ? TK.cyan : TK.dim }}>
                {playing ? "PLAYING" : "STOPPED"}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={togglePlay}
                disabled={!model}
                className="flex items-center gap-2 px-3 py-1 text-xs uppercase tracking-widest disabled:opacity-40"
                style={{ background: TK.violetDeep, color: TK.fg, border: `1px solid ${TK.violet}` }}
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
                {playing ? "Stop (F5)" : "Play (F5)"}
              </button>
              <button
                onClick={() => {
                  void submit(true);
                }}
                disabled={!!busy || !pattern.trim()}
                className="flex items-center gap-2 px-3 py-1 text-xs uppercase tracking-widest disabled:opacity-40"
                style={{ background: TK.panel, color: TK.fg, border: `1px solid ${TK.faint}` }}
              >
                <Eye size={13} />
                {busy === "preview" ? "Rolling..." : "Preview Roll"}
              </button>
              <button
                onClick={() => {
                  void submit(false);
                }}
                disabled={!!busy || !pattern.trim()}
                className="flex items-center gap-2 px-3 py-1 text-xs uppercase tracking-widest disabled:opacity-40"
                style={{ background: TK.panel, color: TK.cyan, border: `1px solid ${TK.violet}` }}
              >
                <Music size={13} />
                {busy === "render" ? "Rendering..." : "Render Audio"}
              </button>
            </div>
            {error && (
              <div className="text-[11px] px-2 py-1" style={{ background: "#3A1626", color: "#F3A8C6", border: `1px solid ${TK.magenta}` }}>
                {error}
              </div>
            )}
          </div>
        </div>

        {/* status line */}
        <div
          className="flex flex-wrap justify-between gap-2 mt-3 py-1 text-[11px] uppercase tracking-wider"
          style={{ borderTop: `1px solid ${TK.violet}`, borderBottom: `1px solid ${TK.violet}`, color: TK.dim }}
        >
          <span>
            Loop: <b style={{ color: TK.fg }}>1</b>,&nbsp; Order:{" "}
            <b style={{ color: TK.fg }}>{model ? `${cursor.orderIdx}/${model.order.length - 1}` : "-"}</b>,&nbsp; Pattern:{" "}
            <b style={{ color: TK.cyan }}>{cursor.patName || "-"}</b>,&nbsp; Row:{" "}
            <b style={{ color: TK.fg }}>{cursor.rowsInPat ? `${cursor.row}/${cursor.rowsInPat - 1}` : "-"}</b>,&nbsp;{" "}
            {model?.partNames.length ?? 0} Channels
          </span>
          <span>
            Time <b style={{ color: TK.fg }}>{fmtTime(curSeconds)}</b> / {fmtTime(songSeconds)}
          </span>
        </div>

        <div className="text-center text-xs tracking-[0.25em] uppercase mt-2" style={{ color: TK.dim }}>
          Info Page (F5)
        </div>

        {/* three panels */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr_1fr] gap-2 mt-2">
          {/* channel VUs */}
          <div style={{ background: TK.panel, border: `1px solid ${TK.faint}` }} className="p-2 space-y-[6px]">
            {model?.partNames.map((part, i) => (
              <div key={part} className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: TK.cyan, width: 20 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[10px] uppercase" style={{ color: TK.dim, width: 52 }}>
                  {part}
                </span>
                {segBar(levels[i] ?? 0)}
              </div>
            ))}
            {!model && <div className="text-[11px]" style={{ color: TK.dim }}>-</div>}
          </div>

          {/* song message */}
          <div style={{ background: TK.panel, border: `1px solid ${TK.faint}` }} className="p-2">
            {msgLines.map(([num, text]) => (
              <div key={num} className="text-[11px] leading-[1.5] whitespace-nowrap overflow-hidden">
                <span style={{ color: TK.cyan }}>{num}:</span>{" "}
                <span style={{ color: TK.fg }}>{text}</span>
              </div>
            ))}
          </div>

          {/* note-dot scope (first two parts' pitches in the current pattern) */}
          <div style={{ background: TK.panel, border: `1px solid ${TK.faint}` }} className="p-2">
            {curPattern ? (
              <svg viewBox="0 0 64 40" className="w-full h-full min-h-[104px]" preserveAspectRatio="none">
                {curPattern.rows.map((cells, r) =>
                  cells.slice(0, 2).map((token, partIdx) => {
                    const midi = noteMidi(token);
                    if (midi === null) return null;
                    const y = 38 - Math.min(36, Math.max(0, midi - 36));
                    const isCur = r === cursor.row;
                    return (
                      <rect
                        key={`${r}-${partIdx}`}
                        x={r * (64 / curPattern.rows.length)}
                        y={y}
                        width={isCur ? 2.4 : 1.6}
                        height={isCur ? 2.4 : 1.6}
                        fill={isCur ? TK.magenta : partIdx === 0 ? TK.cyan : TK.violet}
                      />
                    );
                  }),
                )}
              </svg>
            ) : (
              <div className="text-[11px]" style={{ color: TK.dim }}>-</div>
            )}
          </div>
        </div>

        <div className="flex gap-6 mt-2 text-[11px] uppercase tracking-wider" style={{ color: TK.dim }}>
          <span>
            Active Channels: <b style={{ color: TK.fg }}>{activeChannels} ({model?.partNames.length ?? 0})</b>
          </span>
          <span>
            Global Volume: <b style={{ color: TK.fg }}>128</b>
          </span>
        </div>

        {/* condensed pattern grid */}
        <div
          className="mt-2 overflow-y-auto"
          style={{ background: TK.panel, border: `1px solid ${TK.faint}`, maxHeight: 320 }}
        >
          {curPattern && model ? (
            <table className="w-full border-collapse" style={{ fontFamily: MONO }}>
              <thead>
                <tr>
                  <th className="text-left text-[10px] px-2 py-1 sticky top-0" style={{ background: TK.base, color: TK.dim }}>
                    ROW
                  </th>
                  {model.partNames.map((p) => (
                    <th key={p} className="text-left text-[10px] px-2 py-1 sticky top-0 uppercase" style={{ background: TK.base, color: TK.cyan }}>
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {curPattern.rows.map((cells, r) => {
                  const isCur = r === cursor.row;
                  return (
                    <tr
                      key={r}
                      id={`chip-row-${r}`}
                      style={{
                        background: isCur ? TK.violetDeep : "transparent",
                        borderLeft: isCur ? `3px solid ${TK.magenta}` : "3px solid transparent",
                      }}
                    >
                      <td className="text-[10px] px-2 py-[1px]" style={{ color: isCur ? TK.fg : TK.dim }}>
                        {String(r).padStart(3, "0")}
                      </td>
                      {cells.map((token, ci) => (
                        <td
                          key={ci}
                          className="text-[10px] px-2 py-[1px] whitespace-nowrap"
                          style={{
                            color: isOnset(token)
                              ? isCur
                                ? "#FFFFFF"
                                : TK.cyan
                              : token === "-"
                                ? "#6E5AA8"
                                : TK.faint,
                          }}
                        >
                          {token === "." ? "..." : token}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-[11px] p-2" style={{ color: TK.dim }}>No pattern parsed - check the editor below.</div>
          )}
        </div>
      </div>

      {/* ============ PATTERN EDITOR (F2) + library ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card title="Pattern Editor (.chip) - F2" icon={<Music size={18} />}>
          <div className="flex gap-2 mb-2">
            <select
              value={loadedPattern}
              onChange={(e) => {
                void loadPattern(e.target.value);
              }}
              className={`${DS.input} border border-gray-600 flex-1`}
            >
              <option value="">- saved patterns -</option>
              {patterns.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="save as"
              className={`${DS.input} border border-gray-600 w-32`}
            />
            <button
              onClick={() => {
                void savePattern();
              }}
              className={DS.btnSecondary}
              title="Save pattern"
            >
              <Save size={14} />
            </button>
            {loadedPattern && (
              <button
                onClick={() => {
                  void deletePattern();
                }}
                className={DS.btnSecondary}
                title="Delete pattern"
              >
                <Trash2 size={14} />
              </button>
            )}
            <label className={DS.btnSecondary} title="Import .mid -> .chip">
              <FileMusic size={14} />
              <input
                type="file"
                accept=".mid,.midi"
                className="hidden"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importMidi(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <textarea
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            rows={18}
            className={`${DS.textarea} border border-gray-600 font-mono text-xs`}
            placeholder={"system nes\ntempo 150\nlead: C-4 . E-4 . G-4 ..."}
          />
        </Card>

        <div className="space-y-4">
          {rolls.length > 0 && (
            <Card title="Piano Roll (preview first)" icon={<Eye size={18} />}>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {rolls.map((r) => (
                  <div key={r.system}>
                    <div className="text-xs text-muted mb-1 flex items-center gap-2">
                      <StatusBadge status="online" />
                      {r.system}
                    </div>
                    <img src={r.url} alt={`roll ${r.system}`} className="w-full rounded border border-gray-700" />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {takes.length > 0 && (
            <Card title="Renders" icon={<Music size={18} />}>
              <div className="space-y-3">
                {takes.map((t, i) => (
                  <div key={t.system}>
                    <div className="text-xs text-muted mb-1">{t.system}</div>
                    <audio
                      controls
                      loop
                      src={t.url}
                      className="w-full"
                      ref={i === 0 ? audioRef : undefined}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {rolls.length === 0 && takes.length === 0 && (
            <Card title="Preview & Renders" icon={<Eye size={18} />}>
              <p className="text-xs text-muted leading-relaxed">
                The Info Page above is the silent preview: press Play (F5) to watch the
                pattern run before any audio exists. Preview Roll renders the piano-roll
                image, Render Audio renders the WAV - both appear here, and a rendered
                take becomes the transport's master clock while it plays.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
