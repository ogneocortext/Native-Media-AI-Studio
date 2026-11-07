/**
 * Data Management — dashboard for saved prompts, visuals, sessions, tracks,
 * saved scenes, prompt history, and preferences overview.
 *
 * Each tab loads independently so one endpoint failure never blanks the page.
 * Empty states use the shared EmptySection with actions and descriptions.
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptySection, ConfirmDialog, Card } from "../../components/common";
import {
  RefreshCw,
  FileText,
  Activity,
  Image,
  Music,
  Box,
  Settings,
  Plus,
  Play,
  ArrowRight,
  Upload,
  Trash2,
  Copy,
  Star,
  Edit3,
  AlertCircle,
} from "lucide-react";
import { formatBytes, formatDate } from "../../utils/format";
import {
  getPrompts,
  getAIVisuals,
  getSessions,
  fetchTracks,
  listSavedScenes,
  getPromptHistory,
  getPreferences,
  deletePrompt,
  togglePromptFavorite,
  deletePromptVersion,
  type StoredPrompt,
  type AIVisualRecord,
  type GenerationSession,
  type APITrack,
  type PromptHistoryEntry,
} from "../../services/api/data";

type TabKey = "prompts" | "visuals" | "sessions" | "tracks" | "scenes" | "history" | "preferences";

interface TabState {
  data: unknown;
  error: string | null;
  loading: boolean;
  loaded: boolean;
}

export function DataManagementPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>("prompts");
  const [tabStates, setTabStates] = useState<Record<TabKey, TabState>>({
    prompts: { data: null, error: null, loading: true, loaded: false },
    visuals: { data: null, error: null, loading: true, loaded: false },
    sessions: { data: null, error: null, loading: true, loaded: false },
    tracks: { data: null, error: null, loading: true, loaded: false },
    scenes: { data: null, error: null, loading: true, loaded: false },
    history: { data: null, error: null, loading: true, loaded: false },
    preferences: { data: null, error: null, loading: true, loaded: false },
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{
    tab: TabKey;
    id: string;
    label: string;
    onConfirm: () => void;
  } | null>(null);

  const loadTab = useCallback(async (tab: TabKey) => {
    setTabStates((prev) => ({ ...prev, [tab]: { ...prev[tab], loading: true, error: null } }));
    try {
      let data: unknown;
      switch (tab) {
        case "prompts":
          data = await getPrompts();
          break;
        case "visuals":
          data = await getAIVisuals();
          break;
        case "sessions":
          data = await getSessions();
          break;
        case "tracks":
          data = await fetchTracks();
          break;
        case "scenes": {
          const scenesData = await listSavedScenes();
          data = scenesData.scenes || [];
          break;
        }
        case "history":
          data = await getPromptHistory();
          break;
        case "preferences":
          data = await getPreferences();
          break;
      }
      setTabStates((prev) => ({
        ...prev,
        [tab]: { data, error: null, loading: false, loaded: true },
      }));
    } catch (e) {
      setTabStates((prev) => ({
        ...prev,
        [tab]: {
          data: null,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
          loaded: true,
        },
      }));
    }
  }, []);

  useEffect(() => {
    Object.keys(tabStates).forEach((key) => {
      const tab = key;
      if (!tabStates[tab].loaded && !tabStates[tab].loading) {
        void loadTab(tab);
      }
    });
  }, []);

  const reloadTab = useCallback(
    (tab: TabKey) => {
      void loadTab(tab);
    },
    [loadTab],
  );

  const prompts = (tabStates.prompts.data as StoredPrompt[]) ?? [];
  const visuals = (tabStates.visuals.data as AIVisualRecord[]) ?? [];
  const sessions = (tabStates.sessions.data as GenerationSession[]) ?? [];
  const tracks = (tabStates.tracks.data as APITrack[]) ?? [];
  const scenes = ((tabStates.scenes.data as {
    filename: string;
    path: string;
    size: number;
    modified: string;
  }[]) ?? []) as { filename: string; path: string; size: number; modified: string }[];
  const history = (tabStates.history.data as PromptHistoryEntry[]) ?? [];
  const preferences = (tabStates.preferences.data as Record<string, unknown>) ?? {};

  const handleDelete = (tab: TabKey, id: string, label: string, onConfirm: () => void) => {
    setDeleteConfirm({ tab, id, label, onConfirm });
  };

  const toggleFavorite = async (id: string) => {
    try {
      const result = await togglePromptFavorite(id);
      if (!result) {
        reloadTab("prompts");
      }
    } catch {
      reloadTab("prompts");
    }
  };

  const truncate = (t: string, n = 60) => (t.length > n ? `${t.substring(0, n)}...` : t);

  const tabItems = [
    { id: "prompts", title: `Prompts (${prompts.length})` },
    { id: "visuals", title: `Visuals (${visuals.length})` },
    { id: "sessions", title: `Sessions (${sessions.length})` },
    { id: "tracks", title: `Tracks (${tracks.length})` },
    { id: "scenes", title: `Saved Scenes (${scenes.length})` },
    { id: "history", title: `Prompt History (${history.length})` },
    { id: "preferences", title: `Preferences` },
  ];

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="text-accent" size={24} />
            Data Management
          </h1>
          <p className="text-muted mt-1">
            Saved prompts, generated visuals, sessions, tracks and scenes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              Object.keys(tabStates).forEach((key) => reloadTab(key));
            }}
            disabled={Object.values(tabStates).some((s) => s.loading)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {Object.values(tabStates).some((s) => s.loading) ? (
              <RefreshCw size={14} className="animate-spin mr-1" />
            ) : (
              <Activity size={14} className="mr-1" />
            )}
            {Object.values(tabStates).some((s) => s.loading) ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {tabStates[activeTab].error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5" />
            <div className="text-sm text-red-300">
              {tabStates[activeTab].error}
              <button
                onClick={() => reloadTab(activeTab)}
                className="ml-2 text-xs text-red-400 underline underline-offset-4 hover:text-red-300"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <div
          role="tablist"
          aria-label="Data management sections"
          className="flex flex-wrap gap-1 border-b border-border/60 mb-4"
        >
          {tabItems.map((t) => {
            const state = tabStates[t.id as TabKey];
            const isLoading = state.loading && !state.loaded;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                aria-busy={isLoading}
                disabled={isLoading}
                onClick={() => setActiveTab(t.id as TabKey)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  activeTab === t.id
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-white"
                }`}
              >
                {isLoading ? (
                  <span className="flex items-center gap-1">
                    <RefreshCw size={12} className="animate-spin" />
                    {t.title}
                  </span>
                ) : (
                  t.title
                )}
              </button>
            );
          })}
        </div>
        {activeTab === "prompts" &&
          (prompts.length === 0 ? (
            <EmptySection
              icon={<FileText />}
              title="No prompts found"
              description="Save prompts from the Music Video Wizard to see them here."
              action={{
                label: "Create prompt",
                onClick: async () => navigate("/music-video-wizard"),
                icon: <Plus size={14} />,
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Name</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Type</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Category</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Uses</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Favorite</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Last Used</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Created</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left text-right!">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {prompts.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 border-b border-border/40 align-top">
                        <div className="font-medium">{p.name}</div>
                        {p.description && (
                          <div className="text-xs text-muted">{truncate(p.description, 80)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{p.prompt_type}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{p.category}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{p.use_count}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleFavorite(p.id);
                          }}
                          className="p-1 hover:bg-gray-700 rounded"
                          title={p.is_favorite ? "Unfavorite" : "Favorite"}
                        >
                          <Star
                            size={14}
                            className={`
                                  ${
                                    p.is_favorite
                                      ? "text-yellow-400 fill-yellow-400"
                                      : "text-gray-500"
                                  }
                                `}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatDate(p.last_used_at ?? p.created_at)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatDate(p.created_at)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top text-right">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void navigate(`/music-video-wizard?prompt=${p.id}`);
                            }}
                            className="p-1.5 hover:bg-gray-700 rounded text-xs"
                            title="Use in wizard"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete("prompts", p.id, p.name, () => {
                                void deletePrompt(p.id).then(() => {
                                  reloadTab("prompts");
                                });
                              });
                            }}
                            className="p-1.5 hover:bg-red-500/20 text-red-400 rounded text-xs"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {activeTab === "visuals" &&
          (visuals.length === 0 ? (
            <EmptySection
              icon={<Image />}
              title="No AI visuals found"
              description="Generate visuals from the Image Generation page to see them here."
              action={{
                label: "Generate visual",
                onClick: async () => navigate("/image-generation"),
                icon: <Play size={14} />,
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Filename</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Checkpoint</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Style</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Size</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Steps/CFG</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Favorite</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {visuals.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(v.filename)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(v.checkpoint)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{v.style_id}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">
                        {v.width}×{v.height}
                      </td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">
                        {v.steps}/{v.cfg}
                      </td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{v.is_favorite ? "★" : "☆"}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatDate(v.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {activeTab === "sessions" &&
          (sessions.length === 0 ? (
            <EmptySection
              icon={<Activity />}
              title="No sessions found"
              description="Generation sessions appear here after you start a music video or AI generation job."
              action={{
                label: "Create session",
                onClick: async () => navigate("/music-video-wizard"),
                icon: <Plus size={14} />,
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">ID</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Status</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Frames</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Time</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Created</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(s.id, 20)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{s.status}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">
                        {s.generated_frames}/{s.total_frames}
                      </td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{s.actual_time_seconds || s.estimated_time_seconds}s</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatDate(s.created_at)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatDate(s.completed_at ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {activeTab === "tracks" &&
          (tracks.length === 0 ? (
            <EmptySection
              icon={<Music />}
              title="No tracks found"
              description="Upload audio tracks from the Audio Analysis page to see them here."
              action={{
                label: "Upload track",
                onClick: async () => navigate("/audio-analysis"),
                icon: <Upload size={14} />,
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Filename</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Artist/Title</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Duration</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Size</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Visual Style</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(t.filename, 30)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-muted">{t.artist}</div>
                      </td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">
                        {t.duration_seconds
                          ? `${Math.floor(t.duration_seconds / 60)}:${String(t.duration_seconds % 60).padStart(2, "0")}`
                          : "-"}
                      </td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{t.size_mb ? `${t.size_mb.toFixed(1)} MB` : "-"}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(t.visual_style, 40)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {activeTab === "scenes" &&
          (scenes.length === 0 ? (
            <EmptySection
              icon={<Box />}
              title="No saved scenes found"
              description="Save 3D scenes from Three.js Studio to see them here."
              action={{
                label: "Create scene",
                onClick: async () => navigate("/three-js-studio"),
                icon: <Plus size={14} />,
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Filename</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Path</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Size</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {scenes.map((s) => (
                    <tr key={s.path}>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(s.filename, 40)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(s.path, 60)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatBytes(s.size)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatDate(s.modified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {activeTab === "history" &&
          (history.length === 0 ? (
            <EmptySection
              icon={<FileText />}
              title="No prompt history found"
              description="Prompt versions and repair history appear here as you work in the Music Video Wizard."
              action={{
                label: "Start generating",
                onClick: async () => navigate("/music-video-wizard"),
                icon: <ArrowRight size={14} />,
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Track</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Section</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Prompt</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Action</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Outcome</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Created</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left text-right!">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(h.track_filename, 30)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{h.section}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{truncate(h.prompt, 60)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{h.action}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{h.outcome}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top">{formatDate(h.created_at)}</td>
                      <td className="px-3 py-2 border-b border-border/40 align-top text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(
                              "history",
                              h.id,
                              `Prompt version "${truncate(h.prompt, 30)}"`,
                              () => {
                                void deletePromptVersion(h.id).then(() => {
                                  reloadTab("history");
                                });
                              },
                            );
                          }}
                          className="p-1.5 hover:bg-red-500/20 text-red-400 rounded text-xs"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {activeTab === "preferences" &&
          (Object.keys(preferences).length === 0 ? (
            <EmptySection
              icon={<Settings />}
              title="No preferences found"
              description="Application preferences appear here after you configure settings."
              action={{
                label: "Open Settings",
                onClick: async () => navigate("/settings"),
                icon: <Settings size={14} />,
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Key</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Category</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left">Value</th>
                    <th className="px-3 py-2 font-medium text-muted border-b border-border/60 text-left text-right!">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(preferences).map(([key, value]) => {
                    const val = value as Record<string, unknown>;
                    const valueStr = JSON.stringify(val.value ?? value);
                    return (
                      <tr key={key}>
                        <td className="px-3 py-2 border-b border-border/40 align-top">{key}</td>
                        <td className="px-3 py-2 border-b border-border/40 align-top">{typeof val.category === "string" ? val.category : "general"}</td>
                        <td className="px-3 py-2 border-b border-border/40 align-top max-w-xs truncate" title={valueStr}>
                          {truncate(valueStr, 80)}
                        </td>
                        <td className="px-3 py-2 border-b border-border/40 align-top text-right">
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(valueStr);
                            }}
                            className="p-1.5 hover:bg-gray-700 rounded text-xs"
                            title="Copy value"
                          >
                            <Copy size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
      </Card>

      <div className="mt-4 text-xs text-muted">
        Read-only view of saved entities. File sizes, schema state and maintenance operations live
        on the{" "}
        <Link to="/database" className="text-accent hover:underline">
          Database
        </Link>{" "}
        page.
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          title={`Delete "${deleteConfirm.label}"?`}
          description="This action cannot be undone."
          onConfirm={deleteConfirm.onConfirm}
          onCancel={() => setDeleteConfirm(null)}
          confirmLabel="Delete"
          confirmVariant="destructive"
        />
      )}
    </div>
  );
}
