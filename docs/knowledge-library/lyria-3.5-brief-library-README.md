# Lyria 3.5 Brief Library

Built 2026-10-29. Companion to the [Suno v6 tag library](suno-v6-style-tags.json) — same
idea, opposite shape. Machine-readable copy: `lyria-3.5-brief-library.json` in this folder.

## Why this is prose, not tags

Suno eats comma-separated tag stacks; **Lyria does not.** Google's official Lyria prompt
guide specifies a coherent, prioritized prose brief. Our first Flow runs used Suno grammar
on a Lyria surface and got the house master every time — that was knowledge gap #1 in the
2026-10-29 audit. So this library is **sentence-level building blocks**: each block fills
one slot of the brief skeleton and carries an evidence grade, so a future brief takes
minutes to assemble and never re-buys a lesson.

**Model state (per user ruling, 2026-10-29):** Lyria 3.5 flagship is the current model;
Lyria 3 Pro (legacy menu entry) is outdated and never used. This library targets 3.5 until
Lyria 4.0 ships.

## Evidence grades

- **official** — stated in Google's official Lyria prompt guide or Flow support docs.
- **official+measured** — documented by Google *and* exercised in our runs; the note says
  what actually happened.
- **measured** — verified on our own analyzed takes (analyzer, section pass, vocal
  profile) or the user's ear, Sep–Oct 2026.
- **community** — third-party guides/reviews only.
- **untested** — sourced but never run by us; a hypothesis with a price tag (~5 credits).

## The brief skeleton

> A [length] [genre + era anchor] track. [Mood/energy sentence.] Built on [lead texture],
> [rhythm element], and [accent sounds]. Drums: [drum character]. [Tempo-feel sentence.]
> Lead vocal: [vocal personality sentence]. Sing the lyrics in the Lyrics field verbatim,
> in order. [Structure sentence or timestamped arrangement script.] Production:
> [production sentence]. No [exclusion list].

Lyrics always live in the dedicated Lyrics field with `[Section]` tags — never inside the
brief, and never put instructions in the lyrics (engines sing what they read).

## The blocks (31)

### Genre / era anchors
- **industrial darkwave and EBM in the late-1980s club tradition** — *measured.* Anchor for
  all four Don't Recommend takes; genre identity read correctly every time.
- **retro-futuristic synthwave with an early-1980s analog synth-pop lineage** — *official
  form; unmeasured on Lyria.*
- **Memphis drift phonk** — *measured* (Sep 21 run; same house master as darkwave).
- **dark electronic club music with a cold, mechanical pulse** — *official* generic anchor.

### Mood / energy
- **Urgent, defiant and cold, with propulsive after-midnight energy.** — *measured.*
  Performance reads as asked; mood lands on delivery, not the master.
- **Sardonic and world-weary — deadpan rather than angry.** — *measured.* User judged the
  E1 singer improved with personality written as full sentences.
- **Euphoric and nostalgic, high-energy after midnight.** — *official form.*

### Instrumentation
- **a tight analog bass sequencer playing short, controlled notes** — *official+measured.*
  Texture reads; it does **not** control the sub share (66.8–75.6% across all asks).
- **metallic percussion and factory clang accents** — *measured.*
- **dry, tightly compressed drums with a relentless sequenced pulse** — *measured.* Does
  not rescue overall loudness.
- **analog synth leads and arpeggiated pads in wide stereo** — *official.* Flow stereo
  measured narrow-ish (side/mid 0.177 on E1); width asks unproven.

### Tempo / rhythm
- **a double-time, relentless pulse that pushes forward without letting up** — *measured.*
  Felt pace comes from rhythm language, not numbers.
- **BPM field note** — *measured.* Four takes, three routes (prose, field, script), one
  outcome: **152.0 BPM, zero drift.** Set the field for the record; expect ~152 on dark
  electronic material.

### Vocal
- **a distinctive raspy deep baritone, male, deadpan spoken-sung and sardonic** —
  *measured.* Our most reliable vocal block: every take landed the same low-baritone
  family (median f0 D3–D♯3). E1's singer rated better by the user.
- **dry and close-mic, upfront in the mix, with crisp, intelligible presence** —
  *official+measured.* Delivery reads; the presence band does not move (3.8–4.9%). Fix
  presence in finishing.
- **a clear male tenor, belted on open vowels, wide and bright** — *untested on Lyria.*

### Structure / arrangement
- **Timestamped arrangement template** — *official+measured.* `[mm:ss-mm:ss] Section,
  character, Intensity N/10` appended after the global brief. **The one structural lever
  that measurably worked:** E1 hit a 19.9 dB dynamic range (best of five takes), choruses
  loudest, loudest moment inside Chorus 2, bridge measurably stripped.
- **Intensity curve: verses 7/10, pre-choruses 8/10, choruses 10/10, bridge 8/10, outro
  8/10** — the E1 curve.
- **Edges caveat** — *measured.* E1's intro ignored "full drive from bar one" (quietest
  window of the track) and its outro faded despite a scripted hard stop. Script the edges,
  repeat them in the brief, and verify the first/last 10 seconds of every render.
- **Lyric section tags** — *measured.* Lyrics sung essentially verbatim, in order
  (transcription-verified on the one-shot run).

