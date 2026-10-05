# Treblo Tag Picker — Build Spec

## Goal
A searchable picker over Treblo's 4,160 published v3 style tags. The user types what they
want, picks exact tags deliberately, and copies a comma-separated tag string to paste into
Treblo's style field (Advanced mode) — or into Suno's style field, since plain genre/mood
tags transfer.

## Why this exists (decision record)
Treblo publishes every style tag its models understand (4,160 tags), which removes
prompting guesswork — but 4,160 tags cannot be browsed manually. A full automatic
"prompt → optimal tags" converter was considered and deliberately deferred: it is unproven
that exact tags beat well-written natural-language style descriptions, so the cheap
experiment comes first. This picker IS the experiment: if hand-picked tags consistently
beat natural-language prompts, the auto-converter earns its build cost. If not, this tool
still stands alone as a fast tag reference.

## Hard boundary (user directive, 2026-10-04)
**No third-party API calls in the app. None.** No calls to `api.treblo.com` or any other
generation API — not for generation, not for tag fetching, not for anything. This is a
local helper only: it produces text the user pastes manually into Treblo's (or Suno's)
own UI. Treblo's API free trial requires card verification and converts to paid plans;
the user does not want that path in the app, period.

## Architecture — follow the existing music-prompts pattern
This helper lives in-app alongside the existing Suno prompting helpers, not as a
standalone page. Mirror how `music_prompts.py` + `music_prompt_generator.py` +
`features/music-prompts/MusicPromptGenerator.tsx` work together:

1. **Data (already in repo):** `tools/music-gen/treblo-tag-picker/treblo-tags.json`
   (4,160 tags in page order + `related_index`). The backend service loads it once at
   startup via `PROJECT_ROOT`; the JSON is the single source of truth, never hand-edit.
2. **Backend service:** new `packages/backend/app/services/treblo_tag_picker.py` —
   `search_tags(query)` — case-insensitive; rank exact match > prefix match >
   substring match > fuzzy (simple typo-tolerant subsequence). 4,160 tags fit in
   memory; no index precomputation needed.
   `related_tags(tag)` (resolve `related_index` entries through `tags[i]`),
   `build_tag_string(selection)` (comma-joined, deduped, order-preserved).
3. **API:** extend `packages/backend/app/api/music_prompts.py` (or add a sibling
   router and register it in `main.py` exactly like the existing one) —
   `GET /treblo-tags/search?q=`, `GET /treblo-tags/related?tag=`,
   `POST /treblo-tags/build` `{tags: [...]}` → `{tag_string: "..."}`.
4. **Frontend:** new panel in `packages/frontend/src/features/music-prompts/`
   (e.g. `TrebloTagPicker.tsx`) reusing the `MusicPromptGenerator.tsx` UI patterns:
   search box, ranked results, selection tray, related-tag suggestions, copy button.

### UX composition — the workbench vision
The picker is the second tool in the music-prompts workbench section, alongside the
existing prompt generator — not a replacement. Present them as sibling panels (tabs or
side-by-side) in the same section: the generator engineers prose/structure, the picker
supplies exact verified tags. The picker's tag string must be paste-compatible with the
generator's Suno v6 style field (both are comma-separated tag-style fields), so a user
can engineer the prompt in one panel and refine its tags in the other. No deeper
coupling in v1 — no auto-merging of LLM output with picked tags.

## Data file: `treblo-tags.json`
```json
{
  "meta": { "source": "https://treblo.com/styles (extracted 2026-10-04)",
            "count": 4160, "order": "page order", ... },
  "tags": ["2020s", "pop", "rock", ...],          // 4,160 strings, page order
  "related_index": { "drift phonk": [2, 41, 85, ...], ... }  // indices into tags
}
```
- 4,160 unique tags, zero duplicates, verified against the page's stated count.
- 4,158 of 4,160 tags carry a related-tags list (~20 indices each), extracted from the
  site's own data. Spot-checked as semantically sensible
  (e.g. `drift phonk` → `phonk`, `memphis rap`, `trap`, `phonk house`).
