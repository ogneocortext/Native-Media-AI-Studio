# Studio Quality Plan — Oct 2026 (visualizer UX, reactive depth, mastering + stems)

**Status:** Approved 2026-10-02 (Phase 0 executed)
**Decides:** none formally — touches Q4 (mode consolidation stays out of scope)
and executes D23/D24's open follow-ups without reversing them
**Owner:** repo owner
**Approved:** 2026-10-02

> Derived from three new knowledge-library articles (2026-10-02):
> [[visualizer-ux-audit-2026-10]], [[audio-reactive-best-practices-2026]],
> [[ai-music-mastering-stems-2026]] — evidence, sources and full gap tables live
> there. Read `docs/architecture/decision-log.md` and
> `docs/architecture/visualizer.md` before implementing (D14/D23/D24/D25 rules
> apply: new logic goes in modules, not `Visualizer.tsx`).

---

## Phase 0 progress (2026-10-02)

| Item | State |
|---|---|
| 0.1 stem separation `opts.source_path` (P0) | **Done** — fix + 6 tests, both mutations caught, verified live (HTTP 200, 4 stems) |
| 0.2 shader visualizer API filename (P1) | **Done** — `trackFile` prop added; `spectral-timeline` now 200 for hash-prefixed tracks |
| 0.3 "no analysis" visible state (P1) | **Partly** — 404 is now a first-class `unavailable` state, not an error; the toolbar Analyze CTA already existed. The browser's own "Failed to load resource" line for a 4xx **cannot be suppressed from app code** — it is emitted by the network stack — so that part of the acceptance criterion is not achievable as written and is left as a known limit. |
| 0.1 UI error copy | Not done — the separation panel's raw-message disclosure is Phase 1 work; no bare exception is shown today because the failure never reached the UI |

Phases 1–3 are not started. They are blocked on nothing, but Phase 0's tests were
established first per the suggested order, because the "test executes the real
path" pattern is what the rest inherits.

---

## Guiding rules for every phase

1. **Prove the path runs.** Both P0 bugs existed while their tests passed
   (monkeypatched / never fetched). Every fix here lands with a test that
   *executes the real path*, and each new test is mutation-checked once
   (break the fix on purpose, watch the test fail).
2. **Live verification, not restarts.** Dev servers hot-reload; verify with
   `python tools/run-gates.py`, direct `curl` against :8000, and browser
   automation against :5173. Do not restart running services (AGENTS.md).
3. **Screenshots before/after** go to `packages/frontend/tests/browser/out/`
   (D5) and are compared with the vision tool in `regression`/`compare` mode.
4. **Nothing in this plan touches `unity-visualizer/`** (protected) and nothing
   reverses a decided entry (D1–D25).

---

## Phase 0 — Stop the bleeding (P0/P1 bugs) — do first, ~half a day

### 0.1 Fix stem separation (`source_separation.py`) — P0

- **Bug:** `_separate_demucs` reads `opts.source_path` (L553) which the
  `SeparationOptions` dataclass does not define → `AttributeError` on every
  Demucs run; the hierarchical call (L428-436) additionally passes a
  `source_path=` kwarg the signature rejects → `TypeError`.
- **Fix (preferred):** give `_separate_demucs` an explicit
  `source_path: str | None = None` parameter, use
  `source = source_path or audio_path`, delete the `opts.source_path` read,
  and keep the hierarchical caller's `source_path=instrumental` as a plain
  parameter. The dataclass stays a pure quality-knob bag.
- **Tests (the actual deliverable):**
  - unit: call `_separate_demucs` with a stubbed `_run_subprocess_async` that
    records `argv` — assert the audio argument is the passed source, not the
    original path (executes the fixed line for real);
  - unit: run the hierarchical path with stubbed MDX step — completes without
    `TypeError` and Demucs receives the instrumental residual;
  - live (skippable): `POST /api/audio/separate` on a 1-second generated WAV
    returns `success` or a *separation* error — never 500
    `SeparationOptions…`. Follow D22's skip-vs-fail convention for the
    GPU-bound variant.
