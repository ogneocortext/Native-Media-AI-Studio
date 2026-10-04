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
3. **Related suggestions**: when a tag is selected, surface its related tags
   (resolve `related_index` entries through `tags[i]`) as one-click additions.
4. **Copy button**: copies the final comma-separated tag string to clipboard.
5. **Local-first**: single static HTML page, no backend, no network calls, works offline
   from `file://`. This is a deliberate portability decision — any agent from any
   provider must be able to open and extend it without toolchain setup.

## Non-goals (v1)
- Automatic prompt→tags conversion. Deferred until the experiment above validates.
- Category filters (Genres / Eras / Vocals / Instruments / Mood). The site groups
  1,760 tags into these; the mapping was not extracted. Optional follow-up: scrape the
  `/styles` filter views and add a `categories` key to the JSON.
- Anything that touches a Treblo account: no generation, no login, no automation of
  the site. This tool only produces text for the user to paste manually.

## Constraints from the user's standing rules
- The tag list contains artist-evocative and era tags; the user picks deliberately and
  their no-artist-imitation rule still applies to what they actually use.
- Nothing here generates, downloads, publishes, or shares music. Text out, user pastes.
- Keep the tool private/local; no analytics, no external requests.

## Acceptance
- Opens from `file://` with no build step; search returns sensible results for
  queries like `phonk`, `female vocal`, `2020s`.
- Selecting `drift phonk` surfaces `phonk`, `memphis rap`, `trap` as related.
- Copy button yields e.g. `drift phonk, phonk, dark, aggressive` — paste-ready.

## Attribution
Every commit carries `Co-authored-by: Space Bunny Alpha <noreply@anthropic.com>`
(the implementing agent's trailer, per repo convention).