### Production (read the grades before trusting these)
- **a lean, punchy low end — disciplined sub bass, never boomy** — *official+measured,
  INEFFECTIVE on the master.* Asked four different ways; sub went 66.8 → 67.8 → 67.7 →
  75.6%. Keep it if you like; budget zero expectation. Sub repair = Ableton on stems.
- **a bright, detailed top end and a loud, punchy modern master** — *official+measured,
  INEFFECTIVE.* Presence stayed 3.8–4.9%; RMS fell across the series. Loudness is a
  finishing step (see ceilings).
- **No cavernous reverb, no autotune, no EDM drops, no ballad passages, no fade-out.** —
  closing exclusion sentence. Mostly honored; E1's outro faded anyway.

### Negative prompt (API parameter; Flow route untested)
- **boomy sub bass, muddy low end, buried vocal, dark muffled master** — *untested.*
  `negative_prompt` is a real Lyria parameter (official guide); no confirmed Flow UI
  field — Producer chat is the plausible route. Targets our measured flaws verbatim.
- **excessive cymbal crashes, distorted clipping, tempo drift** — *official-style*
  examples.

### Producer loop
- **One variable per revision; the Producer's confirmation text is a claim, not
  evidence** — *measured.* Exp B confirmed three fixes in words; meters showed loudness
  only (+1.3 dB). The user's ear heard improvement — verify with ears *and* meters and
  say which one moved.
- **Exp B revision phrasing** (tighten low end / vocal drier-closer-upfront / lift
  brightness+loudness / change nothing else) — the strongest single revision turn on
  record.
- **Standing Producer Instructions** (Settings → Customize producer) — *untested.*
  Playbook experiment E3; park the standing asks there once instead of per-brief.

### Compose controls (guidance blocks)
- **Fields:** BPM 158 · Length 3:00 · reuse one seed across a song's variants (291029
  served Exp A and E1). Length is approximate — 3:00 rendered 2:55–2:59 four times.
- **Downloads:** WAV when offered (M4A/MP3/WAV observed); stems free, `.m4a`. The song
  page may show "No lyrics" even when lyrics were sung — observed twice; trust the audio.
- **Surfaces:** Compose = control (one take). Chat/Producer = sampling (reported two
  takes per request) and revisions; tempo lives in prose only there.

## Known ceilings (measured, five takes)

| | Suno V1 | Flow one-shot | Exp A | Exp B | E1 |
|---|---|---|---|---|---|
| Tempo (152 asked as 158) | 143.6 | 152.0 | 152.0 | 152.0 | 152.0 |
| Sub % | 53.9 | 66.8 | 67.8 | 67.7 | **75.6** |
| Presence % | 7.0 | 4.2 | 4.9 | 4.7 | 3.8 |
| RMS dBFS | −15.5 | −16.9 | −19.5 | −18.2 | −19.6 |
| Dynamic range dB | 11.7 | 17.0 | 15.8 | 14.5 | **19.9** |
| Key (F minor asked) | F min ✓ | ~D♯ | G min/D maj | D maj/G min | D maj |

1. **Tempo lock:** 152.0 on every Flow take, zero drift, whatever we asked.
2. **House master:** sub 66.8–75.6%, presence 3.8–4.9% on dark electronic material, across
   every prompting surface. Ableton/stem finishing is mandatory.
3. **Keys:** F minor requested 3×, landed 0×. Never build a brief that depends on a key.
4. **Quiet masters:** RMS fell across the series while peaks stayed ~0 dBFS — the takes
   are dynamic, not clipped-quiet. **Loudness-match (−14 LUFS) before judging any take:**
   louder reads as better, and the user's "noticeably louder, wow" on the matched E1 copy
   is the proof.
5. **What did move:** arrangement scripting (dynamics), a Producer revision (loudness +
   ear-judged quality), vocal personality prose (voice family, every time).

## Assembly checklist

1. Genre/era anchor + mood sentence first; keep the brief in skeleton order.
2. Vocal as a full personality sentence, never adjectives alone.
3. Rhythm-feel language for pace; BPM field set for the record.
4. Keeper attempts get the timestamped script + intensity curve; script the edges, then
   check the first/last 10 seconds after the render.
5. One production sentence + one exclusion sentence — with zero expectation they move the
   master.
6. Reuse the seed across variants; download WAV + stems; loudness-match listening copies
   before judging.
7. Plan the finish at brief time: stems → Ableton (sub discipline, presence lift,
   loudness). Prompting will not do this part.

## Sources

- Google Cloud official Lyria prompt guide (updated 2026-10-28) — brief structure,
  detailed-structure timestamp workflow, `negative_prompt`.
- Google Flow support docs — Producer personalization and tiers.
- Own measured runs, Sep 21 + Oct 29 2026 — data in `~/workspace/audio-analysis/output/`
  and `flow-compare/`; narrative in `lyria-improvement-playbook-2026-10-29.md` and
  `lyria-knowledge-gaps-2026-10-29.md` in that folder.
- User ear verdicts, Oct 29 2026 (Exp B, E1, loudness-matched E1 copy).

*Maintenance rule: when Lyria 4.0 ships, re-run one known song through this library's
skeleton before trusting any block's grade — the ceilings table is 3.5-specific.*
