# Remix / Mashup Feature

Remix and mashup creation: build arrangements from stems of different songs, time-stretch to a common tempo, layer vocals/instrumentals, and preview before rendering.

## Entry Points

| File | Purpose |
|------|---------|
| `RemixPage.tsx` | Remix page UI: stem mixer, layer editor, preview controls |
| `RemixPanel.tsx` | Remix panel (Visualizer, under Stem Mixer): stem levels, mute/solo, faders |
| `remixRecipe.ts` | Remix recipe types and logic: `RemixLayer`, `RemixSlot`, `RemixRecipe`, `RemixResult` |
| `remixWizard.ts` | Remix wizard: slot building, vocal intro offset, song blending, name/summary generation |
| `abCompare.ts` | A/B comparison: pin forms, compare edits, snapshot vs live |

## Key Types (in `remixRecipe.ts`)

| Type | Purpose |
|------|---------|
| `RemixLayer` | A single layer: track, stem, source start bar, key shift, volume |
| `RemixSlot` | A slot: layers, bar count, crossfade |
| `RemixRecipe` | Full recipe: name, target BPM, slots |
| `RemixResult` | Render result: mix report, stem paths |

## Backend Integration

- `POST /api/audio/remix/{name}/enhance` — master a remix (NOT `/api/audio/enhance-stems`)
- `GET /api/audio/remix/{name}/file/{which}` — hear a remix (stem name or `master`)
- `GET /api/audio/remix/sources` — list available stem sources
- `POST /api/audio/remix/probe` — probe tempo from drums stem
- `POST /api/audio/remix/preview` — preview a recipe (validates tracks/stems)
- `GET /api/audio/remix/list` — list rendered remixes
- `GET /api/audio/remix/by-track/{track}` — list remixes for a track

## Key Behaviors

- **Tempo is probed from drums** when present (`_pick_analysis_stem`), because `list_stem_sources` advertises partial stem sets
- **Source key is not detected** — chroma flatness is 0.978–0.998 (1.0 = pure noise); `key_shift_semitones` is explicit per layer
- **Vocals open silently** — Ad-Nauseam's vocals are silent for the first 7.06 s; a layer at `source_start_bar=0` renders digital silence. `preview_recipe` warns below −50 dBFS. Use `safeVocalsStartBar` to skip a silent intro.
- **Remixes are ordinary stem sets** — `services/stem_remixer.py` writes `output/remixes/<name>/{vocals,drums,bass,other}.wav` + `remix.json`. No remix-only path downstream.
- **Tempo probe caches** live in `output/remixes/.probes/`, never beside the stems

## Tests

- `remixRecipe.test.ts` — `recipeToEditableSlots`, `newEditableLayer`, `matchSource`, `nextFreeName`, `timelineSegments`
- `remixWizard.test.ts` — `safeVocalsStartBar`, `wizardDurationSec`, `buildWizardSlots`, `wizardName`, `wizardSummary`

## Related Docs

- `docs/agent-code-navigation.md` — includes a remix probe trace example
- Backend: `packages/backend/app/api/audio_remix.py`, `packages/backend/app/services/remix_recipe.py`, `packages/backend/app/services/stem_remixer.py`
