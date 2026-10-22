/**
 * Data Management — dashboard for saved prompts, visuals, sessions, tracks,
 * saved scenes, prompt history, and preferences overview.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Table, Button, Card } from "tabler-react";
import { RefreshCw, FileText, Activity, Image, Music, Box, Settings } from "lucide-react";
import { formatBytes } from "../../utils/format";
import {
  getPrompts,
  getAIVisuals,
  getSessions,
  fetchTracks,
  listSavedScenes,
  getPromptHistory,
  getPreferences,
  type StoredPrompt,
  type AIVisualRecord,
  type GenerationSession,
  type APITrack,
  type PromptHistoryEntry,
} from "../../services/api/data";

type TabKey = "prompts" | "visuals" | "sessions" | "tracks" | "scenes" | "history" | "preferences";

export function DataManagementPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("prompts");
  const [loading, setLoading] = useState(false);
  const [prompts, setPrompts] = useState<StoredPrompt[]>([]);
  const [visuals, setVisuals] = useState<AIVisualRecord[]>([]);
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [tracks, setTracks] = useState<APITrack[]>([]);
  const [scenes, setScenes] = useState<
    Array<{ filename: string; path: string; size: number; modified: string }>
  >([]);
  const [history, setHistory] = useState<PromptHistoryEntry[]>([]);
  const [preferences, setPreferences] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        promptsData,
        visualsData,
        sessionsData,
        tracksData,
        scenesData,
        historyData,
        prefsData,
      ] = await Promise.all([
        getPrompts(),
        getAIVisuals(),
        getSessions(),
        fetchTracks(),
        listSavedScenes(),
        getPromptHistory(),
        getPreferences(),
      ]);
      setPrompts(promptsData);
      setVisuals(visualsData);
      setSessions(sessionsData);
      setTracks(tracksData);
      setScenes(scenesData.scenes || []);
      setHistory(historyData);
      setPreferences(prefsData);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatDate = (d?: string) => (d ? new Date(d).toLocaleString() : "-");
  const truncate = (t: string, n = 60) =>
    t.length > n ? `${t.substring(0, n)}...` : t;

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
          <Button color="primary" size="sm" onClick={loadData} disabled={loading}>
            {loading ? <RefreshCw size={14} className="animate-spin mr-1" /> : <Activity size={14} className="mr-1" />}
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          {lastRefreshed && (
            <span className="text-xs text-muted tabular-nums">
              Last updated: {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-red-500/40 bg-red-500/10 p-3">
          <div className="text-sm text-red-300">{error}</div>
        </Card>
      )}

      <Card>
        <div
          role="tablist"
          aria-label="Data management sections"
          className="flex flex-wrap gap-1 border-b border-border/60 mb-4"
        >
          {tabItems.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id as TabKey)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                activeTab === t.id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-white"
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
            {activeTab === "prompts" && (
              prompts.length === 0 ? (
                <div className="text-muted text-sm py-8 text-center flex flex-col items-center">
                <FileText size={32} className="mx-auto mb-2 text-muted/40" />
                No prompts found
              </div>
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
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {prompts.map((p) => (
                        <Table.Row key={p.id}>
                          <Table.Col>
                            <div className="font-medium">{p.name}</div>
                            {p.description && (
                              <div className="text-xs text-muted">{truncate(p.description, 80)}</div>
                            )}
                          </Table.Col>
                          <Table.Col>{p.prompt_type}</Table.Col>
                          <Table.Col>{p.category}</Table.Col>
                          <Table.Col>{p.use_count}</Table.Col>
                          <Table.Col>{p.is_favorite ? "★" : "☆"}</Table.Col>
                          <Table.Col>{formatDate(p.last_used_at)}</Table.Col>
                          <Table.Col>{formatDate(p.created_at)}</Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "visuals" && (
              visuals.length === 0 ? (
                <div className="text-muted text-sm py-8 text-center flex flex-col items-center">
                <Image size={32} className="mx-auto mb-2 text-muted/40" />
                No AI visuals found
              </div>
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
                <div className="text-muted text-sm py-8 text-center flex flex-col items-center">
                <Activity size={32} className="mx-auto mb-2 text-muted/40" />
                No sessions found
              </div>
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
                          <Table.Col>{formatDate(s.completed_at)}</Table.Col>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "tracks" && (
              tracks.length === 0 ? (
                <div className="text-muted text-sm py-8 text-center flex flex-col items-center">
                <Music size={32} className="mx-auto mb-2 text-muted/40" />
                No tracks found
              </div>
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
                <div className="text-muted text-sm py-8 text-center flex flex-col items-center">
                <Box size={32} className="mx-auto mb-2 text-muted/40" />
                No saved scenes found
              </div>
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
                <div className="text-muted text-sm py-8 text-center flex flex-col items-center">
                <FileText size={32} className="mx-auto mb-2 text-muted/40" />
                No prompt history found
              </div>
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
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              )
            )}

            {activeTab === "preferences" && (
              Object.keys(preferences).length === 0 ? (
                <div className="text-muted text-sm py-8 text-center flex flex-col items-center">
                <Settings size={32} className="mx-auto mb-2 text-muted/40" />
                No preferences found
              </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColHeader>Key</Table.ColHeader>
                        <Table.ColHeader>Category</Table.ColHeader>
                        <Table.ColHeader>Value</Table.ColHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {Object.entries(preferences).map(([key, value]) => {
                        const val = value as Record<string, unknown>;
                        return (
                          <Table.Row key={key}>
                            <Table.Col>{key}</Table.Col>
                            <Table.Col>{val?.category || "general"}</Table.Col>
                            <Table.Col>{truncate(JSON.stringify(val?.value ?? value), 80)}</Table.Col>
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
    </div>
  );
}
