import { useEffect, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { Card } from "../../components/common";

interface SavedPrompt {
  id: string;
  createdAt: string;
  platform: string;
  model: string;
  title: string;
  style: string;
  exclude: string;
  lyrics: string;
  settings: Record<string, unknown>;
  status: "untried" | "tried" | "submitted";
  notes: string;
  resultUrl: string;
}

const STORAGE_KEY = "music-prompts:saved";

function load(): SavedPrompt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(list: SavedPrompt[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function SavedPromptsPanel() {
  const [items, setItems] = useState<SavedPrompt[]>(() => load());
  const [filter, setFilter] = useState<"all" | "untried" | "tried" | "submitted">("all");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    save(items);
  }, [items]);

  // Reload when another component saves a prompt (same tab, no storage event).
  useEffect(() => {
    const reload = () => setItems(load());
    window.addEventListener("music-prompt:saved", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("music-prompt:saved", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const visible = items.filter((i) => (filter === "all" ? true : i.status === filter));

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const update = (id: string, patch: Partial<SavedPrompt>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "music-prompts-saved.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor: Record<SavedPrompt["status"], string> = {
    untried: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    tried: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    submitted: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  };

  return (
    <section className="space-y-4" aria-label="Saved music prompts">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Saved Prompts</h2>
          <p className="text-sm text-gray-400">
            {items.length} saved · track which ones you've tried or submitted to Suno / other platforms.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
            aria-label="Filter saved prompts"
          >
            <option value="all">All</option>
            <option value="untried">Untried</option>
            <option value="tried">Tried</option>
            <option value="submitted">Submitted</option>
          </select>
          <button
            type="button"
            onClick={exportAll}
            className="rounded border border-gray-700 px-3 py-1 text-xs hover:border-gray-500"
          >
            Export JSON
          </button>
        </div>
      </header>

      {visible.length === 0 && (
        <Card className="p-6 text-center text-sm text-gray-400">
          No saved prompts yet. Generate one in the Prompt Generator tab and it will appear here.
        </Card>
      )}

      <ul className="space-y-3">
        {visible.map((p) => (
          <li key={p.id}>
            <Card className="p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-sm">{p.title || "(untitled)"}</h3>
                  <p className="text-xs text-gray-500">
                    {p.platform} · {p.model} · {new Date(p.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={p.status}
                    onChange={(e) => update(p.id, { status: e.target.value as SavedPrompt["status"] })}
                    className={`rounded border px-2 py-1 text-xs ${statusColor[p.status]}`}
                    aria-label="Status"
                  >
                    <option value="untried">Untried</option>
                    <option value="tried">Tried</option>
                    <option value="submitted">Submitted</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="text-gray-500 hover:text-red-400"
                    aria-label="Delete saved prompt"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-400 font-medium">Style</span>
                    <button
                      type="button"
                      onClick={() => copy(p.id + ":style", p.style)}
                      className="text-gray-500 hover:text-white"
                      aria-label="Copy style"
                    >
                      {copied === p.id + ":style" ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap bg-gray-900/50 rounded p-2 max-h-32 overflow-auto">
                    {p.style || "(empty)"}
                  </pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-400 font-medium">Lyrics</span>
                    <button
                      type="button"
                      onClick={() => copy(p.id + ":lyrics", p.lyrics)}
                      className="text-gray-500 hover:text-white"
                      aria-label="Copy lyrics"
                    >
                      {copied === p.id + ":lyrics" ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap bg-gray-900/50 rounded p-2 max-h-32 overflow-auto">
                    {p.lyrics || "(empty)"}
                  </pre>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs text-gray-400" htmlFor={`url-${p.id}`}>
                  Result URL (Suno/other platform)
                </label>
                <input
                  id={`url-${p.id}`}
                  type="url"
                  value={p.resultUrl}
                  onChange={(e) => update(p.id, { resultUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-gray-400" htmlFor={`notes-${p.id}`}>
                  Notes / improvements
                </label>
                <textarea
                  id={`notes-${p.id}`}
                  value={p.notes}
                  onChange={(e) => update(p.id, { notes: e.target.value })}
                  placeholder="What to change next time…"
                  className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs min-h-[3rem]"
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function savePromptResult(result: {
  platform: string;
  model: string;
  title: string;
  style: string;
  exclude: string;
  lyrics: string;
  settings: Record<string, unknown>;
}) {
  const list = load();
  list.unshift({
    id: uid(),
    createdAt: new Date().toISOString(),
    platform: result.platform,
    model: result.model,
    title: result.title,
    style: result.style,
    exclude: result.exclude,
    lyrics: result.lyrics,
    settings: result.settings,
    status: "untried",
    notes: "",
    resultUrl: "",
  });
  save(list);
  window.dispatchEvent(new Event("music-prompt:saved"));
}
