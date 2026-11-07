---
title: "Tracker Pattern Craft — What a Proper Pattern Looks Like 2026"
date: 2026-11-07
type: concept
tags:
  - production
  - audio
aliases:
  - Tracker Pattern Craft 2026
  - Pattern Craft
cssclasses:
  - knowledge-note
---

# Tracker Pattern Craft — What a Proper Pattern Looks Like (2026)

> Companion to [[media-anti-patterns-2026]]: that canon names the slop; this doc names the craft it replaces, for the chiptune generator (T-MUS-06). Distilled 2026-11-07 from the FamiTracker manual, the Furnace documentation, the OpenMPT manual, and the NESdev Wiki, plus convergent tracker tutorials and worked track analyses (full sourced report in Orion's research notes, studied privately per the external-sources policy; no external text reproduced here). Motivated by three sandbox renders the owner rejected in one night (jingle, wall, pattern-less noise) — every failure maps to a rule below.

## 1. The grid

- A **pattern** is rows (time, top to bottom) × channels; each cell holds at most **one note** plus instrument, volume, and one effect. Chords inside a single channel do not exist.
- Two pattern models exist. MOD/ProTracker lineage: one pattern = **all channels together, 64 rows**. FamiTracker/Furnace: a pattern is **one channel only**; a *frame* (FT) / *order* (Furnace) is the set of per-channel patterns played together. Either way, **64 rows = 4 bars of 4/4** (16 rows per bar, 4 rows per beat, row = a 16th note) is the default unit.
- Under the grid sit **ticks**: effects and envelopes run per tick; **speed** = ticks per row. Canonical FamiTracker settings: **speed 6, tempo 150** (BPM = 6 × Tempo ÷ Speed), one 64-row order ≈ 6.4 seconds.
- Songs are **order lists that reuse pattern numbers**. Reuse is the mechanism of the whole form: editing a reused pattern changes every occurrence, so a *variation is a clone*, never a quiet edit.

## 2. Channel discipline (NES)

- Roles are fixed per song: **Pulse 1 lead · Pulse 2 harmony / counter-melody / arpeggio / echo · Triangle bass · Noise drums · DPCM sampled drums (or sampled bass)**. The Super Mario Bros. Ground Theme is the textbook split.
- **Triangle has no volume control** — on or off only; shape it with note lengths and rests. It also sounds **one octave below** a pulse note at the same written pitch. Real bass lines *move*: walking figures, root→5th→octave motion, gated short notes. (The one loudness workaround is DPCM Zxx ducking.)
- **Noise is a fixed kit of 2–5 sounds used identically all song**: low pitch + fast decay = kick, mid pitch + pitch-drop = snare, high + very short = hat. Per 16-row bar: **kick on rows 0 and 8, snare on 4 and 12, hats on 8ths**; fills only in a phrase's last bar.
- **DPCM**: samples up to 4081 bytes, **no volume column and no pitch/volume effects** (only W/X/Y/Z controls), and playing it ducks the triangle and noise channels. Normal use is sampled drums; the famous Sunsoft inversion (Journey to Silius) uses DPCM for sampled *bass* and the triangle as a pitch-dropping kick.

## 3. Inside the pattern — where the music actually is

- **Motif first, and short**: a **2-bar motif of 2–4 distinctive notes**, repeated with variation. Within a 4-bar pattern, bars 3–4 repeat bars 1–2 with **only the ending changed** (a cadence note, a register lift, a rhythmic fill). Across patterns, change **one channel or one element at a time**. Working rule: roughly **75% literal repetition per phrase, change concentrated at phrase endings**. NES form generally is nested loops and transpositional sequences — restating a motive at a new pitch level *is* development.
- **Call-and-response is the default texture**: Pulse 2 answers, echoes, or sustains **in Pulse 1's gaps** rather than competing with it; melodic counterpoint between the two pulses is a defining technique of the repertoire.
- **Silence is structural.** The SMB opening lead — E5 E5 (rest) E5 (rest) C5 E5 (rest) G5 (long rest) G4 — is about **one-third rests**, and its identity is that rhythm of attacks and gaps. Derived density guidance for a 64-row pattern (see the caveat in §6): lead ≈ **16–32 onsets with rests in every bar**; bass ≈ 16–32 gated onsets; harmony sparser than the lead unless arpeggiating; **never all channels at maximum density at once** — in any bar, at least one channel rests or sustains.
- **Register separation**: lead within ~1½ octaves in the mid-upper register; harmony a 3rd/6th below it or an octave down; sounding bass ~2 octaves below the lead. The stated fix for clutter is mechanical: **move one part an octave**. Sustained same-pitch unison between the pulses is a defect, not a texture (the offset echo and deliberate attacks excepted).
- **The exception**: Tim Follin's *Silver Surfer* is celebrated precisely for breaking the density rules — hyper-dense single-channel polyphony illusion (low note, octave-up blip, return), pulse 2 arpeggiating chords, noise+triangle combined drums, no DPCM. It is virtuoso headroom, not the training target. Train on Mario / Mega Man density — *Dr. Wily Stage 1* gets its drive from the repetition rate of a tiny 3-note cell, not from new notes.

## 4. Echo and effects — the musicianship layer

- **Fake echo**: Pulse 2 (or in-gap repeats inside the lead channel) plays the lead phrase **delayed 3 or 6 rows at ¼–½ volume** (first layer ~25–50%, halving per layer), optionally slightly detuned and with a **softer duty than the lead** (lead 25% → echo 50%). There are no reverb or delay objects on the chip; this *is* the reverb.
- **Arpeggio (`0xy`) is a chord, not a texture**: cycles note / +x / +y semitones per tick — **`047` major, `037` minor, `007` octave**. It is written on the harmony channel or a sustained lead note, changes **only at chord changes** (≈2–8 changes per 64-row pattern), and is **cancelled with `000`**. It may drop out for whole sections once the harmony is established; a fast arp running through an entire song is the textbook fatigue offence.
- **Vibrato (`4xy`) only on notes ≥4 rows long**, small depth, ideally entering 1–3 rows after the attack (write the note dry, add vibrato late, or use a delayed-vibrato instrument). **Portamento (`3xx`)** glides *to* the next written note — for legato joins and important arrivals; `1xx`/`2xx` are indefinite slides for drum pitch-drops, bass falls and risers; `Qxy`/`Rxy` slide exactly y semitones (grace notes, scoops).
- **Duty (`Vxx`)** — 12.5% / 25% / 50% / 75% — changes **at phrase boundaries** (0–2 per pattern): it is the composer's only mid-song instrument change. Lead typically 25%, echo/harmony 50%.
- **The persistence law**: most effects are **continuous until cancelled with a `00` parameter**. Every continuous effect is explicitly stopped; an uncancelled arp or vibrato leaking across a phrase boundary is a classic bug, and a pattern with an effect on every row is the visual signature of the failure mode.
- **Repeated per-note shaping belongs in instrument macros** (volume/arp/pitch/duty sequences stepped per tick) — the lead's decay, the snare's drop, the arp cycle are defined once per instrument and triggered by plain notes. Hand-written per-row wiggles usually mean a missing macro.
- Useful utility effects: `Gxx` note delay (at 150/6, triplets = `G02` + `G04` on the 2nd and 3rd notes — also the swing/humanise tool), `Sxx` delayed cut (staccato gates without cut rows), volume column + `Axy` slides for dynamics (echo levels, hat accents, fades written as one slide, not dozens of entries).

## 5. The failure list (generator checks)

Each of these is a named, sourced beginner failure; the generator's example set and any future lint pass should test for them:

1. **Filling every channel, all the time** → collisions and click noise; experienced writers deliberately leave channels empty so the resting channel's return has meaning.
2. **Overlong, motif-less melody** — the single most-named beginner mistake; if the lead can't be hummed back after one loop, there is no motif.
3. **Arpeggio abuse** — arp everywhere, at full speed and volume, for the whole song; worse on both pulses at once.
4. **No repetition** (every pattern new) **and its twin, literal looping with zero variation** — both fail; the craft is the middle path of §3.
5. **Cluttered registers / masking** — two parts fighting for one frequency range; one role per channel, one register per role.
6. **Over-complicated drums** — invented fills in every bar destroy the loop's anchor; kick/snare/offbeat hats carry a track.
7. **Effects everywhere, or effects never cancelled** — see the persistence law.
8. **Hardware-impossible writing** — volume on triangle, effects on DPCM, chords in a channel, bass and lead in one register. Each instantly marks a pattern as invented rather than tracked.
9. **Silence treated as a mistake** — "cram every note I could in; it sounded like a cacophony of angry bees."

**Two smell tests** for any candidate pattern: mute any one channel and the rest should still make musical sense (each channel has one clear job); count new material across a 4-pattern section — 4 patterns of entirely new notes is wrong, 1 pattern ×4 unchanged is also wrong.

## 6. Caveats and the exemplar set

- **Honesty note**: no published corpus statistic exists for unique-pattern counts or note density across real tracks. The anatomy, hardware, and effect facts above are manual-grade; the density figures in §3 are **derivations** from worked examples and convergent tutorials, labelled as guidance — not measured averages. Jeroen Tel-specific pattern-level analysis was not found in citable form (Hubbard disassembly practice was used for the C64 parallel instead).
- **Exemplars** (built to this doc, 2026-11-07; data + piano-roll previews in the owner's files, `chiptune-exemplar-*`): three 64-row patterns in D minor at the canonical 150 — **A** (2-bar motif, ending-only repeat, programmatic fake echo on Pulse 2, gated walking triangle, fixed kit; 15 lead onsets, rests in every bar), **A′** (A with exactly one element changed: the final note lifts D6), **B** (A with exactly one channel changed: Pulse 2 echo → chord-tone arpeggio at `037`/`047`, dropping out in bar 4). Engine implication for T-MUS-06: the sandbox engine's 16-row sections should grow into 64-row patterns, and its always-on arp channel is failure #3 by default — arp becomes a per-pattern P2 *mode*, not a fixture.

## 7. The measured contrast — bad vs good, as a gate

The owner's prediction, verified the same night: comparing the three rejected renders against the exemplar set, a measurable signature separates them. A lint pass over the pattern JSONs (sandbox `pattern_lint.py`; thresholds from §3's ranges, calibrated on this small judged set — v1, to be sharpened as more judged pieces accumulate) reports:

| Piece | P2 coverage | Mean active channels | Lead bars with real rests | Motif restated in-phrase | Verdict |
|---|---|---|---|---|---|
| Grid Royale v1 (rejected: jingle) | 1.00 | 2.89 | 0% | 0.05 | fail ×5 |
| Grid Royale v2 (rejected: mess) | 1.00 | 2.83 | 100% | 0.00 | fail ×4 |
| Neon Freeway theme (rejected: noise) | 1.00 | 2.82 | 0% | 0.09 | fail ×4 |
| Motif cut (unjudged musically) | 1.00 | 3.00 | 54% | **0.96** | fail ×3 |
| Exemplar A | 0.45 | 2.48 | 100% | 0.50 | **pass** |
| Exemplar song (A + A′ + B) | 0.57 | 2.59 | 100% | 0.50 | **pass** |

Three findings matter more than the table. (1) **Every sandbox-engine piece ever rendered has P2 coverage 1.00** — the engine's always-on arpeggio is a single habit poisoning every composition regardless of its notes; the lint fingers the engine, not just the composing. (2) **The motif cut proves the metrics are independent**: it fixed composition (motif restatement 0.96) and still fails on the engine's fixture habits — its lint output is literally the engine's fix list (arp drops out between sections; bass stops bouncing at full coverage; lead bars get real rests). (3) Exemplar B alone flags marginal on the wall metric (2.78 vs the 2.6 line) during its arp bars; the threshold was **not** relaxed to pass it — the song-level pass is the operative verdict, and a single dense pattern inside a resting song is period-correct. The prevention stack this creates: **lint (numeric, silent) → roll (visual, silent) → audio only on the owner's go**. Bad now has to pass two gates before it can reach anyone's ears.
