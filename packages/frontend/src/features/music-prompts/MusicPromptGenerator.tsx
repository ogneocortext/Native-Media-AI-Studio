import { useEffect, useId, useState } from "react";
import { Loader2, Music4, Copy, Check, Sparkles } from "lucide-react";
import { Card } from "../../components/common";
import { getApiBase } from "../../services/api";

type PlatformId = "suno_v6" | "minimax_30" | "happyshrimp_10" | "lyria_35";

interface PlatformSpec {
  label: string;
  engine: string;
  formula?: string;
  rules?: string[];
}

interface GenResult {
  title: string;
  style: string;
  prompt: string;
  exclude: string;
  lyrics: string;
  settings: Record<string, unknown>;
  notes: string[];
  warnings: string[];
  platform: string;
  model_used: string;
  title_chars?: number;
  title_limit?: number | null;
  style_chars?: number;
  style_limit?: number | null;
  exclude_chars?: number;
  prompt_chars?: number;
  lyrics_chars?: number;
  prompt_limit?: number | null;
  lyrics_limit?: number | null;
}

interface PresetEntry {
  id: string;
  name: string;
  description: string;
  tags: string[];
  form_values: Record<string, string | boolean | number>;
}

interface PresetsResponse {
  presets: Record<string, PresetEntry[]>;
  meta: {
    count: number;
    platforms: string[];
  };
}

const PLATFORM_FALLBACK: Record<PlatformId, string> = {
  suno_v6: "Tags: Genre+Era, Mood, 2-3 instruments, vocal, production. 5-8 descriptors.",
  minimax_30: "Sentences + Structured Caption. Include 2-3 arrangement events.",
  happyshrimp_10: "Natural-language scene: use-case + mood + world + progression + performance.",
  lyria_35: "Lyria 3.5 (lyria-3.5): singer profile + duration + Lyrics: block. Clip=30s, full=~2-3min.",
};

const LABELS: Record<PlatformId, string> = {
  suno_v6: "Suno v6",
  minimax_30: "MiniMax 3.0",
  happyshrimp_10: "HappyShrimp 1.0",
  lyria_35: "Lyria 3.5 Pro",
};

function Count({ value, limit }: { value: number; limit?: number | null }) {
  if (!limit) return <span className="text-xs text-white/40">{value} chars</span>;
  const over = value > limit;
  return (
    <span className={`text-xs ${over ? "text-amber-300 font-semibold" : "text-white/40"}`}>
      {value}/{limit} chars{over ? " — over limit, trim before pasting" : ""}
    </span>
  );
}

