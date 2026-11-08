/**
 * DocsPage — in-app documentation browser.
 *
 * Purpose: render the project's documentation tree (docs/*.md) inside the app.
 * docs.py serves DOCS_ROOT.rglob("*.md") across all of docs/, and this page
 * parses and displays each document's frontmatter tags. Documents without
 * frontmatter render with an empty tag list and cannot be found by tag search
 * — that is a real user-visible cost, which is why app-served documents under
 * docs/knowledge/ are tagged per-document rather than bulk-tagged (see
 * decision-log D12).
 *
 * Docs map note: docs/README.md is the authoritative directory index and is
 * verified by tools/check-docs-map.py (pre-commit hook). Do not restructure the
 * docs tree without updating that map — docs.py, the Docs page, and every
 * [[wiki-link]] resolve by path.
 *
 * Non-authoritative dirs: docs/notes/ and docs/scratch/ are not authoritative
 * (D12). The knowledge library (docs/knowledge-library/) is tag-validated by
 * tools/validate-knowledge-tags.py.
 */
import { useState, useEffect, useCallback } from "react";
import { MarkdownView } from "./components/DocViews";
import {
  Search,
  FileText,
  Folder,
  FolderOpen,
  Code,
  BookOpen,
  Loader2,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Tag,
  Layers,
  FileJson,
  X,
  Copy,
  Check,
} from "lucide-react";
import { searchDocs, getDocsBootstrap, getProjectStructure } from "../../services/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DocResult {
  path: string;
  title: string;
  score: number;
  snippet: string | null;
  tags?: string[];
  in_vault?: boolean;
  file_type?: string;
}

interface DocListEntry {
  path: string;
  vault_path: string;
  title: string;
  file_type: "vault" | "guide";
  tags: string[];
  aliases: string[];
  in_vault: boolean;
}

interface BackendNode {
  name: string;
  type: "file" | "dir" | "directory";
  children?: BackendNode[];
  size?: number;
}

interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
  size?: number;
}

