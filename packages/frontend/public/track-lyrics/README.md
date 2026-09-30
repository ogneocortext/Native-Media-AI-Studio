# Track Lyrics Library

Structured lyric data for the user's own generated tracks, exposed to the
frontend for kinetic typography work. These tracks have **no LRC files** —
this library is the lyric source of truth until real timed lyrics exist.

Served from `packages/frontend/public/track-lyrics/`, so the app can fetch it
at runtime with no build changes:

```ts
const index = await fetch("/track-lyrics/index.json").then(r => r.json());
const track = await fetch(`/track-lyrics/${index.tracks[0].file}`).then(r => r.json());
```

A typed loader with a `LyricLine[]` converter lives at
`packages/frontend/src/data/trackLyrics.ts`.

## Contents

| id | Title | Lyrics | Source |
|----|-------|--------|--------|
| `rinse-and-repeat` | Rinse and Repeat (V3 preferred) | complete | Suno v6-mini, 130 BPM, 3:29 |
| `human-in-the-loop-v2` | Human in the Loop V2 | complete | Flow Music (Lyria 3.5), 145 BPM, C minor, 4:06 |
| `unproductive-valley-phonk` | Unproductive (Valley Phonk) | complete | Flow Music v1, 136 BPM, 2:47 |
| `ad-nauseam` | Ad Nauseam (V2) | **missing** | Suno v6-mini, 145 BPM — generation record only |

Each track file carries a `provenance` field saying exactly which lyric set it
captures and what it does *not* cover (e.g. the Suno "Unproductive" V2 used a
different cleaned lyric set that was never saved — only the phonk rework is
captured here). Trust `provenance` over assumptions.

## Schema

```jsonc
{
  "id": "rinse-and-repeat",      // stable slug; matches the filename
  "title": "Rinse and Repeat",
  "variant": "V3 (preferred)",   // optional
  "source": "Suno v6-mini",      // generation source
  "bpm": 130,                    // optional
  "key": "C minor",              // optional
  "durationSec": 209,            // rendered length, seconds
  "urls": ["https://suno.com/song/..."], // optional, private links
  "hasLrc": false,               // true once a real .lrc exists for the track
  "lyricsStatus": "complete",    // "complete" | "missing"
  "provenance": "...",           // which lyric set this is, and its limits
  "sections": [                  // [] when lyricsStatus is "missing"
    { "name": "Hook", "lines": ["..."] }
  ]
}
```

`index.json` holds the lightweight manifest (`id`, `title`, `file`,
`lyricsStatus`, `bpm`, `durationSec`, `hasLrc`, `source`) for pickers and lists.

## Timing

There are no per-line timestamps — that is the whole point of this library.
`trackLyrics.ts` converts sections to `LyricLine[]` by distributing lines
evenly across `durationSec`. That timing is **estimated placeholder timing**,
clearly flagged, meant for previewing kinetic typography treatments — not for
final renders. When a real LRC (or Whisper word-timing pass) exists for a
track, it replaces the estimate; set `hasLrc: true` and point at it.

## Adding a track

1. Add `<id>.json` following the schema above (sections in song order,
   lines exactly as sung — no production notes in the lyric text).
2. Add the entry to `index.json`.
3. Keep `provenance` honest: name the source file/session the lyrics came
   from and note any sibling versions it does not represent.
