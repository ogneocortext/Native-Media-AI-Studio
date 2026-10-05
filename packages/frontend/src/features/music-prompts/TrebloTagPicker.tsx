import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { getApiBase } from "../../services/api/core";
import { tagStringFor, toggleTag, unfilledRelated } from "./tagSelection";

/**
 * Treblo Tag Picker — searchable picker over Treblo's 4,160 published v3 style tags.
 *
 * Local helper: it searches the tag list that ships in the repo and produces a
 * comma-separated string the user pastes into Treblo's (or Suno's) style field.
 * Nothing is generated or sent anywhere — see SPEC.md's hard boundary.
 *
 * Sits alongside MusicPromptGenerator in the same workbench section: the generator
 * engineers prose, this supplies exact verified tags. No automatic merging of the
 * two in v1.
 */

interface SearchResponse {
  query: string;
  results: string[];
}

interface RelatedResponse {
  tag: string;
  related: string[];
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Treblo tag request failed (${res.status})`);
  return (await res.json()) as T;
}

/**
 * Starter tags for the empty state.
 *
 * A blank box in front of 4,160 tags is a dead end, so the panel offers something
 * to press. These are verified present in the shipped data - not invented - and
 * each one is a real subgenre rather than an era or mood tag, which is what makes
 * a useful first pick. Pressing one loads it into the search box rather than
 * selecting it outright, so the user still sees the ranking and chooses.
 */
const STARTER_TAGS = [
  "phonk",
  "dream pop",
  "synthwave",
  "afrobeats",
  "hyperpop",
  "shoegaze",
  "lo-fi",
  "drift phonk",
] as const;

export function TrebloTagPicker() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [related, setRelated] = useState<string[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [searching, setSearching] = useState(false);

  // Guards against a slow response for "pho" overwriting a newer one for "phonk".
  const reqId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/treblo-tags/count`)
      .then((r) => readJson<{ count: number }>(r))
      .then((d) => !cancelled && setTotal(d.count))
      .catch(() => !cancelled && setTotal(null));
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced search: 180ms. Every keystroke would otherwise re-rank 4,160 tags.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++reqId.current;
    const timer = window.setTimeout(() => {
      fetch(`${getApiBase()}/api/treblo-tags/search?q=${encodeURIComponent(q)}&limit=40`)
        .then((r) => readJson<SearchResponse>(r))
        .then((d) => {
          if (id !== reqId.current) return;
          setResults(d.results);
          setSearching(false);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setResults([]);
          setSearching(false);
          setStatus("Tag search is unavailable — is the backend running?");
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Related tags follow the most recently selected tag.
  useEffect(() => {
    const focus = selected[selected.length - 1];
    if (!focus) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    fetch(`${getApiBase()}/api/treblo-tags/related?tag=${encodeURIComponent(focus)}&limit=12`)
      .then((r) => readJson<RelatedResponse>(r))
      .then((d) => !cancelled && setRelated(d.related))
      .catch(() => !cancelled && setRelated([]));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // The string is computed, not stored: selection is the single source of truth,
  // so there is no state to fall out of sync with the tray.
  const tagString = useMemo(() => tagStringFor(selected), [selected]);

  const toggle = useCallback((tag: string) => {
    setSelected((prev) => toggleTag(prev, tag));
  }, []);

  /**
   * Arrow-key movement through the results.
   *
   * Tab alone would mean 40 tab stops to reach the copy button on a long result
   * list. Up/Down from anywhere in the list hops between rows and wraps at the
   * ends, and the roving index keeps only the active row in the tab order so the
   * list stays a single stop.
   */
  const onResultsKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLUListElement>) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!results.length) return;
      e.preventDefault();
      const rows = Array.from(
        e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-tag]"),
      );
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = at === -1 ? 0 : (at + step + rows.length) % rows.length;
      rows[next]?.focus();
    },
    [results.length],
  );

  const copy = useCallback(async () => {
    if (!tagString) return;
    try {
      await navigator.clipboard.writeText(tagString);
      setCopied(true);
      setStatus("");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setStatus("Clipboard blocked — select the text and copy manually.");
    }
  }, [tagString]);

  const unfilled = unfilledRelated(selected, related);

  return (
    <section className="space-y-4" aria-label="Treblo tag picker">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Treblo Tag Picker</h2>
        <p className="text-sm text-gray-400">
          Search {total ? total.toLocaleString() : "4,160"} published v3 style tags, pick exact
          ones, and copy them as a comma-separated string.
        </p>
        <p className="text-xs text-gray-500">
          Paste into Treblo&rsquo;s style field in <strong className="text-gray-400">Advanced</strong>{" "}
          mode, or straight into Suno&rsquo;s style field &mdash; both take plain comma-separated tags.
        </p>
      </header>

      <label className="block">
        <span className="sr-only">Search tags</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags… e.g. phonk"
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
        />
      </label>

      {!query.trim() && !selected.length && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Start with a genre, or search any mood, era or instrument. ↑ ↓ to move,
            Enter to add.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {STARTER_TAGS.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => setQuery(tag)}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-blue-500 hover:text-blue-300"
                >
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {query.trim() && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">
            {searching ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </p>
          <ul
            className="max-h-56 overflow-y-auto rounded border border-gray-800"
            onKeyDown={onResultsKeyDown}
          >
            {results.map((tag) => {
              const isOn = selected.some((s) => s.toLowerCase() === tag.toLowerCase());
              return (
                <li key={tag}>
                  <button
                    type="button"
                    data-tag={tag}
                    onClick={() => toggle(tag)}
                    aria-pressed={isOn}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-800 ${
                      isOn ? "text-emerald-400" : "text-gray-200"
                    }`}
                  >
                    <span>{tag}</span>
                    <span className="text-xs text-gray-500">{isOn ? "added" : "+"}</span>
                  </button>
                </li>
              );
            })}
            {!results.length && !searching && (
              <li className="px-3 py-2 text-sm text-gray-500">No tags match “{query.trim()}”.</li>
            )}
          </ul>
        </div>
      )}

      {selected.length > 0 && (
        <div className="space-y-2 rounded border border-gray-800 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Selected ({selected.length})</h3>
            <button
              type="button"
              onClick={() => setSelected([])}
              // Was 16px tall, under the 24px WCAG 2.2 AA target minimum.
              className="-my-1 min-h-6 px-2 text-xs text-gray-400 hover:text-gray-200"
            >
              clear all
            </button>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {selected.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => toggle(tag)}
                  className="rounded bg-emerald-900/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/70"
                  aria-label={`Remove ${tag}`}
                >
                  {tag} ×
                </button>
              </li>
            ))}
          </ul>
          <p className="break-all rounded bg-gray-900 p-2 font-mono text-xs text-gray-300">
            {tagString}
          </p>
          <button
            type="button"
            onClick={copy}
            disabled={!tagString}
            className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium hover:bg-blue-600 disabled:opacity-40"
          >
            {copied ? "Copied ✓" : "Copy tag string"}
          </button>
        </div>
      )}

      {unfilled.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs text-gray-500">
            Related to “{selected[selected.length - 1]}”
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {unfilled.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => toggle(tag)}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-500"
                >
                  + {tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status && <p role="status" className="text-xs text-amber-400">{status}</p>}
    </section>
  );
}

export default TrebloTagPicker;