interface BootstrapData {
  version?: string;
  project?: string;
  description?: string;
  ports?: Record<string, number>;
  vault_docs?: { path: string; title: string; tags: string[] }[];
  quick_start?: Record<string, string>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Lightweight markdown renderer (no extra deps) — improved
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export function DocsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [structure, setStructure] = useState<TreeNode[]>([]);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["packages", "docs"]));
  const [docs, setDocs] = useState<DocListEntry[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsFilter, setDocsFilter] = useState<"all" | "vault" | "guide">("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [copied, setCopied] = useState(false);
  const [structureDepth, setStructureDepth] = useState(2);
  const [visibleCount, setVisibleCount] = useState(24);

  // ---- bootstrap + structure + docs list ----
  useEffect(() => {
    void loadBootstrap();
    void loadStructure();
    void loadDocsList();
  }, []);

  useEffect(() => {
    // reload structure when depth changes (skip initial)
    void loadStructure(structureDepth);
    // Only `structureDepth` is a real input. `loadStructure` is re-created on
    // every render, so listing it would re-fetch the tree on each render.
  }, [structureDepth]);

  // reset pagination when filter changes
  useEffect(() => {
    setVisibleCount(24);
  }, [docsFilter, query, hasSearched]);

  const loadBootstrap = async () => {
    try {
      const data: BootstrapData = await getDocsBootstrap();
      setBootstrap(data);
      setBootstrapError(null);
    } catch (e) {
      setBootstrapError(e instanceof Error ? e.message : "Bootstrap failed");
    }
  };

  const loadDocsList = async () => {
    setLoadingDocs(true);
    setDocsError(null);
    try {
      const res = await fetch(`/api/docs/list?vault_only=false`);
      if (!res.ok) throw new Error(`${res.status}`);
      setDocs((await res.json()) as DocListEntry[]);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : "Failed to load docs");
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadStructure = async (depth: number = structureDepth) => {
    try {
      const data = await getProjectStructure(depth);
      const raw = data.structure as Record<string, BackendNode | BackendNode[]>;
      const normalized: TreeNode[] = [];
      for (const [key, val] of Object.entries(raw)) {
        if (Array.isArray(val)) {
          // _root_files etc: array of file nodes
          normalized.push({
            name: key === "_root_files" ? "Root files" : key,
            type: "directory",
            children: val.map((n: BackendNode) => backendToTree(n)),
          });
        } else if (typeof val === "object" && "children" in val) {
          normalized.push(backendToTree(val));
        } else {
          // fallback
          normalized.push({ name: key, type: "directory", children: [] });
        }
      }
      // Sort: directories first, then files
      normalized.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setStructure(normalized);
      setStructureError(null);
    } catch (e) {
      setStructureError(e instanceof Error ? e.message : "Failed to load structure");
    }
  };

  const backendToTree = (node: BackendNode): TreeNode => {
    const type =
      node.type === "dir" ? "directory" : node.type === "directory" ? "directory" : "file";
    if (type === "directory") {
      return {
        name: node.name,
        type: "directory",
        children: (node.children ?? []).map(backendToTree),
        size: node.size,
      };
    }
    return { name: node.name, type: "file", size: node.size };
  };

  // ---- search ----
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    setHasSearched(true);
    try {
      const data = await searchDocs(q, 20);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleClearSearch = () => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
  };

  // ---- doc viewer ----
  const openDoc = async (path: string) => {
    setSelectedPath(path);
    setSelectedContent(null);
    setLoadingDoc(true);
    try {
      const res = await fetch(`/api/docs/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error("not found");
      const data = (await res.json()) as { raw_markdown?: string };
      setSelectedContent(data.raw_markdown ?? null);
    } catch {
      setSelectedContent(`# Not found\n\nCould not load \`${path}\``);
    } finally {
      setLoadingDoc(false);
    }
  };

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderTree = (nodes: TreeNode[], parentPath = "", depth = 0) => {
    return nodes.map((node) => {
      const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
      const isExpanded = expandedDirs.has(currentPath);
      const isDir = node.type === "directory";
      return (
        <div
          key={currentPath}
          role={isDir ? "treeitem" : undefined}
          aria-expanded={isDir ? isExpanded : undefined}
        >
          <button
            onClick={() => isDir && toggleDir(currentPath)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (isDir) toggleDir(currentPath);
              }
            }}
            aria-label={
              isDir ? `${isExpanded ? "Collapse" : "Expand"} ${node.name}` : `File ${node.name}`
            }
            className={`w-full flex items-center gap-2 px-2 py-1 hover:bg-gray-700/50 rounded text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500/50 ${
              isDir ? "text-blue-300" : "text-gray-400"
            }`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {isDir ? (
              <>
                {isExpanded ? (
                  <ChevronDown size={12} className="shrink-0" />
                ) : (
                  <ChevronRight size={12} className="shrink-0" />
                )}
                {isExpanded ? (
                  <FolderOpen size={14} className="shrink-0 text-blue-400" />
                ) : (
                  <Folder size={14} className="shrink-0 text-blue-400" />
                )}
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                <FileText size={14} className="shrink-0 text-gray-500" />
              </>
            )}
            <span className="truncate text-left">{node.name}</span>
            {node.type === "file" && node.size != null && (
              <span className="ml-auto text-xs text-gray-600">
                {(node.size / 1024).toFixed(1)}k
              </span>
            )}
          </button>
          {isDir && isExpanded && node.children && node.children.length > 0 && (
            <div role="group">{renderTree(node.children, currentPath, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const filteredDocs = docs.filter((d) => {
    if (docsFilter === "vault" && !d.in_vault) return false;
    if (docsFilter === "guide" && d.in_vault) return false;
    return true;
  });

  // Search results also respect filter — use in_vault when available, fallback to path heuristic
  const filteredResults = results.filter((r) => {
    const isVault = r.in_vault ?? r.path.startsWith("knowledge-library/");
    if (docsFilter === "vault" && !isVault) return false;
    if (docsFilter === "guide" && isVault) return false;
    return true;
  });

  // When browsing (no search active), optionally live-filter by query
  const browsingDocs =
    !hasSearched && query.trim()
      ? filteredDocs.filter(
          (d) =>
            d.title.toLowerCase().includes(query.toLowerCase()) ||
            d.path.toLowerCase().includes(query.toLowerCase()) ||
            d.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
        )
      : filteredDocs;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen size={24} className="text-purple-400" />
            Documentation
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            Search the vault, browse guides, and explore the codebase — powered by{" "}
            <code className="text-purple-300">/api/docs</code>.
          </p>
        </div>
        {bootstrap && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 bg-gray-800 rounded border border-gray-700 text-gray-300">
              v{bootstrap.version ?? "2026-08-24"}
            </span>
            {bootstrap.ports && (
              <span className="px-2 py-1 bg-gray-800 rounded border border-gray-700 text-gray-400 hidden sm:inline">
                :{bootstrap.ports.backend} · :{bootstrap.ports.frontend} · :
                {bootstrap.ports.comfyui}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={query}
              aria-label="Search documentation"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim() && hasSearched) {
                  setHasSearched(false);
                  setResults([]);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSearch();
                if (e.key === "Escape") handleClearSearch();
              }}
              className="w-full pl-9 pr-8 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm"
              placeholder="Search docs by title, tag, or content… (try 'visualization', 'webgpu', 'eevee')"
            />
            {query && (
              <button
                onClick={handleClearSearch}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-600 rounded text-gray-400"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => void handleSearch()}
            disabled={searching || !query.trim()}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Search
          </button>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-gray-500">Filter:</span>
          {(["all", "vault", "guide"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setDocsFilter(f)}
              aria-pressed={docsFilter === f}
              aria-label={`Filter ${f}`}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500/50 ${
                docsFilter === f
                  ? "bg-purple-600 border-purple-500 text-white"
                  : "bg-gray-700 border-gray-600 text-gray-400 hover:text-white hover:border-gray-500"
              }`}
            >
              {f === "all"
                ? `All (${docs.length})`
                : f === "vault"
                  ? `Vault (${docs.filter((d) => d.in_vault).length})`
                  : `Guides (${docs.filter((d) => !d.in_vault).length})`}
            </button>
          ))}
          {hasSearched && (
            <span className="ml-auto text-xs text-gray-500">
              {results.length} results for “{query}” ·{" "}
              <button onClick={handleClearSearch} className="text-purple-400 hover:underline">
                clear
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main: search results OR docs browsing + bootstrap */}
        <div className="lg:col-span-2 space-y-4 order-1">
          {/* Search Results — respects Filter */}
          {hasSearched ? (
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                <Search size={16} className="text-purple-400" />
                Search Results ({filteredResults.length}
                {filteredResults.length !== results.length ? ` / ${results.length}` : ""})
              </h3>
              {filteredResults.length === 0 ? (
                <p className="text-gray-500 text-sm py-4 text-center">
                  No results for “{query}” in current filter. Try “All” or fewer keywords.
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => void openDoc(r.path)}
                      className="w-full text-left p-3 bg-gray-700/30 hover:bg-gray-700/60 rounded-lg border border-transparent hover:border-gray-600 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-purple-400 text-sm font-medium group-hover:text-purple-300 truncate">
                          {r.title}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400 shrink-0">
                          {r.score.toFixed(1)}
                        </span>
                      </div>
                      <p className="text-gray-500 text-xs mt-1 truncate flex items-center gap-1">
                        {r.file_type === "vault" || r.in_vault ? (
                          <BookOpen size={10} className="text-purple-400" />
                        ) : (
                          <FileText size={10} className="text-gray-500" />
                        )}
                        {r.path}
                      </p>
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 bg-purple-900/30 rounded text-[10px] text-purple-300 border border-purple-700/30"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.snippet && (
                        <p className="text-gray-400 text-sm mt-2 line-clamp-2 bg-gray-900/40 p-2 rounded border border-gray-700/30">
                          {r.snippet}
                        </p>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-purple-400 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        Open <ExternalLink size={10} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Docs Browsing */
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium flex items-center gap-2">
                  <Layers size={16} className="text-blue-400" />
                  {docsFilter === "vault"
                    ? "Knowledge Vault"
                    : docsFilter === "guide"
                      ? "Guides"
                      : "All Documentation"}
                  <span className="text-gray-500 font-normal text-sm">
                    · {browsingDocs.length} docs
                  </span>
                </h3>
              </div>
              {loadingDocs ? (
                <div className="py-10 flex flex-col items-center gap-2 text-gray-500">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-xs">Loading vault…</span>
                </div>
              ) : docsError ? (
                <p className="text-amber-400 text-sm py-6 text-center">
                  Failed to load docs ({docsError}).{" "}
                  <button onClick={() => void loadDocsList()} className="underline hover:text-amber-300">
                    Retry
                  </button>
                </p>
              ) : browsingDocs.length === 0 ? (
                <p className="text-gray-500 text-sm py-6 text-center">
                  No documents match the current filter.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[520px] overflow-y-auto pr-1">
                    {browsingDocs.slice(0, visibleCount).map((d) => (
                      <button
                        key={d.path}
                        onClick={() => void openDoc(d.path)}
                        className={`text-left p-3 rounded-lg border transition-colors group ${
                          selectedPath === d.path
                            ? "bg-purple-600/20 border-purple-500/50"
                            : "bg-gray-700/30 hover:bg-gray-700/60 border-transparent hover:border-gray-600"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {d.file_type === "vault" ? (
                            <BookOpen size={14} className="text-purple-400 mt-0.5 shrink-0" />
                          ) : d.path.endsWith(".json") ? (
                            <FileJson size={14} className="text-amber-400 mt-0.5 shrink-0" />
                          ) : (
                            <FileText size={14} className="text-gray-500 mt-0.5 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white truncate group-hover:text-purple-300">
                              {d.title}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{d.path}</p>
                            {d.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {d.tags.slice(0, 3).map((t) => (
                                  <span
                                    key={t}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-800 rounded text-[10px] text-gray-400 border border-gray-700"
                                  >
                                    <Tag size={8} /> {t}
                                  </span>
                                ))}
                                {d.tags.length > 3 && (
                                  <span className="text-[10px] text-gray-600">
                                    +{d.tags.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  {visibleCount < browsingDocs.length && (
                    <button
                      onClick={() => setVisibleCount((v) => Math.min(v + 24, browsingDocs.length))}
                      className="w-full mt-3 py-2 text-xs text-purple-400 hover:text-purple-300 border border-gray-700 hover:border-purple-500/30 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors"
                    >
                      Show {Math.min(24, browsingDocs.length - visibleCount)} more · {visibleCount}/
                      {browsingDocs.length}
                    </button>
                  )}
                </>
              )}
              <p className="text-xs text-gray-600 mt-3">
                Tip: these are live from <code className="text-gray-400">docs/</code> — edit a
                markdown file and it appears instantly. Search above for full-text snippets.
              </p>
            </div>
          )}

          {/* System Info — fixed [object Object] */}
          {bootstrapError && (
            <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 text-xs text-amber-300">
              System info unavailable: {bootstrapError}
            </div>
          )}
          {bootstrap && (
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                <Code size={16} className="text-green-400" />
                System Info
              </h3>
              <div className="space-y-3">
                <p className="text-sm text-gray-300 leading-relaxed">{bootstrap.description}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 bg-gray-700/40 rounded-lg border border-gray-700/50">
                    <span className="text-gray-500 text-xs block">Project</span>
                    <span className="text-white text-sm font-medium">
                      {String(bootstrap.project ?? "—")}
                    </span>
                  </div>
                  <div className="p-2.5 bg-gray-700/40 rounded-lg border border-gray-700/50">
                    <span className="text-gray-500 text-xs block">Version</span>
                    <span className="text-white text-sm font-mono">
                      {String(bootstrap.version ?? "—")}
                    </span>
                  </div>
                  {bootstrap.ports && (
                    <>
                      <div className="p-2.5 bg-gray-700/40 rounded-lg border border-gray-700/50">
                        <span className="text-gray-500 text-xs block">Backend</span>
                        <span className="text-white text-sm font-mono">
                          :{bootstrap.ports.backend}
                        </span>
                      </div>
                      <div className="p-2.5 bg-gray-700/40 rounded-lg border border-gray-700/50">
                        <span className="text-gray-500 text-xs block">Frontend</span>
                        <span className="text-white text-sm font-mono">
                          :{bootstrap.ports.frontend}
                        </span>
                      </div>
                      <div className="p-2.5 bg-gray-700/40 rounded-lg border border-gray-700/50">
                        <span className="text-gray-500 text-xs block">ComfyUI</span>
                        <span className="text-white text-sm font-mono">
                          :{bootstrap.ports.comfyui}
                        </span>
                      </div>
                      <div className="p-2.5 bg-gray-700/40 rounded-lg border border-gray-700/50">
                        <span className="text-gray-500 text-xs block">Vault Docs</span>
                        <span className="text-white text-sm">
                          {docs.filter((d) => d.in_vault).length} files
                        </span>
                      </div>
                    </>
                  )}
                </div>
                {bootstrap.quick_start && (
                  <div className="pt-3 border-t border-gray-700/50">
                    <span className="text-gray-500 text-xs block mb-2">
                      Quick Start (for agents)
                    </span>
                    <ol className="space-y-1.5">
                      {Object.entries(bootstrap.quick_start).map(([k, v]) => (
                        <li key={k} className="text-xs text-gray-400 flex gap-2">
                          <span className="text-purple-400 font-mono shrink-0">{k}</span>
                          <span className="break-words">{String(v)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Project Structure + Doc Viewer — sticky on desktop */}
        <div className="space-y-4 order-2 lg:sticky lg:top-6 self-start">
          {/* Project Structure — fixed parser */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium flex items-center gap-2">
                <Code size={16} className="text-blue-400" />
                Project Structure
              </h3>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map((d) => (
                  <button
                    key={d}
                    onClick={() => setStructureDepth(d)}
                    aria-pressed={structureDepth === d}
                    aria-label={`Depth ${d}`}
                    className={`w-6 h-6 rounded text-xs font-mono border transition-colors ${
                      structureDepth === d
                        ? "bg-purple-600 border-purple-500 text-white"
                        : "bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-white"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            {structureError ? (
              <p className="text-amber-400 text-sm">
                Failed to load structure ({structureError}).{" "}
                <button
                  onClick={() => void loadStructure()}
                  className="underline hover:text-amber-300"
                >
                  Retry
                </button>
              </p>
            ) : structure.length === 0 ? (
              <p className="text-gray-500 text-sm flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </p>
            ) : (
              <div
                className="max-h-80 overflow-y-auto bg-gray-900/30 rounded border border-gray-700/30 p-2"
                role="tree"
                aria-label="Project file structure"
              >
                {renderTree(structure)}
              </div>
            )}
          </div>

          {/* Doc Viewer */}
          {selectedPath && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-gray-700 bg-gray-900/50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate flex items-center gap-2">
                    <FileText size={14} className="text-purple-400 shrink-0" />
                    {selectedPath}
                  </p>
                  <p className="text-xs text-gray-500 truncate">/docs/{selectedPath}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => {
                      if (selectedContent) {
                        void navigator.clipboard.writeText(selectedContent).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                      }
                    }}
                    className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                    title="Copy raw markdown"
                  >
                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                  <a
                    href={`/api/docs/file?path=${encodeURIComponent(selectedPath)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                    title="Open raw"
                  >
                    <ExternalLink size={14} />
                  </a>
                  <button
                    onClick={() => setSelectedPath(null)}
                    aria-label="Close document viewer"
                    className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="max-h-[480px] overflow-y-auto p-4">
                {loadingDoc ? (
                  <p className="text-gray-500 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Loading…
                  </p>
                ) : selectedContent ? (
                  <MarkdownView text={selectedContent} filePath={selectedPath || undefined} />
                ) : (
                  <p className="text-gray-500 text-sm">No content.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
