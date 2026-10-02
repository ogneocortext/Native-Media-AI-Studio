/**
 * Canonical naming rules for the audio media library.
 *
 * Every selector that lists audio files must agree on two things:
 *
 *  1. **Which files exist.** `GET /api/audio/files` already deduplicates by
 *     display name server-side, so all consumers share one filtered list.
 *  2. **What a file is called.** Uploads are named `<sha256[:8]>_<name>`, and
 *     files re-uploaded under the old uuid scheme accumulated *two or three*
 *     stacked prefixes (e.g. `1bc4ab02_3a2337e6_a19680f6_Learning.mp3`).
 *
 * These rules used to be re-implemented per page, and the copies had drifted:
 * some used `/^([0-9a-f]{8}_)+/` and stripped every prefix, others used
 * `/^[0-9a-f]{8}_[0-9a-f]{8}_/` and required exactly two. The second form
 * stripped *nothing* from a single-prefix name, so 12 of the 58 library rows
 * showed a raw hash in one selector and a clean name in another. One definition
 * here removes that class of inconsistency entirely.
 */

/** Audio container extensions the backend accepts and the UI lists. */
export const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "ogg", "m4a", "wma", "aac"] as const;

/** A single library entry, mirroring the backend's `/api/audio/files` payload. */
export interface AudioLibraryFile {
  filename: string;
  relative_path: string;
  folder: string;
  size_bytes: number;
  modified: number;
}

const EXTENSION_GROUP = `\\.(${AUDIO_EXTENSIONS.join("|")})$`;

/**
 * Strip *every* stacked content-hash prefix.
 *
 * The `+` is the important part: uploads under the legacy uuid scheme can carry
 * two or three prefixes, and a pattern that matches only one or two leaves the
 * rest visible in the UI.
 */
export function stripHashPrefixes(name: string): string {
  return name.replace(/^([0-9a-f]{8}_)+/i, "");
}

/** Strip a leading `hash_` chain from a path, keeping any folder segments. */
export function stripHashPrefixesFromPath(path: string): string {
  return path
    .split("/")
    .map((segment) => stripHashPrefixes(segment))
    .join("/");
}

/** Drop a trailing audio extension. Non-audio files are returned unchanged. */
export function stripAudioExtension(name: string): string {
  return name.replace(new RegExp(EXTENSION_GROUP, "i"), "");
}

/**
 * The human label for a library entry: no folder, no hash prefixes, no
 * extension. This is what every selector should render.
 */
export function audioDisplayName(file: AudioLibraryFile | string): string {
  const raw = typeof file === "string" ? file : file.filename;
  const base = raw.split("/").pop() ?? raw;
  return stripAudioExtension(stripHashPrefixes(base));
}

/**
 * The reference to send to the backend for this entry.
 *
 * `relative_path` is authoritative and folder-aware; bare `filename` is only a
 * fallback because most of this library lives in subdirectories (e.g.
 * `Suno-V6-Mini/track.m4a`) and a bare name 404s on `/api/audio/file/*`.
 */
export function audioRefFor(file: AudioLibraryFile): string {
  return (file.relative_path || file.filename).replace(/\\/g, "/");
}

/** The leading 8-hex content hash, used to disambiguate same-named tracks. */
export function shortHashOf(file: AudioLibraryFile | string): string {
  const raw = typeof file === "string" ? file : file.filename;
  return raw.match(/^[0-9a-f]{8}/i)?.[0] ?? "";
}

/**
 * A display name plus a `[hash]` suffix **only when needed** — that is, when
 * two entries in `all` would otherwise render identically.
 *
 * Rendering the hash unconditionally makes every option noisy; never rendering it
 * makes two distinct tracks indistinguishable, which is exactly the duplicate
 * problem this library is trying to avoid. Comparing against the full set (not
 * just this entry's neighbours) is what keeps the label stable regardless of
 * which selector is asking.
 */
export function audioOptionLabel(file: AudioLibraryFile, all: readonly AudioLibraryFile[]): string {
  // Route through audioEntryLabel, not audioDisplayName: a file whose name is
  // only a hash must be labelled "Unnamed track …" here too, otherwise the
  // disambiguation suffix would be computed against the raw hex and every
  // selector would show a uuid instead of a usable label.
  const display = audioEntryLabel(file);
  const collisions = all.filter((other) => audioEntryLabel(other) === display);
  if (collisions.length < 2) return display;
  const short = shortHashOf(file);
  return short ? `${display} [${short}]` : display;
}

/**
 * Order entries the way the backend returned them (most recently modified
 * first) while guaranteeing no duplicate display names reach a selector.
 *
 * The backend already dedupes, so this is a defensive second gate rather than
 * the primary filter: if a stale backend or a future caller hands us raw rows,
 * the dropdown still shows one entry per track instead of a repeated name.
 */
export function dedupeAudioFiles(files: readonly AudioLibraryFile[]): AudioLibraryFile[] {
  const seen = new Set<string>();
  const out: AudioLibraryFile[] = [];
  for (const file of files) {
    const key = audioDisplayName(file).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

/**
 * A file reference is all these helpers need. The visualizer's `LibraryFile` is
 * a looser shape than the store's `AudioLibraryFile`, so both are accepted —
 * as an object with at least a `filename`, or as a bare string.
 */
export type NameableAudioFile = { filename: string } | string;

/**
 * True when a file's name is *nothing but* a hash — no track title at all.
 *
 * Uploads made before the library had real names are stored as a bare uuid
 * (`ec2c167538d44391af7d14d57fede26d.wav`). Rendering that verbatim shows the
 * user a wall of hex with nothing to choose by, so these get a stable
 * "Unnamed track" label instead.
 *
 * Detection is deliberately strict: it must be the whole basename, so a genuine
 * title that merely starts with 8 hex characters is not mislabelled.
 */
export function isUnnamedFile(file: NameableAudioFile): boolean {
  const raw = typeof file === "string" ? file : file.filename;
  const base = (raw.split("/").pop() ?? raw).replace(new RegExp(EXTENSION_GROUP, "i"), "");
  return /^[0-9a-f]{8}$/i.test(base) || /^[0-9a-f]{32}$/i.test(base);
}

/** Short, stable identifier for an unnamed file so two such rows stay distinct. */
export function unnamedFileLabel(file: NameableAudioFile): string {
  const raw = typeof file === "string" ? file : file.filename;
  const base = (raw.split("/").pop() ?? raw).replace(new RegExp(EXTENSION_GROUP, "i"), "");
  return `Unnamed track ${base.slice(0, 6)}`;
}

/**
 * The label a selector should render, covering the unnamed-file case.
 *
 * Note this does **not** remove duplicates: two byte-identical unnamed files
 * still have different uuids and therefore different labels. Collapsing those
 * requires comparing content, which is a data problem (`tools/`) rather than a
 * rendering one — the UI cannot know two same-sized files are the same audio.
 */
export function audioEntryLabel(file: NameableAudioFile): string {
  if (isUnnamedFile(file)) return unnamedFileLabel(file);
  return typeof file === "string" ? audioDisplayName(file) : audioDisplayName(file as AudioLibraryFile);
}
