import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Book, Search, FileText, Tag, Clock, ExternalLink, Folder, ChevronRight, Sparkles, ArrowLeft, Database, Cpu, Braces, Zap } from "lucide-react";
import { Card } from "../../components/common";
import { getBackendUrl } from "../../services/portConfig";

interface DocEntry {
  path: string;
  vault_path: string;
  title: string;
  file_type: string;
  tags: string[];
  aliases: string[];
  in_vault: boolean;
}

interface DocContent {
  path: string;
  title: string;
  tags: string[];
  raw_markdown: string;
}

interface SearchResult {
  path: string;
  vault_path: string;
  title: string;
  tags: string[];
  in_vault: boolean;
  file_type: string;
  score: number;
  snippet: string | null;
}

function getJsonFileInfo(path: string): { icon: typeof Braces; label: string; color: string } | null {
  if (!path.endsWith(".json")) return null;
  if (path.includes("agent.manifest")) return { icon: Zap, label: "Agent Manifest", color: "text-amber-300 bg-amber-500/10 border-amber-500/20" };
  if (path.includes("prompts")) return { icon: Sparkles, label: "Prompts", color: "text-pink-300 bg-pink-500/10 border-pink-500/20" };
  if (path.includes("codebase")) return { icon: Database, label: "Codebase Map", color: "text-cyan-300 bg-cyan-500/10 border-cyan-500/20" };
  if (path.includes("api-registry")) return { icon: Cpu, label: "API Registry", color: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" };
  if (path.includes("mcp-registry")) return { icon: Braces, label: "MCP Registry", color: "text-blue-300 bg-blue-500/10 border-blue-500/20" };
  return { icon: Braces, label: "JSON", color: "text-violet-300 bg-violet-500/10 border-violet-500/20" };
}

// Minimal markdown -> HTML (covers vault content without adding deps)
function renderMarkdown(md: string): string {
  // Strip frontmatter
  let text = md.replace(/^---[\s\S]*?---\s*/, "");
  // Escape HTML first
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Code blocks ```lang\ncode\n```
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre class="bg-[#0b0d14] border border-white/10 rounded-xl p-4 overflow-auto text-xs"><code class="language-${lang || "text"}">${code.trim()}</code></pre>`;
  });
  // Inline code `code`
  text = text.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-xs font-mono">$1</code>');
  // Wiki-links [[file|alias]] or [[file]]
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, file, alias) => {
    const label = (alias || file).trim();
    return `<a href="#" class="text-violet-300 hover:text-violet-200 underline decoration-violet-500/30 hover:decoration-violet-400" data-wiki="${file.trim()}">${label}</a>`;
  });
  // Markdown links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-violet-300 hover:text-violet-200 underline">$1</a>');
  // Headers
  text = text.replace(/^###\s+(.+)$/gm, '<h3 class="text-lg font-bold text-white mt-6 mb-2">$1</h3>');
  text = text.replace(/^##\s+(.+)$/gm, '<h2 class="text-xl font-bold text-white mt-8 mb-3 border-b border-white/5 pb-2">$1</h2>');
  text = text.replace(/^#\s+(.+)$/gm, '<h1 class="text-2xl font-extrabold tracking-tight text-white mt-2 mb-4">$1</h1>');
  // Blockquotes > [!info] etc
  text = text.replace(/^>\s*\[!(\w+)\]\s*(.*)$/gm, '<div class="callout callout-$1 border-l-4 pl-3 py-2 my-3 rounded-r-xl bg-white/[0.03] border-white/10"><span class="text-xs font-bold uppercase tracking-wide text-violet-300">$1</span> $2</div>');
  text = text.replace(/^>\s+(.+)$/gm, '<blockquote class="border-l-2 border-violet-500/40 pl-3 py-1 my-3 bg-violet-500/5 rounded-r-xl text-muted">$1</blockquote>');
  // Unordered lists
  text = text.replace(/^\s*[-*]\s+(.+)$/gm, '<li class="ml-5 list-disc text-sm text-muted my-1">$1</li>');
  // Wrap orphan lines into paragraphs (simple)
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (inList) { html += "</ul>"; inList = false; } html += ""; continue; }
    if (t.startsWith("<h") || t.startsWith("<pre") || t.startsWith("<blockquote") || t.startsWith("<div class=\"callout") || t.startsWith("<li")) {
      if (t.startsWith("<li") && !inList) { html += '<ul class="my-3">'; inList = true; }
      if (!t.startsWith("<li") && inList) { html += "</ul>"; inList = false; }
      html += t;
    } else if (t.startsWith("<ul") || t.startsWith("</ul")) {
      html += t;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      // Skip lines already wrapped
      if (t.startsWith("<a") || t.startsWith("<code")) html += `<p class="text-sm leading-relaxed text-muted my-2">${t}</p>`;
      else html += `<p class="text-sm leading-relaxed text-[#cbd5e1] my-2">${t}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

export function Documentation() {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load list
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const base = await getBackendUrl();
        const res = await fetch(`${base}/api/docs/list`);
        if (!res.ok) throw new Error(`Failed to list docs: ${res.status}`);
        const data: DocEntry[] = await res.json();
        if (!cancelled) {
          setDocs(data);
          // Auto-select vault index or first vault file
          const preferred = data.find(d => d.path === "knowledge-library/index.md") || data.find(d => d.in_vault) || data[0];
          if (preferred) setSelected(preferred.path);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load docs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load content when selected changes
  useEffect(() => {
    if (!selected) return;
    const sel = selected;
    let cancelled = false;
    async function loadFile() {
      try {
        const base = await getBackendUrl();
        const res = await fetch(`${base}/api/docs/file?path=${encodeURIComponent(sel)}`);
        if (!res.ok) throw new Error(`Failed to load ${selected}: ${res.status}`);
        const data: DocContent = await res.json();
        if (!cancelled) setContent(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load file");
      }
    }
    loadFile();
    return () => { cancelled = true; };
  }, [selected]);

  // Server-side search when query >= 2 chars
  useEffect(() => {
    if (search.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    async function doSearch() {
      try {
        setSearching(true);
        const base = await getBackendUrl();
        const res = await fetch(`${base}/api/docs/search?q=${encodeURIComponent(search)}&limit=20`);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data: SearchResult[] = await res.json();
        if (!cancelled) setSearchResults(data);
      } catch {
        if (!cancelled) setSearchResults(null);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }
    const timer = setTimeout(doSearch, 300); // debounce
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  const filtered = useMemo(() => {
    if (!search.trim()) return docs;
    // Use server results if available, else client filter
    if (searchResults && searchResults.length > 0) {
      return searchResults.map(r => ({
        path: r.path,
        vault_path: r.vault_path,
        title: r.title,
        file_type: r.file_type,
        tags: r.tags,
        aliases: [],
        in_vault: r.in_vault,
        score: r.score,
        snippet: r.snippet,
      })) as (DocEntry & { score?: number; snippet?: string | null })[];
    }
    const q = search.toLowerCase();
    return docs.filter(d => d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q) || d.tags.some(t => t.toLowerCase().includes(q)));
  }, [docs, search, searchResults]);

  const vaultDocs = filtered.filter(d => d.in_vault);
  const guideDocs = filtered.filter(d => !d.in_vault);

  const handleWikiClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const wiki = target.getAttribute("data-wiki");
    if (wiki) {
      e.preventDefault();
      // Try to find doc by vault_path or filename
      const clean = wiki.split("|")[0].trim().replace(/\.md$/, "");
      const found = docs.find(d => d.vault_path.replace(/\.md$/, "") === clean || d.path.replace(/\.md$/, "") === clean || d.title.toLowerCase() === clean.toLowerCase());
      if (found) setSelected(found.path);
    }
  };

  return (
    <div className="flex h-[calc(100vh-0px)] max-h-screen">
      {/* Left — vault nav */}
      <div className="w-[320px] min-w-[280px] border-r border-white/5 bg-[#0b0d14]/50 backdrop-blur flex flex-col">
        <div className="p-4 border-b border-white/5">
          <h1 className="text-lg font-extrabold tracking-tight text-white flex items-center gap-2"><Book size={18} className="text-violet-400" /> Documentation</h1>
          <p className="text-xs text-muted mt-1">Live vault — edits in <code className="text-violet-300">docs/knowledge-library/</code> appear instantly</p>
          <div className="relative mt-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search titles, tags, paths..." className="input pl-8 py-2 text-sm w-full" />
          </div>
          <div className="flex items-center gap-2 mt-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500" />Vault {vaultDocs.length}</span>
            <span className="inline-flex items-center gap-1"><Folder size={10} />Guides {guideDocs.length}</span>
            <a href="obsidian://open?path=docs/knowledge-library" className="ml-auto text-violet-300 hover:underline inline-flex items-center gap-1">Open Obsidian <ExternalLink size={10} /></a>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-4 scrollbar-thin">
          {loading ? (
            <div className="p-4 text-sm text-muted">Loading vault…</div>
          ) : error ? (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-200">{error}</div>
          ) : (
            <>
              <div>
                <p className="px-2 py-1 text-[11px] font-bold tracking-widest text-violet-300 uppercase flex items-center gap-1"><Sparkles size={10} /> Knowledge Library (Obsidian)</p>
                <div className="space-y-0.5 mt-1">
                  {vaultDocs.map(d => {
                    const jsonInfo = getJsonFileInfo(d.path);
                    const score = (d as any).score as number | undefined;
                    const snippet = (d as any).snippet as string | null | undefined;
                    return (
                      <button key={d.path} onClick={() => setSelected(d.path)} className={`w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2 transition-colors ${selected === d.path ? "bg-violet-600 text-white" : "hover:bg-white/5 text-muted hover:text-white"}`}>
                        {jsonInfo ? (
                          <jsonInfo.icon size={14} className={`mt-0.5 shrink-0 ${selected === d.path ? "text-white" : jsonInfo.color.split(" ")[0]}`} />
                        ) : (
                          <FileText size={14} className={`mt-0.5 shrink-0 ${selected === d.path ? "text-white" : "text-gray-500"}`} />
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium leading-tight truncate">{d.title}</span>
                          <span className="block text-[11px] truncate opacity-60">{d.path}</span>
                          {jsonInfo && <span className={`inline-flex items-center gap-1 mt-1 text-[10px] px-1.5 py-0 rounded border ${jsonInfo.color}`}>{jsonInfo.label}</span>}
                          {score !== undefined && score > 0 && <span className="inline-flex items-center gap-1 ml-1 mt-1 text-[10px] px-1 py-0 rounded bg-emerald-500/10 text-emerald-300">{score.toFixed(1)}</span>}
                          {!jsonInfo && d.tags.length > 0 && <span className="inline-flex gap-1 mt-1 flex-wrap">{d.tags.slice(0, 3).map(t => <span key={t} className={`text-[10px] px-1 py-0 rounded ${selected === d.path ? "bg-white/20" : "bg-white/5 border border-white/5"}`}>#{t}</span>)}</span>}
                          {snippet && <span className="block text-[10px] text-muted/60 truncate mt-0.5">{snippet}</span>}
                        </span>
                        {selected === d.path && <ChevronRight size={12} className="shrink-0 mt-1" />}
                      </button>
                    );
                  })}
                  {vaultDocs.length === 0 && <p className="px-2 text-xs text-muted">No vault docs match "{search}".</p>}
                </div>
              </div>

              {guideDocs.length > 0 && (
                <div>
                  <p className="px-2 py-1 text-[11px] font-bold tracking-widest text-gray-500 uppercase flex items-center gap-1"><Folder size={10} /> Guides & API</p>
                  <div className="space-y-0.5 mt-1">
                    {guideDocs.map(d => (
                      <button key={d.path} onClick={() => setSelected(d.path)} className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 text-sm ${selected === d.path ? "bg-white/10 text-white" : "hover:bg-white/5 text-muted hover:text-white"}`}>
                        <FileText size={14} className="shrink-0 text-gray-500" />
                        <span className="truncate">{d.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-2 border-t border-white/5 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Backend: /api/docs</span>
          <span className="ml-2">Vault: <code className="text-violet-300">docs/knowledge-library/.obsidian</code></span>
        </div>
      </div>

      {/* Right — content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {selected && content ? (
          <>
            <div className="sticky top-0 z-10 backdrop-blur bg-background/80 border-b border-white/5 px-6 py-3 flex items-center gap-3">
              <button onClick={() => setSelected(null)} className="lg:hidden btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back</button>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-white truncate">{content.title}</h2>
                <p className="text-xs text-muted truncate flex items-center gap-2">
                  <span className="font-mono">{content.path}</span>
                  {content.tags.length > 0 && <span className="inline-flex gap-1">{content.tags.map(t => <span key={t} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/20 text-violet-300"><Tag size={10} />{t}</span>)}</span>}
                </p>
              </div>
              <a href={`http://localhost:8000/api/docs/file?path=${encodeURIComponent(content.path)}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm hidden sm:flex">
                Raw <ExternalLink size={12} />
              </a>
            </div>
            <div className="flex-1 overflow-auto p-6 md:p-8" onClick={handleWikiClick}>
              <div className="max-w-[760px] mx-auto">
                {/* Meta bar */}
                <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300"><Book size={12} /> {content.path.endsWith(".json") ? "JSON manifest" : "Obsidian vault"}</span>
                  <span className="inline-flex items-center gap-1 text-muted"><Clock size={12} /> Live — edited files appear on next select</span>
                  {content.path.endsWith(".json") && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">Machine-readable</span>}
                </div>
                {content.path.endsWith(".json") ? (
                  <div className="space-y-3">
                    <pre className="bg-[#0b0d14] border border-white/10 rounded-xl p-4 overflow-auto text-xs max-h-[70vh]"><code>{(() => { try { return JSON.stringify(JSON.parse(content.raw_markdown), null, 2); } catch { return content.raw_markdown; } })()}</code></pre>
                    <div className="flex items-center gap-3 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1"><Braces size={12} /> {(() => { try { const d = JSON.parse(content.raw_markdown); return Object.keys(d).length; } catch { return "?"; } })()} top-level keys</span>
                      <span>{(content.raw_markdown.length / 1024).toFixed(1)} KB</span>
                      <button onClick={() => { navigator.clipboard.writeText(content.raw_markdown); }} className="text-violet-300 hover:underline">Copy JSON</button>
                    </div>
                  </div>
                ) : (
                  <article className="prose prose-invert max-w-none prose-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(content.raw_markdown) }} />
                )}
                <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted">
                  <span>Vault: <code className="text-violet-300">docs/knowledge-library</code> • Open in Obsidian → Graph View</span>
                  <button onClick={() => window.open("obsidian://open?path=" + encodeURIComponent(content.path), "_blank")} className="text-violet-300 hover:underline">Open in Obsidian</button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="max-w-md">
              <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center mx-auto"><Book size={20} className="text-white" /></div>
              <h3 className="text-lg font-bold text-white mt-4">Select a note</h3>
              <p className="text-sm text-muted mt-1">Left: vault files (live from <code className="text-violet-300">/api/docs/list</code>). Right: rendered markdown with wiki-links, callouts, and code blocks. Edit any <code className="text-violet-300">docs/knowledge-library/*.md</code> and hit Refresh — no restart.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
