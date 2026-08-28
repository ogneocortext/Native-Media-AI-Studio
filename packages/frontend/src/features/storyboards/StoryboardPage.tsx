import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, FileText, Search, ChevronRight, Box, Sparkles,
  Music, Clock, Zap, Layers, Quote,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchUniqueTracksFromAPI, type TrackLyricsData } from "../../services/trackLyrics";

interface StoryboardFile {
  name: string;
  path: string;
  title: string;
  track?: string;
  trackFile?: string;
  bpm?: number;
  duration?: number;
}

const STORYBOARDS: StoryboardFile[] = [
  { name: "take-the-crown", path: "/docs/STORYBOARD_TakeTheCrown.md", title: "Take the Crown", track: "Take the Crown", trackFile: "NeoCortext - Take the Crown.mp3", bpm: 152, duration: 124 },
  { name: "still-i-rise", path: "/docs/STORYBOARD_StillIRise.md", title: "Still I Rise", track: "Still I Rise", trackFile: "NeoCortext - Still I Rise.mp3", bpm: 130, duration: 180 },
];

interface SceneData {
  seq: string;
  section: string;
  timecode: string;
  duration: string;
  lyric: string;
  visual: string;
  technique: string;
}

export function StoryboardPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<StoryboardFile | null>(null);
  const [content, setContent] = useState<string>("");
  const [query, setQuery] = useState("");
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"storyboards" | "tracks">("storyboards");
  const [selectedTrack, setSelectedTrack] = useState<TrackLyricsData | null>(null);
  const [trackLyricsData, setTrackLyricsData] = useState<TrackLyricsData[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);

  useEffect(() => {
    fetchUniqueTracksFromAPI()
      .then(setTrackLyricsData)
      .catch(() => setTrackLyricsData([]))
      .finally(() => setTracksLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetch(selected.path)
      .then((r) => r.text())
      .then((text) => {
        setContent(text);
        setScenes(parseScenes(text));
      })
      .catch(() => setContent("# Error\nFailed to load storyboard."));
  }, [selected]);

  const parseScenes = (md: string): SceneData[] => {
    const lines = md.split("\n");
    const result: SceneData[] = [];
    let inOverview = false;
    for (const line of lines) {
      if (line.includes("## Overview Map")) { inOverview = true; continue; }
      if (inOverview && line.startsWith("#")) { inOverview = false; continue; }
      if (!inOverview || !line.startsWith("|")) continue;
      if (line.includes("SEQ") || line.includes("---")) continue;
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 7) {
        result.push({ seq: cells[0], section: cells[1], timecode: cells[2], duration: cells[3], lyric: cells[4], visual: cells[5], technique: cells[6] });
      }
    }
    return result;
  };

  const handleOpenIn3DStudio = useCallback((storyboard: StoryboardFile) => {
    const params = new URLSearchParams();
    if (storyboard.trackFile) params.set("track", storyboard.trackFile);
    params.set("storyboard", storyboard.name);
    navigate(`/three-js-studio?${params.toString()}`);
  }, [navigate]);

  const handleGenerateScene = useCallback((storyboard: StoryboardFile, sceneIdx: number) => {
    const params = new URLSearchParams();
    if (storyboard.trackFile) params.set("track", storyboard.trackFile);
    params.set("storyboard", storyboard.name);
    params.set("scene", String(sceneIdx));
    params.set("autogenerate", "true");
    navigate(`/three-js-studio?${params.toString()}`);
  }, [navigate]);

  const renderInline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith("`")) {
        parts.push(<code key={key++} className="px-1.5 py-0.5 bg-gray-800 text-amber-300 rounded text-xs font-mono">{token.slice(1, -1)}</code>);
      } else if (token.startsWith("**")) {
        parts.push(<strong key={key++} className="font-semibold text-white">{token.slice(2, -2)}</strong>);
      } else {
        parts.push(<em key={key++} className="text-gray-400 italic">{token.slice(1, -1)}</em>);
      }
      lastIndex = match.index + token.length;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts;
  };

  const renderMarkdown = (md: string) => {
    const lines = md.split("\n");
    const elements: React.ReactElement[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let tableHeaders: string[] = [];

    const flushTable = () => {
      if (tableHeaders.length === 0) return;
      elements.push(
        <div key={`table-${elements.length}`} className="overflow-x-auto rounded-xl border border-gray-700/60 mb-2 shadow-lg shadow-black/20">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-800">
                {tableHeaders.map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-[11px] font-bold text-purple-300 uppercase tracking-wider whitespace-nowrap bg-gray-800">{h.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri} className={`border-t border-gray-700/40 transition-colors ${ri % 2 === 0 ? "bg-gray-900/20" : "bg-gray-900/5"} hover:bg-purple-900/15`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-gray-300 text-xs leading-relaxed max-w-[280px]">
                      <div className="line-clamp-3">{renderInline(cell.trim())}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      tableHeaders = [];
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("|")) {
        const cells = line.split("|").filter((c) => c.trim() !== "");
        if (line.includes("---")) { inTable = true; tableHeaders = cells; continue; }
        if (inTable) { tableRows.push(cells); continue; }
      } else if (inTable) { flushTable(); }

      if (line.startsWith("# ")) elements.push(<h1 key={i} className="text-2xl font-bold text-white mt-6 mb-3">{renderInline(line.slice(2))}</h1>);
      else if (line.startsWith("## ")) elements.push(<h2 key={i} className="text-xl font-semibold text-purple-300 mt-8 mb-3 flex items-center gap-2 pb-2 border-b border-gray-800"><Layers size={18} />{renderInline(line.slice(3))}</h2>);
      else if (line.startsWith("### ")) elements.push(<h3 key={i} className="text-lg font-medium text-gray-200 mt-5 mb-2">{renderInline(line.slice(4))}</h3>);
      else if (line.startsWith("> ")) elements.push(<blockquote key={i} className="border-l-4 border-purple-500/70 pl-4 py-3 my-4 text-gray-400 italic bg-purple-900/10 rounded-r-lg shadow-sm"><span className="text-purple-400 mr-1">"</span>{renderInline(line.slice(2))}<span className="text-purple-400 ml-1">"</span></blockquote>);
      else if (line.startsWith("- ") || line.startsWith("* ")) elements.push(<li key={i} className="ml-4 text-gray-300 list-disc leading-relaxed">{renderInline(line.slice(2))}</li>);
      else if (line.trim() === "---") elements.push(<hr key={i} className="border-gray-700/50 my-5" />);
      else if (line.trim() === "") elements.push(<div key={i} className="h-2" />);
      else elements.push(<p key={i} className="text-gray-300 leading-relaxed">{renderInline(line)}</p>);
    }
    flushTable();
    return elements;
  };

  const filtered = STORYBOARDS.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    s.track?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-[#12121a] border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <BookOpen size={24} className="text-purple-400" />
          <h1 className="text-xl font-bold">Storyboards</h1>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{STORYBOARDS.length} boards</span>
          <span className="text-xs text-purple-400 bg-purple-900/30 px-2 py-0.5 rounded">{trackLyricsData.length} tracks</span>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1 mt-3">
          <button
            onClick={() => setActiveTab("storyboards")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === "storyboards" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            <span className="flex items-center gap-1.5"><BookOpen size={12} /> Storyboards</span>
          </button>
          <button
            onClick={() => setActiveTab("tracks")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === "tracks" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            <span className="flex items-center gap-1.5"><Music size={12} /> Track Prompts & Lyrics</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "tracks" ? (
          <TracksTab
            tracks={trackLyricsData}
            loading={tracksLoading}
            selectedTrack={selectedTrack}
            onSelectTrack={setSelectedTrack}
            onGenerateScene={(track) => {
              const params = new URLSearchParams();
              params.set("track", track.trackName);
              params.set("autogenerate", "true");
              navigate(`/three-js-studio?${params.toString()}`);
            }}
          />
        ) : selected ? (
          <StoryboardDetail
            storyboard={selected}
            content={content}
            scenes={scenes}
            activeScene={activeScene}
            onSelectScene={setActiveScene}
            onBack={() => { setSelected(null); setContent(""); setScenes([]); setActiveScene(null); }}
            onOpen3D={() => handleOpenIn3DStudio(selected)}
            onGenerateScene={(idx) => handleGenerateScene(selected, idx)}
            renderMarkdown={renderMarkdown}
          />
        ) : (
          <StoryboardGrid
            storyboards={filtered}
            query={query}
            onSearch={setQuery}
            onSelect={setSelected}
            onOpen3D={handleOpenIn3DStudio}
            onGenerate={handleGenerateScene}
          />
        )}
      </div>
    </div>
  );
}

/* ============ Sub-components ============ */

function TracksTab({ tracks, loading, selectedTrack, onSelectTrack, onGenerateScene }: {
  tracks: TrackLyricsData[];
  loading: boolean;
  selectedTrack: TrackLyricsData | null;
  onSelectTrack: (t: TrackLyricsData) => void;
  onGenerateScene: (t: TrackLyricsData) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((track: TrackLyricsData) => {
    const text = `${track.prompt}\n\n${track.lyrics}`;
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
    navigator.clipboard.writeText(text).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    });
  }, []);
  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-80 bg-[#0e0e16] border-r border-gray-800 overflow-y-auto shrink-0">
        <div className="p-3 border-b border-gray-800">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tracks ({tracks.length})</h3>
        </div>
        {loading ? (
          <div className="p-4 text-center text-gray-500 text-sm">Loading tracks...</div>
        ) : tracks.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">No tracks found</div>
        ) : (
          tracks.map((track) => (
          <button
            key={track.id}
            onClick={() => onSelectTrack(track)}
            className={`w-full text-left px-3 py-3 border-b border-gray-800/50 transition-colors ${
              selectedTrack?.id === track.id ? "bg-purple-900/20 border-l-2 border-l-purple-500" : "hover:bg-gray-800/40"
            }`}
          >
            <div className="text-sm font-medium text-gray-200 truncate">{track.trackName}</div>
            <div className="text-[10px] text-gray-500 truncate mt-0.5">{track.prompt.slice(0, 60)}...</div>
          </button>
        )))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {selectedTrack ? (
          <div className="p-6 max-w-3xl">
            <h2 className="text-xl font-bold text-white mb-4">{selectedTrack.trackName}</h2>
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-purple-300 mb-2 flex items-center gap-2"><Sparkles size={14} /> Generation Prompt</h3>
              <div className="bg-[#12121a] border border-gray-800 rounded-lg p-4">
                <p className="text-sm text-gray-300 leading-relaxed">{selectedTrack.prompt}</p>
              </div>
            </div>
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-purple-300 mb-2 flex items-center gap-2"><Quote size={14} /> Lyrics / Theme</h3>
              <div className="bg-[#12121a] border border-gray-800 rounded-lg p-4">
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{selectedTrack.lyrics}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onGenerateScene(selectedTrack)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-medium flex items-center gap-1.5"
              >
                <Box size={14} /> Generate 3D Scene
              </button>
              <button
                onClick={() => handleCopy(selectedTrack)}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${copied ? "bg-emerald-600 text-white" : "bg-gray-800 hover:bg-gray-700"}`}
              >
                {copied ? "✓ Copied!" : "Copy Prompt + Lyrics"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">Select a track to view its prompt and lyrics</div>
        )}
      </div>
    </div>
  );
}

function StoryboardGrid({ storyboards, query, onSearch, onSelect, onOpen3D, onGenerate }: {
  storyboards: StoryboardFile[];
  query: string;
  onSearch: (q: string) => void;
  onSelect: (s: StoryboardFile) => void;
  onOpen3D: (s: StoryboardFile) => void;
  onGenerate: (s: StoryboardFile, idx: number) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 relative">
        <input
          type="text"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by title or track..."
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pl-9 text-sm text-white placeholder-gray-500 w-64 focus:outline-none focus:border-purple-500"
        />
        <Search size={16} className="absolute left-3 top-2 text-gray-500" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {storyboards.map((s) => (
          <div key={s.name} className="bg-[#12121a] border border-gray-800 rounded-xl p-5 hover:border-purple-500/50 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-900/30 flex items-center justify-center"><FileText size={20} className="text-purple-400" /></div>
                <div>
                  <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">{s.title}</h3>
                  {s.track && <p className="text-xs text-gray-500 flex items-center gap-1"><Music size={10} />{s.track}</p>}
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-600 group-hover:text-purple-400 transition-colors" />
            </div>
            <div className="flex items-center gap-4 mb-4 text-xs text-gray-400">
              {s.bpm && <span className="flex items-center gap-1"><Zap size={10} className="text-amber-400" />{s.bpm} BPM</span>}
              {s.duration && <span className="flex items-center gap-1"><Clock size={10} />{s.duration}s</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onSelect(s)} className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"><BookOpen size={12} /> View Board</button>
              <button onClick={() => onOpen3D(s)} className="flex-1 px-3 py-2 bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"><Box size={12} /> 3D Studio</button>
              <button onClick={() => onGenerate(s, 0)} className="flex-1 px-3 py-2 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-300 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"><Sparkles size={12} /> Generate</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryboardDetail({ storyboard, content, scenes, activeScene, onSelectScene, onBack, onOpen3D, onGenerateScene, renderMarkdown }: {
  storyboard: StoryboardFile;
  content: string;
  scenes: SceneData[];
  activeScene: number | null;
  onSelectScene: (idx: number | null) => void;
  onBack: () => void;
  onOpen3D: () => void;
  onGenerateScene: (idx: number) => void;
  renderMarkdown: (md: string) => React.ReactElement[];
}) {
  const visualPreview = (visual: string) => visual.length <= 60 ? visual : visual.slice(0, 57) + "...";

  return (
    <div className="flex h-full overflow-hidden">
      {scenes.length > 0 && (
        <div className="w-72 bg-[#0e0e16] border-r border-gray-800 overflow-y-auto shrink-0">
          <div className="p-3 border-b border-gray-800">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Scenes</h3>
          </div>
          {scenes.map((scene, idx) => (
            <div
              key={idx}
              role="button"
              tabIndex={0}
              onClick={() => onSelectScene(activeScene === idx ? null : idx)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectScene(activeScene === idx ? null : idx); }}
              className={`w-full text-left px-3 py-2.5 border-b border-gray-800/50 transition-colors cursor-pointer ${
                activeScene === idx ? "bg-purple-900/20 border-l-2 border-l-purple-500" : "hover:bg-gray-800/40"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono text-purple-400">{scene.seq}</span>
                <span className="text-[10px] text-gray-500">{scene.duration}</span>
              </div>
              <div className="text-xs font-medium text-gray-200 truncate">{scene.section}</div>
              <div className="text-[10px] text-gray-500 truncate mt-0.5">{visualPreview(scene.visual)}</div>
              {activeScene === idx && (
                <div className="mt-2 pt-2 border-t border-gray-700/50">
                  <p className="text-[10px] text-gray-400 mb-2 line-clamp-2">{scene.visual}</p>
                  <div className="flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); onGenerateScene(idx); }} className="flex-1 px-2 py-1 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-300 rounded text-[10px] font-medium flex items-center justify-center gap-1"><Sparkles size={9} /> Gen Scene</button>
                    <button onClick={(e) => { e.stopPropagation(); onOpen3D(); }} className="flex-1 px-2 py-1 bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 rounded text-[10px] font-medium flex items-center justify-center gap-1"><Box size={9} /> 3D</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-sm">← Back</button>
            <div>
              <h2 className="font-semibold text-white">{storyboard.title}</h2>
              {storyboard.track && <p className="text-xs text-gray-500">{storyboard.track} • {storyboard.bpm} BPM • {storyboard.duration}s</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onOpen3D} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-medium flex items-center gap-1.5"><Box size={12} /> Open in 3D Studio</button>
            <button onClick={() => onGenerateScene(activeScene || 0)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-xs font-medium flex items-center gap-1.5"><Sparkles size={12} /> Generate Scene</button>
          </div>
        </div>
        <div className="p-6 max-w-4xl">
          <div className="bg-[#0d0d15] rounded-2xl border border-gray-800/60 p-6 shadow-xl shadow-black/20">
            {renderMarkdown(content)}
          </div>
        </div>
      </div>
    </div>
  );
}


