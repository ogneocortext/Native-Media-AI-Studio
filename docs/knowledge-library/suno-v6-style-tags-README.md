---
tags:
  - research
  - audio
aliases:
  - Suno v6 Style-Tag Library
cssclasses:
  - research-guide
date: 2026-10-26
type: concept
---

# Suno v6 Style-Tag Library

A curated, deduplicated library of Suno style descriptors and lyric metatags, compiled 2026-10-26 from three community sources:

- **suno-band-manager** (zarlor) — `model-prompt-strategies.md`: v6-family guidance, a community-confirmed descriptor→effect table, and universal prompt rules (several production- or measurement-backed).
- **2suno-band-manager** (melbazpeach-source) — `metatag-reference.md`: section/delivery/effects metatags with reliability tiers from HookGenius testing (300+ tags; 1000+ prompt analysis).
- **Suno User Guide** (the-quiet-hours) — §5.7, a compact vocabulary drawn from Suno's own glossary.

Every effect note in `library.json` comes from one of these sources — nothing is invented. Confidence: **community-verified** (multiple users, production testing, or measurement in the sources), **documented** (Suno's glossary or an established entry in a maintained guide), **anecdotal** (single report, or tested only on retired v5/v5.5 and flagged "re-test on v6").

Companion library: [[lyria-3.5-brief-library-README]] — the Lyria 3.5 side
(prose brief blocks with measured grades, not tag stacks).

## Counts

| Category | Tags |
| --- | --- |
| vocals | 28 |
| structure_metatags | 23 |
| production | 20 |
| rhythm_pacing | 19 |
| genre_mood | 17 |
| instruments | 15 |
| **Total** | **122** |

By confidence: 66 community-verified, 47 documented, 9 anecdotal.

## Top 10 tags for fighting sameness

The failure mode: consecutive tracks that differ only in lyrics — same voice, same pacing, same instruments. These ten attack those three axes hardest:

1. **`double-time driving`** (rhythm_pacing) — a rhythm noun; locks a double-time driving drum feel far more reliably than any BPM number.
2. **`halftime groove`** (rhythm_pacing) — the opposite pacing pole from #1; alternating the two guarantees back-to-back tracks never share a feel.
3. **`breakbeat`** (rhythm_pacing) — a third, unmistakably different drum pattern Suno can actually interpret.
4. **`[Raspy]`** (vocals) — HIGH-reliability vocal identity switch; rough texture reads instantly as a different singer.
5. **`[Breathy]`** (vocals) — HIGH-reliability; the airy opposite pole to [Raspy] and [Powerful].
6. **`[Powerful]`** (vocals) — HIGH-reliability full-force delivery; a third distinct vocal identity.
7. **`[Stacked Harmonies]`** (vocals) — dense layered harmonies change the whole vocal architecture of a track, not just the lead.
8. **`vintage Rhodes`** (instruments) — hyper-specific instrument naming beats generic "piano" and re-anchors the palette around a recognizable timbre.
9. **`gated drums`** (instruments) — an era-defining drum production sound; the kit itself becomes a differentiator.
10. **`lo-fi warmth`** (production) — vintage character + low-pass filtering; swapping it against `polished radio-ready` or `atmospheric` changes the entire sonic fingerprint of the mix.

Honorable mechanics (not tags, but they multiply the ten above): front-load genre/mood/vocals in the first ~200 characters of the style prompt (word order is weighted), keep descriptors to roughly 5–8 (fewer goes generic, more than ~10 conflicts), and vary **lyric density** — packed lines feel faster, fragmented lines feel slower, because Suno's underlying tempo never actually changes inside a song.

## Caution list — tags and habits the sources warn against

- **BPM numbers as a spec** — treated as a ballpark at best. Librosa-measured: songs tagged 60 BPM delivered at 95.7 BPM; a set 92 BPM came back at 124. Pace words and rhythm nouns outperform numbers. **Bracketed BPM** in the style field is explicitly debunked — brackets belong to structure tags in the lyrics field.
- **`[Stop]`** — Suno *vocalizes* it: it sings/yells the word "Stop" instead of stopping. Never use it for ending control; use `[End]` (and expect up to 5–15s of trailing instrumental anyway).
- **Invented section tags** (e.g. `[The Questions]`, `[Reflection]`) — not recognized; at best ignored, at worst **sung as lyrics**.
- **Narrative labels inside section tags** (`[VERSE 1 — THE ROOM]`) — no generation signal; may be sung. Put functional direction in the tag instead (`[Verse 1: hushed, tense]`).
- **`[Falsetto]`, `[Growling]`, `[Yodeling]`** — LOW reliability in testing; often ignored entirely. For falsetto, style-prompt phrasing ("natural falsetto, airy high register, effortless") is more consistent.
- **Bare `[Intro]`** — notoriously unreliable. Use `[Instrumental Intro]` when you need a vocal-free opening.
- **Inline negatives on v6** ("no drums" in the style prompt) — v6 reads negation as inclusion (VENDOR ×2 + COMMUNITY). Every negative goes in the **Exclude Styles** field.
- **Odd time signatures in 4/4 rock/metal** — consistently ignored; the genre's 4/4 pull overrides the instruction.
- **Structural directions buried in the style prompt** — largely ignored. Suno treats the style prompt as a tonal palette, not a roadmap; structure belongs in lyric metatags and the editor.
- **Conflicting descriptors** ("aggressive, peaceful") — opposing tags cancel into a bland generic middle, not an interesting hybrid.
- **Grit words near the vocal** ("grit", "gravel", "rasp") — they roughen a saved Voice wherever they appear; attach them to instruments instead. And `[Vocal Style: gritty]` + high energy + high Weirdness produces screaming even with screaming in Exclude Styles.
- **`raw live recording`** and its family — the confirmed-descriptor table says use `unpolished room sound` / `natural room ambience` instead.
- **Dual-voice shortcuts** — `[Duet]` alone, `[Voice 1]`/`[Voice 2]`, `[Male Vocal 1]`/`[Male Vocal 2]`, `[Lead Vocal]`/`[Response Vocal]`, and "dual vocals trading" in the style prompt are all ignored or collapse to one timbre; describing two equal vocalists makes the model average them into one voice. A Persona also fights vocal variation by design — turn it off for dual-voice attempts.
- **Artist names in style prompts** — stripped by Suno policy (OFFICIAL). Decompose the sound (tempo, vocals, instruments, production, mood) or use era descriptors ("late 70s disco") instead.
- **"Tempo changes" as a tempo instruction** — production-confirmed (librosa): the underlying BPM stays constant; what changes is arrangement density. Plan one tempo per song and vary feel with rhythm nouns and lyric density.
- **v6 weak spots to route around** — late-song degradation (muffled mix, tinny cymbals, synthetic drums) past ~2–4 minutes, worst in rock/metal; and narrower genre reach — metal/high-gain guitar, DnB/EDM, reggae skank, Italo disco, and glam are the most-reported failures, while pop, lighter rock, and folk are the strongest.
