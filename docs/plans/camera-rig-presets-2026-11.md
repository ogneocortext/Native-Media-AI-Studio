# Camera Rig Presets — Design 2026-11

**Status:** Proposed
**Area:** Video Pipeline & Storyboard (T-VID-11)
**Source:** `docs/knowledge-library/higgsfield-comfyui-challenge-2026.md`
§The 8 recreations #5 (Backlot); `docs/plans/tasks/video-pipeline-and-storyboard.md` T-VID-11
**Decides:** none — design only; the adapter change waits on the owner's word.
**Last Updated:** 2026-11-07

## 1. Scope and non-goals

Camera direction today is prompt-text suffixes: 8 `camera_motion`
values (`models/generation.py:162`) mapped to English fragments by
**two duplicated dicts** in `adapters/comfyui.py` (~line 1318 Wan I2V,
~line 1522 LTX I2V), mirrored a third time as UI options in
`VideoGenerationPage.tsx:124`. Backlot's lesson is that direction
should be **inspectable preset data** — a rig is `{move, lens,
lighting, look}` as fields, not a prose incantation.

Non-goals: no code, no adapter change, no frontend change. The scene
-side lighting/look vocabulary is T-VID-15's job — this document
specifies the *shape* so T-VID-15 can reconcile overlap, not a second
registry.

## 2. The gap, precisely

| Today | Missing |
|-------|---------|
| `camera_motion` enum → one prompt fragment | Lens character ("shot on 35mm", "wide angle") |
| Suffix appended to prompt text | Lighting setup ("golden hour", "neon rim light") |
| 8 moves, duplicated in 2 adapter spots + 1 UI list | Look/grade note ("teal-orange", "film grain") |
| Prose in prompts, nothing a storyboard can store | Named rig ids a storyboard panel can reference |

## 3. Rig schema

A rig is typed preset data. Fields the current suffix map cannot
express are the point; `move` stays compatible with the existing
enum so the seed set is lossless.

```jsonc
// config/camera-rigs.json (new at implementation)
{
  "version": 1,
  "rigs": [
    {
      "id": "push-in-slow",                    // kebab-case, unique
      "move":  { "kind": "enum", "value": "push_in" },   // or {"kind":"path","ref":"<T-VID-10 path>"}
      "lens":  { "focal_mm": 35, "fragment": "shot on a 35mm lens" },
      "lighting": { "setup": "soft key", "fragment": "soft key lighting" },
      "look":  { "grade": "neutral", "fragment": "" },
      "tags": ["intimate", "reveal"]
    }
  ]
}
```

**Composition rule (fixed order, deterministic):**
`prompt_suffix = join(", ", [move.fragment, lens.fragment,
lighting.fragment, look.fragment].nonempty)`. The composed suffix is
what gets appended to the prompt exactly as today's `motion_suffix`
is — same `, ` separator, same position.

**Move fragment resolution:** `move.kind=enum` maps through the same
table the seed rigs carry (below); `move.kind=path` is reserved for
T-VID-10's camera-path vocabulary and carries its own fragment —
schema allows it now so the registry doesn't need a version bump
when re-shoot lands.

## 4. Seed set — lossless by construction

Eight rigs, one per existing move, fragments **byte-identical** to
the current dict values:

| rig id | move | fragment (exact current string) |
|--------|------|----------------------------------|
| `static` | — (none: produces no suffix; see §5) | — |
| `push-in` | `push_in` | `slow camera push-in toward subject` |
| `pull-out` | `pull_out` | `slow camera pull-out away from subject` |
| `pan-left` | `pan_left` | `camera pans left` |
| `pan-right` | `pan_right` | `camera pans right` |
| `tilt-up` | `tilt_up` | `camera tilts upward` |
| `tilt-down` | `tilt_down` | `camera tilts downward` |
| `zoom-in` | `zoom_in` | `optical zoom toward subject` |
| `orbit` | `orbit` | `camera orbits around subject` |

Seed rigs carry **empty** lens/lighting/look fragments — behavior is
identical to today. Lens/lighting/look variants arrive as *new data
rows*, not code: e.g. `{ "id": "push-in-35mm-golden", "move":
push_in, "lens": 35mm, "lighting": golden-hour, "look": warm }`
composes `slow camera push-in toward subject, shot on a 35mm lens,
golden hour lighting, warm grade`.

**Lossless acceptance check (the test this design demands):** for
each of the 8 moves, `resolve(camera_motion=m)` produces the same
prompt suffix as `resolve(camera_rig=<seed id>)` — asserted by a
unit test at implementation, not asserted here.

## 5. Consumption point — one resolver, two callers deduplicated

New module `app/services/camera_rigs.py` (implementation-gated):

```python
def resolve_prompt_suffix(params: dict) -> str:
    """Single consumption point. Returns the ', ...' suffix or ''."""
```

Resolution order:
1. `params["camera_rig"]` present → look up rig, compose suffix.
   Unknown id → raise (fail at validation, not silently degrade).
2. Else `params["camera_motion"]` → map to the matching seed rig's
   move fragment (the enum values become *aliases* of the seed set —
   one source of truth, no second table).
3. `camera_motion="none"` / absent → `""`.

Both `_build_wan_i2v_workflow` (~1318) and `_build_ltx_i2v_workflow`
(~1522) delete their inline `motion_descriptions` dicts and call the
resolver. The T2V path has no camera conditioning today and stays
unchanged — noted so nobody "helpfully" wires it in without a spec.

**Request contract (additive, backward compatible):**
`VideoGenerationRequest` gains optional `camera_rig: str`. When both
`camera_rig` and `camera_motion` are sent, `camera_rig` wins and the
request logs which was used (params are already captured in job
sidecars, so provenance is free).

**Registry loading:** `config/camera-rigs.json` loaded once and
cached; validated on load (unique ids, enum move values known,
fragment strings non-empty where required). A malformed registry
fails fast at adapter init with the rig id named — same failure
vocabulary as the rest of the stack.

## 6. Storyboard consumer

A storyboard panel stores **`camera_rig: "<id>"`**, never prose. The
registry is the shared vocabulary across:

- the I2V prompt path (this document),
- T-VID-10's re-shoot `camera_path` (the `path`-kind move refs land
  here),
- T-VID-15's scene-side lighting/look rigs — which should reference
  the same `lighting.setup` / `look.grade` vocabulary rather than
  inventing parallel names (reconciliation noted, not decided —
  T-VID-15 owns that call).

This is the Backlot property that matters for this studio: camera
language becomes data a board can store, diff, and validate — the
same reason the visualizer's warp presets are data.

## 7. What implementation needs (owner's word required)

1. `config/camera-rigs.json` — seed set from §4.
2. `app/services/camera_rigs.py` — loader, validator, composer,
   `resolve_prompt_suffix`.
3. `models/generation.py` — optional `camera_rig` field +
   `to_adapter_params` pass-through.
4. `adapters/comfyui.py` — delete both inline dicts, call resolver
   at the two suffix sites.
5. Unit test: the §4 lossless check (8 moves × both resolution
   paths → identical suffixes).
6. Frontend follow-up (not v0): `CAMERA_MOTION_OPTIONS` becomes
   rig-driven when the registry is exposed over the API — the
   `GET /api/video/transform/workflows`-style listing pattern from
   the V2V doc applies here too (`GET /api/integrations/camera-rigs`).