- Tag format notes (matter for the copy output): tags are lowercase plain text, NOT
  quoted; multi-word tags appear bare (`late 2010s`, `hip hop`, `drums (drum set)`).
  No tag contains a comma, so comma-separated output pastes safely. Special characters
  in use: `& / - ( ) [ ]` apostrophes, plus non-Latin scripts (Arabic, Korean, Chinese,
  Cyrillic, Greek). Near-duplicate punctuation variants are distinct tags on the site
  (`r&b` vs `r b`, `jazz pop` vs `jazz-pop`) — preserve them exactly, do not normalize.

## Features (v1)
1. **Fuzzy/substring search** across all 4,160 tags, ranked with best matches first.
2. **Selection tray**: click tags to add/remove; shows the running comma-separated string.
3. **Related suggestions**: when a tag is selected, surface its related tags as
   one-click additions.
4. **Copy button**: copies the final comma-separated tag string to clipboard.

## Non-goals (v1)
- Any call to `api.treblo.com` or any third-party generation API (see hard boundary).
- Automatic prompt→tags conversion. Deferred until the experiment above validates.
- Category filters (Genres / Eras / Vocals / Instruments / Mood). The site groups
  1,760 tags into these; the mapping was not extracted. Optional follow-up: scrape the
  `/styles` filter views and add a `categories` key to the JSON.

## Constraints from the user's standing rules
- The tag list contains artist-evocative and era tags; the user picks deliberately and
  their no-artist-imitation rule still applies to what they actually use.
- Nothing here generates, downloads, publishes, or shares music. Text out, user pastes.
- Follow the repo's `AGENTS.md` (gates, no scratch files, Python-over-PowerShell).

## Acceptance
- `GET /treblo-tags/search?q=phonk` returns `phonk`, `drift phonk`, `rare phonk`,
  `phonk house` ranked sensibly.
- `GET /treblo-tags/related?tag=drift%20phonk` includes `memphis rap`, `trap`.
- Frontend panel: search → select → copy yields e.g.
  `drift phonk, phonk, dark, aggressive` — paste-ready for Treblo/Suno.
- No network calls leave the machine except the user's own browser pasting.

## Suno cross-reference data (added 2026-10-04)

`suno-crossref.json` cross-references the 4,160 Treblo tags against a Suno
community corpus (1,000+ prompts from `naqashmunir21/awesome-suno-prompts` +
controlled vocabularies from `sevenskytech1/suno-ai-prompts-guide`, both MIT/CC
community repos, extracted locally — no API calls, no hotlinking).

- `tier1_exact_match` (116): tag matches a Suno community descriptor verbatim.
  Highest confidence for Suno.
- `tier2_word_attested` (960): tag's words appear in Suno community descriptors.
  Concepts the Suno community demonstrably uses.
- `tier3_untested_in_corpus` (3,084): not attested in THESE corpora. This is NOT
  "won't work" — the corpus covers 13 genres and misses obvious Suno-safe terms
  (e.g. `classical`, `male vocalist`). Treat as "unverified", not "invalid".
- `suno_production_vocab` (314): Suno-community production/effect phrases absent
  from Treblo's list (`808 bass slides`, `sidechain`-style descriptors, `vinyl
  crackle`, `half-time` variants...). This is the real addition: Treblo's list
  covers the *what* (genres/moods); this covers the *how* Suno users steer sound.

Suggested UI: badge tags in the picker as "verified on Suno" (tier 1),
"community-used" (tier 2), or unbadged (tier 3); offer the production vocab as a
separate Suno-specific suggestion row. The user's open experiment stands: do
hand-picked exact tags beat natural-language prompts on Suno? This data is how
we run it, not the answer to it.

## Attribution
Every commit carries `Co-authored-by: Space Bunny Alpha <noreply@anthropic.com>`
(the implementing agent's trailer, per repo convention).
