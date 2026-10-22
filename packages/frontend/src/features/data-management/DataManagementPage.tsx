/**
 * Data Management — dashboard for saved prompts, visuals, sessions, tracks,
 * saved scenes, prompt history, and preferences overview.
 *
 * Each tab loads independently so one endpoint failure never blanks the page.
 * Empty states use the shared EmptySection with actions and descriptions.
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Table, Button, Card } from "tabler-react";
import {
  EmptySection,
  ConfirmDialog,
} from "../../components/common";
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
      const tab = key as TabKey;
      if (!tabStates[tab].loaded && !tabStates[tab].loading) {
        loadTab(tab);
      }
    });
  }, []);

  const reloadTab = useCallback((tab: TabKey) => {
    loadTab(tab);
  }, [loadTab]);

  const prompts = (tabStates.prompts.data as StoredPrompt[] ?? []) as StoredPrompt[];
  const visuals = (tabStates.visuals.data as AIVisualRecord[] ?? []) as AIVisualRecord[];
  const sessions = (tabStates.sessions.data as GenerationSession[] ?? []) as GenerationSession[];
  const tracks = (tabStates.tracks.data as APITrack[] ?? []) as APITrack[];
  const scenes = (tabStates.scenes.data as Array<{ filename: string; path: string; size: number; modified: string }> ?? []) as Array<{ filename: string; path: string; size: number; modified: string }>;
  const history = (tabStates.history.data as PromptHistoryEntry[] ?? []) as PromptHistoryEntry[];
  const preferences = (tabStates.preferences.data as Record<string, unknown> ?? {}) as Record<string, unknown>;

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
          <Button
            color="primary"
            size="sm"
            onClick={() => {
              Object.keys(tabStates).forEach((key) =>
                reloadTab(key as TabKey),
              );
            }}
            disabled={Object.values(tabStates).some((s) => s.loading)}
          >
            {Object.values(tabStates).some((s) => s.loading) ? (
              <RefreshCw size={14} className="animate-spin mr-1" />
            ) : (
              <Activity size={14} className="mr-1" />
            )}
            {Object.values(tabStates).some((s) => s.loading)
              ? "Refreshing..."
              : "Refresh"}
          </Button>
        </div>
      </div>

      {tabStates[activeTab].error && (
        <Card className="mb-4 border-red-500/40 bg-red-500/10 p-3">
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
        </Card>
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
            {activeTab === "prompts" && (
              prompts.length === 0 ? (
                <EmptySection
                  icon={<FileText />}
                  title="No prompts found"
                  description="Save prompts from the Music Video Wizard to see them here."
                  action={{
                    label: "Create prompt",
                    onClick: () => navigate("/music-video-wizard"),
                    icon: <Plus size={14} />,
                  }}
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>Name</Table.ColHeader>
                        <Table.ColHeader>Type</Table.ColHeader>
                        <Table.ColHeader>Category</Table.ColHeader>
                        <Table.ColHeader>Uses</Table.ColHeader>
                        <Table.ColHeader>Favorite</Table.ColHeader>
                        <Table.ColHeader>Last Used</Table.ColHeader>
                        <Table.ColHeader>Created</Table.ColHeader>
                        <Table.ColHeader className="text-right">Actions</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {prompts.map((p) => (
                        <Table.Row key={p.id}>
                          <Table.Col>
                            <div className="font-medium">{p.name}</div>
                            {p.description && (
                              <div className="text-xs text-muted">
                                {truncate(p.description, 80)}
                              </div>
                            )}
                          </Table.Col>
                          <Table.Col>{p.prompt_type}</Table.Col>
                          <Table.Col>{p.category}</Table.Col>
                          <Table.Col>{p.use_count}</Table.Col>
                          <Table.Col>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(p.id);
                              }}
                              className="p-1 hover:bg-gray-700 rounded"
                              title={p.is_favorite ? "Unfavorite" : "Favorite"}
                            >
                              <Star
                                size={14}
                                className={`
                                  ${p.is_favorite
                                    ? "text-yellow-400 fill-yellow-400"
                                    : "text-gray-500"}
                                `}
                              />
                            </button>
                          </Table.Col>
                          <Table.Col>
                            {formatDate(p.last_used_at || p.created_at)}
                          </Table.Col>
                          <Table.Col>{formatDate(p.created_at)}</Table.Col>
                          <Table.Col className="text-right">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/music-video-wizard?prompt=${p.id}`);
                                }}
                                className="p-1.5 hover:bg-gray-700 rounded text-xs"
                                title="Use in wizard"
                              >
                                <Edit3 size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(
                                    "prompts",
                                    p.id,
                                    p.name,
                                    () => {
                                      deletePrompt(p.id).then(() => {
                                        reloadTab("prompts");
                                      });
                                    },
                                  );
                                }}
                                className="p-1.5 hover:bg-red-500/20 text-red-400 rounded text-xs"
                                title="Delete"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "visuals" && (
              visuals.length === 0 ? (
                <EmptySection
                icon={<Image />}
                title="No AI visuals found"
                description="Generate visuals from the Image Generation page to see them here."
                action={{
                  label: "Generate visual",
                  onClick: () => navigate("/image-generation"),
                  icon: <Play size={14} />,
                }}
              />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>Filename</Table.ColHeader>
                        <Table.ColHeader>Checkpoint</Table.ColHeader>
                        <Table.ColHeader>Style</Table.ColHeader>
                        <Table.ColHeader>Size</Table.ColHeader>
                        <Table.ColHeader>Steps/CFG</Table.ColHeader>
                        <Table.ColHeader>Favorite</Table.ColHeader>
                        <Table.ColHeader>Created</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {visuals.map((v) => (
                        <Table.Row key={v.id}>
                          <Table.Col>{truncate(v.filename)}</Table.Col>
                          <Table.Col>{truncate(v.checkpoint)}</Table.Col>
                          <Table.Col>{v.style_id}</Table.Col>
                          <Table.Col>
                            {v.width}×{v.height}
                          </Table.Col>
                          <Table.Col>
                            {v.steps}/{v.cfg}
                          </Table.Col>
                          <Table.Col>{v.is_favorite ? "★" : "☆"}</Table.Col>
                          <Table.Col>{formatDate(v.created_at)}</Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "sessions" && (
              sessions.length === 0 ? (
                <EmptySection
                icon={<Activity />}
                title="No sessions found"
                description="Generation sessions appear here after you start a music video or AI generation job."
                action={{
                  label: "Create session",
                  onClick: () => navigate("/music-video-wizard"),
                  icon: <Plus size={14} />,
                }}
              />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>ID</Table.ColHeader>
                        <Table.ColHeader>Status</Table.ColHeader>
                        <Table.ColHeader>Frames</Table.ColHeader>
                        <Table.ColHeader>Time</Table.ColHeader>
                        <Table.ColHeader>Created</Table.ColHeader>
                        <Table.ColHeader>Completed</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {sessions.map((s) => (
                        <Table.Row key={s.id}>
                          <Table.Col>{truncate(s.id, 20)}</Table.Col>
                          <Table.Col>{s.status}</Table.Col>
                          <Table.Col>
                            {s.generated_frames}/{s.total_frames}
                          </Table.Col>
                          <Table.Col>
                            {s.actual_time_seconds || s.estimated_time_seconds}s
                          </Table.Col>
                          <Table.Col>{formatDate(s.created_at)}</Table.Col>
                          <Table.Col>{formatDate(s.completed_at || "")}</Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "tracks" && (
              tracks.length === 0 ? (
                <EmptySection
                icon={<Music />}
                title="No tracks found"
                description="Upload audio tracks from the Audio Analysis page to see them here."
                action={{
                  label: "Upload track",
                  onClick: () => navigate("/audio-analysis"),
                  icon: <Upload size={14} />,
                }}
              />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>Filename</Table.ColHeader>
                        <Table.ColHeader>Artist/Title</Table.ColHeader>
                        <Table.ColHeader>Duration</Table.ColHeader>
                        <Table.ColHeader>Size</Table.ColHeader>
                        <Table.ColHeader>Visual Style</Table.ColHeader>
                        <Table.ColHeader>Status</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {tracks.map((t) => (
                        <Table.Row key={t.id}>
                          <Table.Col>{truncate(t.filename, 30)}</Table.Col>
                          <Table.Col>
                            <div className="font-medium">{t.title}</div>
                            <div className="text-xs text-muted">{t.artist}</div>
                          </Table.Col>
                          <Table.Col>
                            {t.duration_seconds ? `${Math.floor(t.duration_seconds / 60)}:${String(t.duration_seconds % 60).padStart(2, "0")}` : "-"}
                          </Table.Col>
                          <Table.Col>{t.size_mb ? `${t.size_mb.toFixed(1)} MB` : "-"}</Table.Col>
                          <Table.Col>{truncate(t.visual_style, 40)}</Table.Col>
                          <Table.Col>{t.status}</Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "scenes" && (
              scenes.length === 0 ? (
                <EmptySection
                icon={<Box />}
                title="No saved scenes found"
                description="Save 3D scenes from Three.js Studio to see them here."
                action={{
                  label: "Create scene",
                  onClick: () => navigate("/three-js-studio"),
                  icon: <Plus size={14} />,
                }}
              />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>Filename</Table.ColHeader>
                        <Table.ColHeader>Path</Table.ColHeader>
                        <Table.ColHeader>Size</Table.ColHeader>
                        <Table.ColHeader>Modified</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {scenes.map((s) => (
                        <Table.Row key={s.path}>
                          <Table.Col>{truncate(s.filename, 40)}</Table.Col>
                          <Table.Col>{truncate(s.path, 60)}</Table.Col>
                          <Table.Col>{formatBytes(s.size)}</Table.Col>
                          <Table.Col>{formatDate(s.modified)}</Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "history" && (
              history.length === 0 ? (
                <EmptySection
                icon={<FileText />}
                title="No prompt history found"
                description="Prompt versions and repair history appear here as you work in the Music Video Wizard."
                action={{
                  label: "Start generating",
                  onClick: () => navigate("/music-video-wizard"),
                  icon: <ArrowRight size={14} />,
                }}
              />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>Track</Table.ColHeader>
                        <Table.ColHeader>Section</Table.ColHeader>
                        <Table.ColHeader>Prompt</Table.ColHeader>
                        <Table.ColHeader>Action</Table.ColHeader>
                        <Table.ColHeader>Outcome</Table.ColHeader>
                        <Table.ColHeader>Created</Table.ColHeader>
                        <Table.ColHeader className="text-right">Actions</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {history.map((h) => (
                        <Table.Row key={h.id}>
                          <Table.Col>{truncate(h.track_filename, 30)}</Table.Col>
                          <Table.Col>{h.section}</Table.Col>
                          <Table.Col>{truncate(h.prompt, 60)}</Table.Col>
                          <Table.Col>{h.action}</Table.Col>
                          <Table.Col>{h.outcome}</Table.Col>
                          <Table.Col>{formatDate(h.created_at)}</Table.Col>
                          <Table.Col className="text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(
                                  "history",
                                  h.id,
                                  `Prompt version "${truncate(h.prompt, 30)}"`,
                                  () => {
                                    deletePromptVersion(h.id).then(() => {
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
                          </Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "preferences" && (
              Object.keys(preferences).length === 0 ? (
                <EmptySection
                  icon={<Settings />}
                  title="No preferences found"
                  description="Application preferences appear here after you configure settings."
                  action={{
                    label: "Open Settings",
                    onClick: () => navigate("/settings"),
                    icon: <Settings size={14} />,
                  }}
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>Key</Table.ColHeader>
                        <Table.ColHeader>Category</Table.ColHeader>
                        <Table.ColHeader>Value</Table.ColHeader>
                        <Table.ColHeader className="text-right">Actions</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {Object.entries(preferences).map(([key, value]) => {
                        const val = value as Record<string, unknown>;
                        const valueStr = JSON.stringify(val?.value ?? value);
                        return (
                          <Table.Row key={key}>
                            <Table.Col>{key}</Table.Col>
                            <Table.Col>{val?.category || "general"}</Table.Col>
                            <Table.Col className="max-w-xs truncate" title={valueStr}>
                              {truncate(valueStr, 80)}
                            </Table.Col>
                            <Table.Col className="text-right">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(valueStr);
                                }}
                                className="p-1.5 hover:bg-gray-700 rounded text-xs"
                                title="Copy value"
                              >
                                <Copy size={12} />
                              </button>
                            </Table.Col>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}
      </Card>

      <div className="mt-4 text-xs text-muted">
        Read-only view of saved entities. File sizes, schema state and maintenance operations live on
        the <Link to="/database" className="text-accent hover:underline">Database</Link> page.
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