export function MusicPromptGenerator() {
  const formId = useId();
  const themeId = `${formId}-theme`;
  const genreId = `${formId}-genre`;
  const moodId = `${formId}-mood`;
  const tempoId = `${formId}-tempo`;
  const keySigId = `${formId}-keySig`;
  const vocalId = `${formId}-vocal`;
  const instrumentsId = `${formId}-instruments`;
  const languageId = `${formId}-language`;
  const dialectId = `${formId}-dialect`;
  const lyricStyleId = `${formId}-lyricStyle`;
  const trickyWordsId = `${formId}-trickyWords`;
  const durationId = `${formId}-duration`;
  const excludeId = `${formId}-exclude`;
  const useCaseId = `${formId}-useCase`;
  const modelId = `${formId}-model`;
  const errorId = `${formId}-error`;
  const helperId = `${formId}-helper`;

  const [platform, setPlatform] = useState<PlatformId>("suno_v6");
  const [specs, setSpecs] = useState<Record<string, PlatformSpec> | null>(null);
  const [lyricTechniques, setLyricTechniques] = useState<Record<string, { techniques: string[]; vocal_delivery?: string }> | null>(null);
  const [presets, setPresets] = useState<PresetsResponse | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [tempo, setTempo] = useState("");
  const [vocal, setVocal] = useState("");
  const [instruments, setInstruments] = useState("");
  const [language, setLanguage] = useState("English");
  const [dialect, setDialect] = useState("General American");
  const [trickyWords, setTrickyWords] = useState("");
  const [duration, setDuration] = useState("");
  const [exclude, setExclude] = useState("");
  const [useCase, setUseCase] = useState("");
  const [keySig, setKeySig] = useState("");
  const [lyricStyle, setLyricStyle] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const [model, setModel] = useState("qwen3.5:9b");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showTechniqueModal, setShowTechniqueModal] = useState(false);

  const reset = () => {
    setTheme("");
    setGenre("");
    setMood("");
    setTempo("");
    setVocal("");
    setInstruments("");
    setLanguage("English");
    setDialect("General American");
    setTrickyWords("");
    setDuration("");
    setExclude("");
    setUseCase("");
    setKeySig("");
    setLyricStyle("");
    setInstrumental(false);
    setTimeline(false);
    setResult(null);
    setError(null);
    setCopied(null);
    setShowTechniqueModal(false);
    setSelectedPresetId("");
  };

  const applyPreset = (preset: PresetEntry) => {
    const v = preset.form_values;
    if (v.theme !== undefined) setTheme(String(v.theme));
    if (v.genre !== undefined) setGenre(String(v.genre));
    if (v.mood !== undefined) setMood(String(v.mood));
    if (v.tempo !== undefined) setTempo(String(v.tempo));
    if (v.vocal !== undefined) setVocal(String(v.vocal));
    if (v.instruments !== undefined) setInstruments(String(v.instruments));
    if (v.language !== undefined) setLanguage(String(v.language));
    if (v.dialect !== undefined) setDialect(String(v.dialect));
    if (v.tricky_words !== undefined) setTrickyWords(String(v.tricky_words));
    if (v.duration !== undefined) setDuration(String(v.duration));
    if (v.exclude !== undefined) setExclude(String(v.exclude));
    if (v.use_case !== undefined) setUseCase(String(v.use_case));
    if (v.key !== undefined) setKeySig(String(v.key));
    if (v.lyric_style !== undefined) setLyricStyle(String(v.lyric_style));
    if (v.instrumental !== undefined) setInstrumental(Boolean(v.instrumental));
    if (v.timeline !== undefined) setTimeline(Boolean(v.timeline));
    setSelectedPresetId(preset.id);
    setResult(null);
    setError(null);
  };

  useEffect(() => {
    fetch(`${getApiBase()}/api/music-prompts/templates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.default_model) setModel(d.default_model);
        if (d?.platforms) setSpecs(d.platforms);
        if (d?.lyric_techniques) setLyricTechniques(d.lyric_techniques);
      })
      .catch(() => {});
    fetch(`${getApiBase()}/api/music-prompts/presets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.presets) setPresets(d);
      })
      .catch(() => {});
  }, []);

  const generate = async () => {
    if (!theme.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const res = await fetch(`${getApiBase()}/api/music-prompts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          platform,
          model,
          brief: {
            theme, genre, mood, tempo, key: keySig, vocal, instruments, language, dialect,
            tricky_words: trickyWords, duration,
            exclude, use_case: useCase, instrumental, timeline,
            lyric_style: lyricStyle,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Generation failed");
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError" ? "Timed out after 120s — is Ollama running?" : e instanceof Error ? e.message : "Generation failed");
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await generate();
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const spec = specs?.[platform];
  const hint = spec?.formula ?? PLATFORM_FALLBACK[platform];

  const inputCls =
    "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Music4 size={24} className="text-violet-400" />
        <h1 className="text-2xl font-bold">Music Prompt Generator</h1>
      </div>
      <p className="text-sm text-muted mb-1">
        Local <span className="text-white/80">{model || "qwen3.5:9b"}</span> writes copy-paste prompts + lyrics tuned per engine. {hint}
      </p>
      {spec?.engine && <p className="text-xs text-white/40 mb-4">{spec.engine}</p>}

      <form id={formId} onSubmit={handleSubmit} noValidate className="contents">
      <Card className="p-4 mb-4">
        <fieldset className="border-0 p-0 m-0">
          <legend className="text-sm font-medium text-white/70 mb-3">Engine</legend>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {(Object.keys(LABELS) as PlatformId[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                  platform === p
                    ? "bg-violet-600 border-violet-500 text-white ring-2 ring-violet-400"
                    : "bg-white/5 border-white/10 text-white/70 hover:border-white/25"
                }`}
                aria-pressed={platform === p}
              >
                {LABELS[p]}
              </button>
            ))}
          </div>
        </fieldset>
        {presets && (
          <div className="mb-4">
            <label htmlFor={`${formId}-preset`} className="block text-xs text-white/50 mb-1">Preset formula — pre-fills the form below</label>
            <select
              id={`${formId}-preset`}
              value={selectedPresetId}
              onChange={(e) => {
                const pid = e.target.value;
                if (!pid) return;
                const all = Object.values(presets.presets).flat();
                const found = all.find((pr) => pr.id === pid);
                if (found) applyPreset(found);
              }}
              className={`${inputCls} max-w-full`}
            >
              <option value="">— select a preset —</option>
              {Object.entries(presets.presets).map(([plat, list]) => (
                <optgroup key={plat} label={LABELS[plat as PlatformId] ?? plat}>
                  {list.map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.name} — {pr.description}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[11px] text-white/35 mt-1">
              Compiled from community formulas + official docs (Suno v6, MiniMax 3.0, HappyShrimp 1.0, Lyria 3.5).
            </p>
          </div>
        )}
        {spec?.rules && (
          <ul className="mb-4 space-y-1">
            {spec.rules.slice(0, 3).map((r, i) => (
              <li key={i} className="text-xs text-white/50">• {r}</li>
            ))}
          </ul>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label htmlFor={themeId} className="sr-only">Theme / story / scene</label>
            <textarea
              id={themeId}
              className={`${inputCls} min-h-20`}
              placeholder="Theme / story / scene *"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={[helperId, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor={genreId} className="sr-only">Genre</label>
            <input id={genreId} className={inputCls} placeholder="Genre (e.g. melodic techno, alt R&B)" value={genre} onChange={(e) => setGenre(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={moodId} className="sr-only">Mood</label>
            <input id={moodId} className={inputCls} placeholder="Mood (e.g. melancholic yet defiant)" value={mood} onChange={(e) => setMood(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={tempoId} className="sr-only">Tempo</label>
            <input id={tempoId} className={inputCls} placeholder="Tempo (e.g. 124 BPM, driving)" value={tempo} onChange={(e) => setTempo(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={keySigId} className="sr-only">Key</label>
            <input id={keySigId} className={inputCls} placeholder="Key (e.g. G major, D minor)" value={keySig} onChange={(e) => setKeySig(e.target.value)} autoComplete="off" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor={vocalId} className="sr-only">Vocal</label>
            <input id={vocalId} className={inputCls} placeholder="Vocal (e.g. breathy female soprano)" value={vocal} onChange={(e) => setVocal(e.target.value)} autoComplete="off" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor={instrumentsId} className="sr-only">Instruments</label>
            <input id={instrumentsId} className={inputCls} placeholder="Instruments (e.g. analog bass, brushed drums)" value={instruments} onChange={(e) => setInstruments(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={languageId} className="sr-only">Language</label>
            <input id={languageId} className={inputCls} placeholder="Language" value={language} onChange={(e) => setLanguage(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={dialectId} className="sr-only">Sung dialect</label>
            <input id={dialectId} className={inputCls} placeholder="Sung dialect" value={dialect} onChange={(e) => setDialect(e.target.value)} list="music-prompt-dialects" autoComplete="off" />
            <datalist id="music-prompt-dialects">
              <option value="General American" />
              <option value="Southern American" />
              <option value="AAVE" />
              <option value="Midwestern American" />
              <option value="New York American" />
            </datalist>
          </div>
          <div className="md:col-span-2">
            <label htmlFor={lyricStyleId} className="sr-only">Lyric style / technique</label>
            <div className="flex items-center gap-2">
              <input id={lyricStyleId} className={inputCls} placeholder="Lyric style (e.g. melodic dubstep, electro-pop, indie electronic, uk grime, future bass, deep dubstep)" value={lyricStyle} onChange={(e) => setLyricStyle(e.target.value)} list="music-prompt-lyric-styles" autoComplete="off" />
              <button type="button" onClick={() => setShowTechniqueModal(true)} className="text-xs text-violet-300 hover:text-violet-200 border border-violet-500/30 rounded-lg px-2 py-1.5 shrink-0">Techniques</button>
            </div>
            <datalist id="music-prompt-lyric-styles">
              <option value="melodic dubstep" />
              <option value="psychedelic bass" />
              <option value="electro-pop" />
              <option value="cinematic bass" />
              <option value="indie electronic" />
              <option value="future bass" />
              <option value="deep dubstep" />
              <option value="noir trip-hop" />
              <option value="uk grime" />
              <option value="future garage" />
              <option value="melodic rap" />
              <option value="alt R&B" />
              <option value="phonk" />
              <option value="pop" />
              <option value="drill" />
              <option value="afrobeat" />
              <option value="country" />
              <option value="latin" />
              <option value="indie folk" />
              <option value="edm" />
              <option value="poetic" />
              <option value="conversational" />
              <option value="storytelling" />
              <option value="minimal" />
              <option value="fragmented" />
              <option value="narrative" />
            </datalist>
          </div>
          <div className="md:col-span-2">
            <label htmlFor={trickyWordsId} className="sr-only">Words that stumbled before</label>
            <textarea id={trickyWordsId} className={`${inputCls} min-h-[4rem]`} placeholder="Words that stumbled before (comma-separated — model respells or replaces them)" value={trickyWords} onChange={(e) => setTrickyWords(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={durationId} className="sr-only">Duration</label>
            <input id={durationId} className={inputCls} placeholder="Duration (e.g. 2-minute song)" value={duration} onChange={(e) => setDuration(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={excludeId} className="sr-only">Exclude</label>
            <textarea id={excludeId} className={`${inputCls} min-h-[4rem]`} placeholder="Exclude (Suno: no autotune, no EDM drop)" value={exclude} onChange={(e) => setExclude(e.target.value)} autoComplete="off" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor={useCaseId} className="sr-only">Use case</label>
            <textarea id={useCaseId} className={`${inputCls} min-h-[4rem]`} placeholder="Use case (e.g. steady loop for study video, no big drops)" value={useCase} onChange={(e) => setUseCase(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-3">
          <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
            <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} className="accent-violet-500" />
            Instrumental (no vocals)
          </label>
          {platform === "lyria_35" && (
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input type="checkbox" checked={timeline} onChange={(e) => setTimeline(e.target.checked)} className="accent-violet-500" />
              Timestamp timeline (for video scoring)
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <div className="flex items-center gap-2">
            <label htmlFor={modelId} className="sr-only">Ollama model</label>
            <input id={modelId} className={`${inputCls} max-w-48`} placeholder="Ollama model" value={model} onChange={(e) => setModel(e.target.value)} list="music-prompt-models" autoComplete="off" />
            <datalist id="music-prompt-models">
              <option value="qwen3.5:9b" />
              <option value="qwen3.5:4b" />
              <option value="ornith-1.5:9b" />
            </datalist>
          </div>
          <button
            type="submit"
            disabled={!theme.trim() || loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? "Generating…" : "Generate"}
          </button>
          {!theme.trim() && !loading && (
            <span id={helperId} className="text-xs text-white/40">Enter a theme to enable generation</span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={reset}
            className="text-xs text-white/50 hover:text-white border border-white/10 rounded-lg px-3 py-2"
          >
            Reset
          </button>
        </div>
        {error && (
          <div id={errorId} role="alert" className="mt-3 flex items-center gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button
              type="button"
              onClick={generate}
              className="text-xs text-violet-300 hover:text-violet-200 border border-violet-500/30 rounded-lg px-3 py-1.5"
            >
              Retry
            </button>
          </div>
        )}
      </Card>
      </form>

      {result && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm">Title</h2>
              <button type="button" onClick={() => copy("title", result.title ?? "")} className="text-white/60 hover:text-white" aria-label="Copy title">
                {copied === "title" ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-sm text-white/85">{result.title || "(empty)"}</p>
            <div className="mt-2"><Count value={result.title_chars ?? (result.title ?? "").length} limit={result.title_limit} /></div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm">Style — paste into {LABELS[platform]}</h2>
              <button type="button" onClick={() => copy("style", result.style ?? result.prompt ?? "")} className="text-white/60 hover:text-white" aria-label="Copy style">
                {copied === "style" ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-white/85 max-h-96 overflow-auto">{(result.style ?? result.prompt) || "(empty)"}</pre>
            <div className="mt-2"><Count value={result.style_chars ?? result.prompt_chars ?? (result.style ?? result.prompt ?? "").length} limit={result.style_limit ?? result.prompt_limit} /></div>
          </Card>
          {platform !== "lyria_35" && platform !== "happyshrimp_10" && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-sm">Exclude — {platform === "suno_v6" ? "Suno Exclude Styles" : "things to avoid"}</h2>
                <button type="button" onClick={() => copy("exclude", result.exclude ?? "")} className="text-white/60 hover:text-white" aria-label="Copy exclude">
                  {copied === "exclude" ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-white/85 max-h-96 overflow-auto">{result.exclude || "(empty — nothing to avoid)"}</pre>
            </Card>
          )}
          <Card className="p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm">Lyrics — with section tags</h2>
              <button type="button" onClick={() => copy("lyrics", result.lyrics)} className="text-white/60 hover:text-white" aria-label="Copy lyrics">
                {copied === "lyrics" ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-white/85 max-h-96 overflow-auto">{result.lyrics || "(empty)"}</pre>
            <div className="mt-2"><Count value={result.lyrics_chars ?? result.lyrics.length} limit={result.lyrics_limit} /></div>
          </Card>
          <Card className="p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm">
                Settings — {platform === "suno_v6" ? "sliders + model pick (set in Suno Advanced Options)" : platform === "minimax_30" ? "API flags (lyrics_optimizer, is_instrumental, audio_setting)" : platform === "lyria_35" ? "model + format" : "mode"}
              </h2>
              <button type="button" onClick={() => copy("settings", JSON.stringify(result.settings ?? {}, null, 2))} className="text-white/60 hover:text-white" aria-label="Copy settings">
                {copied === "settings" ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            {result.settings && Object.keys(result.settings).length > 0 ? (
              <dl className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                {Object.entries(result.settings).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-sm">
                    <dt className="text-white/40 shrink-0">{k}:</dt>
                    <dd className="text-white/85">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-white/40">(no settings returned)</p>
            )}
          </Card>
          <Card className="p-4 md:col-span-2">
            <button
              type="button"
              onClick={() => copy("all", [result.title, result.style ?? result.prompt, result.exclude, result.lyrics].filter(Boolean).join("\n\n"))}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-white/25 text-xs mb-2"
            >
              {copied === "all" ? <Check size={14} /> : <Copy size={14} />} Copy all sections
            </button>
            {(result.warnings ?? []).map((w, i) => (
              <p key={`w${i}`} className="text-xs text-amber-300/90">⚠ {w}</p>
            ))}
            {(result.notes ?? []).map((n, i) => (
              <p key={`n${i}`} className="text-xs text-white/60">• {n}</p>
            ))}
            <p className="text-xs text-white/40 mt-2">Model: {result.model_used}</p>
          </Card>
        </div>
      )}
      {showTechniqueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowTechniqueModal(false)}>
          <div className="bg-neutral-900 border border-white/10 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h3 className="text-sm font-semibold">2026 Lyric Writing Techniques</h3>
              <button type="button" onClick={() => setShowTechniqueModal(false)} className="text-white/60 hover:text-white text-xs">Close</button>
            </div>
            <div className="p-4 space-y-4">
              {lyricTechniques ? (
                Object.entries(lyricTechniques).map(([key, entry]) => (
                  <div key={key} className="text-sm">
                    <h4 className="font-medium text-white/90 mb-1">{key}</h4>
                    <ul className="space-y-1 text-white/70 mb-1">
                      {(entry.techniques || []).map((t, i) => (
                        <li key={i} className="list-disc ml-4">• {t}</li>
                      ))}
                    </ul>
                    {entry.vocal_delivery && <p className="text-white/50 italic">Vocal delivery: {entry.vocal_delivery}</p>}
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/50">Technique reference not loaded. Check backend connectivity.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
