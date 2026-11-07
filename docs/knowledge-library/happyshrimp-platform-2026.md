---
tags:
  - research
  - documentation
  - knowledge-library
aliases:
  - HappyShrimp Platform
  - Happy Shrimp
cssclasses:
  - technical-guide
date: 2026-11-07
type: source
---

# HappyShrimp Platform — Brief Format, Credit Math, and Field Notes

Research & Reference — the platform card for Alibaba's HappyShrimp
music model, companion to `credit-economics-2026.json` and the Suno /
Lyria brief libraries. Distilled from public sources and the owner's
own runs (private study; nothing here is copied source text). Filed
2026-11-07 when HappyShrimp 1.1 appeared in the owner's app and a
GitHub sweep for 1.1 material came back empty (see Provenance).

## What it is

- End-to-end AI music model from Alibaba's ATH (Alibaba Token Hub)
  group, released 17 August 2026 as a public beta: one natural-language
  prompt produces a complete song — lyrics, melody, arrangement and
  vocals planned together in a single pass rather than stitched from
  separate stages.
- Access: desktop-web beta at happyshrimp.ai (global) and
  happyshrimp.cn (China). No public API as of the August 2026 launch
  material. Sign-in via Google or Apple.
- Every published song carries its "recipe" (the prompt behind it),
  so public tracks double as a prompt-format corpus.

## Interface contract (public guides, August 2026 — dated, beta moves)

- **Description / brief field:** one prompt, up to 5,000 characters.
  The model parses professional vocabulary (genre, tempo, key,
  instrumentation) inside prose.
- **Modes:** Smart Lyrics (model writes the words), Custom Lyrics
  (owner's words, sectioned with bracket tags such as [Verse],
  [Chorus], [Bridge], [Outro]), and Instrumental Only.
- **Output:** one generation returns two songs.
- **Brief recipe that the model responds to:** Situation + Genre +
  Voice + Instruments + Tempo + Arc, written as prose sentences —
  NOT a comma-separated tag string. Lead with the human situation;
  the model derives mood and dynamics from it. Name the arc
  explicitly (for example: verse intimate, chorus opens into a
  climax, bridge strips back, final chorus at full power), because
  the default arc is the model's choice, not the brief's.

## Owner field data (first-party, outranks any guide)

- Account held since September 2026. First run 2026-09-23 ("Rinse and
  Repeat", Smart Lyrics): **40 credits per generation** (two songs),
  balance 120 -> 80.
- Verdict on that run: vocals and model-written lyrics good; overall
  pacing **too slow** ("awfully slow"). Mitigation adopted since:
  state the BPM explicitly in the brief; if a take still drags, raise
  the stated BPM as the single changed variable.
- Credit ceiling (owner-reported 2026-11-07): roughly **four songs
  per day** — generations are the scarce resource on this platform.
  One generation (two takes) is therefore the standard A/B unit
  against a Suno run of the same lyric set.
- Failed generations were refunded per third-party workflow pages;
  treat as unverified until observed first-party.

## The 1.1 question (as of 2026-11-07)

- The owner sees a **1.1** version label in the app (2026-11-07). No
  public changelog could be verified: public guides still describe
  the 1.0 beta from August 2026, and a GitHub sweep on 2026-11-07
  found **no official repository, no prompt guides, no API wrappers**
  — only an unrelated SEO README repo, an installer repo for a
  different product, and search noise.
- Working rule until a changelog surfaces: assume the 1.0 interface
  contract above; 1.1 credit pricing is unverified, so read the
  confirm screen before firing.

## Studio usage rules

- **Model-specific vocabulary (owner rule, 2026-11-01):** HappyShrimp
  briefs are prose in the recipe shape above. Never paste a Suno tag
  string into it, and never carry its prose style into a Suno style
  field. Same lyric set + same brief intent; each platform's render
  records its own prompt in the track file's `renders[]`.
- Keeper lyric sets always go in via **Custom Lyrics** — Smart Lyrics
  rewrites the words, which breaks the A/B control.
- First A/B pair filed under this card: Lyric Set 6, "Performance
  Review" (`track-lyrics/performance-review.json`) — Suno v6-mini at
  105 BPM flat brief, then both platforms re-briefed at 128 BPM with
  a build/climax arc and an android-precise vocal (owner pivot,
  2026-11-07).

## Provenance

- Public guides (independent, not Alibaba): happyshrimp.online
  (reviewed against the launch announcement and official beta,
  19 August 2026 — brief recipe, character limits, mode list);
  happyshrimpmusic.com (model overview, recipe/remix behavior);
  the official @happyshrimpai tutorial summary (mode flow, Custom
  Lyrics, two-song generations).
- Owner run log: 2026-09-23 session (credit cost, balance, verdict).
- GitHub sweep: repository search API, queries `happyshrimp`,
  `happy shrimp alibaba`, and the Chinese name, 2026-11-07 — no
  relevant results.
