# Treblo Tag Picker

Searchable picker over Treblo's 4,160 published v3 style tags. Pick exact tags
deliberately, copy a comma-separated string, paste into Treblo (or Suno).

## Files
- `treblo-tags.json` — 4,160 tags in page order + related-tag index (extracted from
  https://treblo.com/styles on 2026-10-04; no login required, read-only extraction).
- `SPEC.md` — build spec for the picker UI (handoff for the implementing agent).

## Status
Data extracted and verified. UI built (2026-10-05) per `SPEC.md`:
`app/services/treblo_tag_picker.py`, `app/api/treblo_tags.py` (`/api/treblo-tags/*`),
and the `TrebloTagPicker` panel under `/music-prompts`.

One spec claim did not survive measurement: the tag set has 145 non-ASCII tags but
they are **accented Latin** (`corée`, `forró`, `laïkó`) — Hangul count is
zero and CJK is one, not the "Arabic, Korean, Chinese, Cyrillic, Greek" the spec
describes.