- **UI:** map the 500 to friendly copy ("Separation failed — see backend
  log") with the raw message behind a disclosure; never show a bare Python
  exception as the panel state.

### 0.2 Fix the shader visualizer's API filename — P1

- **Bug:** `Visualizer.tsx:1682` passes `cleanTrackName(currentFilename)` as
  `trackName`; `ShaderVisualizer` feeds it to `useKeyPalette` and
  `useSpectralTimeline` as an API key → 404 for every hash-prefixed file.
- **Fix:** give `ShaderVisualizer` two props — `trackName` (display, keeps the
  `Abstract Waves` label and preset selection) and `trackFile` (raw
  `currentFilename`) — and fetch with `trackFile`. Do not "clean less": D16
  already says display rules live in `cleanTrackName`, the mistake is using a
  display string as a cache key.
- **Verify:** browser automation with a hash-prefixed track: zero
  `/analysis/by-filename` or `/spectral-timeline` 404s, `useSpectralTimeline`
  state non-null, shader palette resolves (or legitimately falls back below
  confidence r=0.4 per Q5).

### 0.3 Make "no analysis" a visible state — P1

- Treat 404 as *expected*: no console error spam; show an inline
  **Analyze track** CTA in shader mode (2D already has one) and in the track
  header when `analysis == null`.
- Acceptance: loading an unanalyzed track shows one clear affordance, zero
  red console entries.

**Phase 0 exit criteria:** stems load end-to-end in the UI (watch Demucs run
once); shader loads with spectral timeline; `run-gates.py` green; the three
new tests fail when the fix is reverted.

---

## Phase 1 — UX friction (from screenshots) — ~2–3 days

### 1.1 One custom transport

Replace the native `<audio controls>` with a styled transport component owned
by the visualizer (play/pause, time, seek, volume, menu) fed by the existing
audio element + `audioTiming.ts` clock. Remove the duplicate header ▶ or make
it the same control; label Three.js Studio's PREVIEW/AUDIO transport pairs as
groups. Acceptance: no browser-stock controls anywhere in the app
(screenshot-compare).

### 1.2 Panels yield to the canvas

- STEM MIXER + MASTER EQ **start collapsed**; persist open/closed (localStorage
  alongside existing settings); `Simple Mixer` toggle keeps working.
- Canvas gets a `min-height` (≥ 45vh desktop); on short viewports (≤ 800px
  height) the mixer becomes a bottom sheet / accordion instead of stacking
  under the transport.
- Acceptance: at 780×410 the canvas occupies ≥ ~40% of the viewport (measure
  via DOM rect, not by eye).

### 1.3 Overlay discipline + contrast

- FX panel, More-controls menu, 3D preset list and shortcuts panel are
  **mutually exclusive** (opening one closes the others), each with a scrim
  and Esc-to-close.
- Restyle More-controls to dark-UI tokens with text labels — current capture
  is unreadable (see [[dark-ui-color-system-2026]], [[color-strategy-2026]];
  run the contrast audit tool from [[design-auditing-2026]]).
- Acceptance: axe/contrast audit passes on the menu; screenshot shows no
  stacked panels.

### 1.4 Visual robustness

- Lyric card: luminance-aware scrim (`backdrop-filter: blur` + alpha floor) so
  text survives any background, including blown-out scenes.
- 3D render path: exposure clamp / tonemap ceiling so presets like
  `Cosmic Dust` cannot fill the frame with white; re-capture that preset and
  compare mean luminance against a threshold.
- Acceptance: lyric contrast ≥ 4.5:1 against the brightest preset (computed on
  a captured frame).

### 1.5 Honest lists and labels

- Audio Analysis rows render `optionLabel`/`displayName` (D16) with the raw
  name behind rename; uuid files show `Unnamed track <6>` (existing rule).
- Add a per-row **Analyze** action; show analysis status (✓ analyzed / — not).
- Three.js Studio: `aria-label` + tooltips on the seven icon-only buttons;
  `161312ms` → `161.3 s`; fix the shortcuts panel's cycle-order text to match
  the real cycle (shader → 2D → 3D).
- Acceptance: snapshot (`--snapshot`) shows accessible names for every
  toolbar control.

---

## Phase 2 — Reactive depth (research-backed) — ~3–5 days

Order is deliberate: wire existing assets before writing anything new.

### 2.1 Wire the asymmetric smoother (cheapest win)

`asymmetricSmoothBands` (0.8 attack / 0.12 release) is tested and waiting
(`visualizer.md`). Wire into `bars` + `stacked-frequency-bands` behind the
existing per-mode path, A/B capture while playing, keep the spring code as
fallback. Unit-test the wiring decision (mode flag), not the maths (already
tested).

### 2.2 Reactivity controls triad

Add **Sensitivity / Attack / Release / Beat response** as *reactivity* controls
(distinct from the FX look panel and from Master EQ). They must clamp into the
same clamped-driver pattern as `BlobFieldDrivers` (refs, not props — D14 rule
2). This absorbs the "brickwalled master pins everything" failure without
per-track code.

### 2.3 Genre reactivity presets

Bundles of the triad + onset/tempo weights: `EDM` (fast attack, high beat
response), `ambient` (long release, spectral-centroid weighting, low beat),
`vocal-led` (mid emphasis). UI: chips next to the existing EQ presets but in
the reactivity panel — do not overload Master EQ.

### 2.4 Motion vocabulary — first style

D23 left per-style mapping open on purpose. Map `motion/` into **one** style
(e.g. `pulse`/`radial`): impacts from `beatPhase` onsets, camera offset node
only, `clamp01` everywhere (rules 3–5 in `visualizer.md`). Ship with the
existing 151 assertions untouched plus one driver-composition test.
Document the mapping table in `motion/README` or module docs — this is the
"re-tune per style" log D23 anticipates.

### 2.5 Latency budget, visible

Extend `RenderStats` with measured audio→visual delta (audio clock vs frame
presentation) and the lead offset; document the 30 ms "locked" band and the
20–40 ms visual-lead target. Add a grep-gate style check that viz render loops
never reference `performance.now()`/`Date.now()` (D14 rule 2, now enforced).

### 2.6 Color/feel polish

Gamma-correct the brightness drive where a linear map remains; verify
frequency→color conventions per [[audio-reactive-best-practices-2026]] §2.
Q5 Tier 2 (per-frame chroma) stays deferred — needs analyzer work.

**Phase 2 exit:** each item has a before/after capture on a dense track, a
sparse track and an acoustic track (D24's three-track validation rule).

---

## Phase 3 — Mastering + stem quality (audio side) — ~4–6 days

### 3.1 Measure first: a mastering module (backend)

New `app/services/mastering.py` + routes in the right module per D15 (this is
*editing/measurement*, so `audio_edit.py` or a new `audio_mastering.py`
registered in `main.py`):

1. **Measure:** integrated LUFS, true peak (dBTP), LRA — `pyloudnorm`
   (BS.1770) + a true-peak meter. Reuse the analysis pipeline where possible.
2. **Normalize/limit:** gain to target preset
   (`spotify -14 / apple -16 / competitive -11`, ceiling -1 dBTP, Amazon -2),
   true-peak limiter (look-ahead or ISP-safe oversampled ceiling).
3. **Tone (v1, static):** de-mud wide cut ~300 Hz, gentle presence control —
   the conservative half of the AI-defect chain. Dynamic de-harsh and M/S
   side cleanup are v2 (heavier DSP; don't block v1 on them).
4. **QC report JSON:** before/after LUFS-TP-LRA, mono-fold delta, phase
   correlation — displayed next to the export.

Frontend: **Mastering panel** (measure → target chips → preview A/B at
matched loudness → export). Master EQ presets stay as the quick-look layer;
the panel owns delivery.

Acceptance: round-trip on a real track lands within ±0.5 LU of target, TP
under ceiling, QC numbers displayed match a re-measure of the exported file
(D17's lesson: assert the artifact, not the intent).

### 3.2 Separation hardening (after Phase 0)

- **Pre-separation normalize** to ~-14 LUFS / -1 dBFS (research: quiet inputs
  underperform), then separate.
- **Idempotency key** `sha256(content + model + params)` → cache hit skips
  GPU entirely (double-click/retry currently re-runs Demucs).
- **2-stem vocal shortcut** → feed the vocal stem to faster-whisper (D4) and
  expose karaoke/instrumental as first-class outputs (`--two-stem` semantics).
- **Draft/deliverable presets:** `htdemucs` + shifts=1 draft vs
  `htdemucs_ft` + shifts=2 deliverable (4× time — make the cost visible in the
  UI like D9's estimator does).
- **Telemetry:** log per job model/shifts/seconds/device (structured) so "why
  is this slow" is answerable (D8 metrics path).

### 3.3 Stem mixer honesty

Bleed warning copy ("stems are reconstructions — use for balance, not
surgery"), per-stem phase/mono check button, and confirm relative stem gains
survive Demucs' auto-rescale (know whether clamp or rescale is in effect).

---

## Phase 4 — Verification & handoff

| Gate | Command |
|---|---|
| All cheap gates | `python tools/run-gates.py` |
| Backend incl. new separation/mastering tests | pytest via run-gates (`nma-studio-cuda` only, never `comfyui-cuda`) |
| Visualizer specs | `pnpm exec playwright test canvas2d.spec.ts lrc-visualizer.spec.ts` (in `packages/frontend`) |
| Live endpoints | direct calls to `/api/audio/separate`, `/api/audio/master`, `spectral-timeline` (real paths — D15) |
| Browser evidence | re-run the audit's capture script; compare vs this session's shots in `compare` mode |
| Knowledge docs | `python tools/validate-knowledge-tags.py` |
| Handoff | append session line to `tools/model-reliability/observed.jsonl` |

**Suggested order:** Phase 0 (same day) → 1.1/1.2/1.3 → 3.1 (measurable user
value) → 2.1/2.2 → 1.4/1.5 → 2.3–2.6 → 3.2/3.3 → 1 rest. Phases 0 and 1 are
independent of 2 and 3; nothing in Phase 2/3 should start until Phase 0's
tests exist, because they establish the "test executes the path" pattern the
rest inherits.

## Out of scope

- Q1/Q4 mode consolidation and the Q2 wizard fallback (separate decisions).
- D24's Parameter Modulation Hub / sidechain ducking (needs per-style mapping —
  Phase 2.4 provides the first mapping, revisit after).
- Q5 Tier 2 per-frame chroma (analyzer prerequisite).
- `unity-visualizer/` (protected), ComfyUI, and any decision-log reversal.
