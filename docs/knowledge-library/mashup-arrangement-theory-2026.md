---
tags:
  - research
  - audio
  - creative-guide
aliases:
  - Mashup Arrangement Theory
  - Music Theory for Stem Mashups
  - Arrangement Rules Without Key Detection
cssclasses:
  - research
date: 2026-10-13
---

# Arrangement Theory for Stem Mashups — What Survives Without Key Detection

> [!info] Purpose
> The mashup tool renders arrangements from stems of different songs. Most
> classical mashup theory assumes reliable key detection, which this library
> does not have (chroma flatness 0.978–0.998 — see
> [[track-similarity-measurement-2026]] §7). This note records the subset of
> arrangement theory that is actionable *without* key detection, so agents
> and the `from-prompt` system prompt apply it instead of guessing.

> [!tip] Companion docs
> [[track-similarity-measurement-2026]] (why key-based theory is out),
> [[remix-mashup-2026|remix-mashup plan]] (the tool this serves),
> `services/stem_remixer.py` (`probe_track`, `first_audible_sec`),
> `services/remix_prompt.py` (adjective map, system prompt).

---

## 1. Deliberately excluded: harmonic mixing / Camelot wheel

The classical rule — mix into the same key, an adjacent Camelot number, or
the relative major/minor — is correct and useless here: every move on the
wheel starts from a detected key, and detection is noise on this material.
Do not add it until key detection works. This is a measured position, not an
oversight; see the companion doc §9.

What follows is everything that remains once key is off the table.

---

## 2. Stretch ratios, not BPM deltas

The plan's rule ("keep `target_bpm` within ~10 BPM of the sources") is a
stand-in for the real rule: **time-stretch stays transparent roughly inside a
0.90–1.10 ratio**, and drums show artifacts first (transient smearing —
the attack softens before anything else sounds wrong).

Why the restatement matters: 10 BPM at 100 BPM is a 10% stretch; at 150 BPM
it is 6.7%. The same absolute rule is stricter on fast sources than slow
ones. As a ratio the rule is uniform:

- **0.95–1.05**: transparent on all stems, including drums.
- **0.90–1.10**: safe; check exposed drum transients by ear.
- **Beyond 1.10 / below 0.90**: audible smearing on drums and vocals;
  acceptable only as an effect, not as a correction.
- **0.5 / 2.0**: the special case — half-time / double-time feels are
  musically coherent (the grid still lines up) even though the ratio is
  extreme. An agent may propose these deliberately; it must never *drift*
  into them.

For `from-prompt`: prefer `target_bpm` within 5% of the sources' probed BPMs
(the median default already does this); flag any draft beyond 10% unless the
prompt asked for half/double-time.

---

## 3. Phrase-boundary alignment

Dance and pop material is built from **4-bar phrases grouped into 8-bar
sections**. A layer that starts mid-phrase sounds wrong even when the tempo
matches, because the downbeat accents land in the wrong place.

Rules for arrangement:

- **`source_start_bar` should be a multiple of 4**, and prefer multiples of 8
  for section-length material. The `first_audible_sec` skip already pushes
  starts forward — round that push *up* to the next 4-bar boundary rather
  than starting at the exact audible frame.
- **Match energy, not just structure**: when the instrumental builds into a
  chorus, the vocal layer should be in its chorus too. The section driver
  labels sections per track; prefer pairings where high-energy sections
  overlap (chorus→chorus, drop→drop). A verse vocal over a chorus
  instrumental reads as a mistake.
- **Trim the instrumental, never the vocal.** If the structures don't line up
  (16-bar verse against a 32-bar verse), cut or loop the backing — cutting
  vocals breaks lyrical continuity and is always audible.

---

## 4. Frequency slotting: don't stack the same band twice

Two layers occupying the same frequency band mask each other — the result is
louder but muddier, not fuller. The per-stem split already separates the
worst case (bass vs everything else), but these collisions remain:

- **Two `bass` layers**: almost never works. Pick one; high-pass or drop the
  other.
- **Two `other` layers**: the danger zone — both carry mids (keys, guitars,
  synths). If both are present, pull one down 3–6 dB or lowpass it (B4's
  `lowpass_hz` exists for exactly this).
- **Vocals + dense `other`**: the classic fight. The adjective map's
  "vocal-forward" (vocals +3 dB, `other` −2 dB) is the standard fix; it works
  because it re-slots the midrange rather than just turning things up.
- **Drums are the exception**: a drum layer rarely masks anything —
  transients poke through sustained material. Stacking drums is a *level*
  problem (too loud), not a masking problem.

Agent rule of thumb: no slot should contain two layers whose energy lives in
the same band unless one of them is explicitly carved (gain cut or lowpass).
A `preview` warning for "two `other` stems at similar gain in one slot"
would be cheap and genuinely useful.

---

## 5. The explicit shift ladder (for when the user names the keys)

`key_shift_semitones` stays explicit per layer — never auto-set. But when the
user *does* know the keys (or asks for a shift outright), these are the
intervals that preserve a musical relationship, smallest first:

| Shift (semitones) | Interval | Effect |
|---|---|---|
| 0 | Unison | No change — the default, and usually right |
| ±3 | Minor third | Relative major/minor (A minor ↔ C major) |
| ±5 | Perfect fourth | Close harmonic neighbor |
| ±7 | Perfect fifth | Close harmonic neighbor, brighter lift |
| ±12 | Octave | Same pitch class, different register |

Anything else (tritone ±6, semitone ±1) is dissonant against the original
material and should only be used as a deliberate effect. Shifts beyond ±12
are never more musical than their octave-reduced equivalent — fold them.

Note the asymmetry with §1: this table is *not* harmonic mixing. It does not
pick a target key; it documents which explicitly-requested shifts are safe.
The agent must still never infer the source key.

---

## 6. Where each rule lives in the tool

| Rule | Home |
|---|---|
| Stretch ratio band (§2) | `from-prompt` system prompt (`target_bpm` rule); `preview` warning beyond 1.10 |
| Phrase alignment (§3) | `from-prompt` system prompt (`source_start_bar` rule); section-driver pairing |
| Frequency slotting (§4) | Adjective map + a future `preview` masking warning |
| Shift ladder (§5) | Docs only — applied by whoever sets `key_shift_semitones` explicitly |

If a future key-detection method ever beats the chroma-flatness wall, §1 gets
reopened and the Camelot wheel becomes the first addition. Until then, this
is the complete theory the tool needs.
