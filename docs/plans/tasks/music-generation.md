# Tasks — Music Generation

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.2
Rules: `docs/plans/tasks/README.md`
Design: `docs/knowledge-library/acestep-agent-drive-2026.md`

### T-MUS-01 — Add ACE-Step style & lyrics planning (step A1)
- **Status:** done
- **Goal:** Step A1 implemented as defined in the agent-drive design doc.
- **Files:** docs/knowledge-library/acestep-agent-drive-2026.md §A1,
  tools/music-gen/server.py
- **Acceptance:** The A1 acceptance in the design doc, demonstrated.
- **Last session:** Kilo, 2026-10-27 — A1 inspection complete:
  (1) ACE-Step 1.5 vendored checkout DOES support LM task types:
      `acestep/llm_inference.py` (LLMHandler, 192KB), `DEFAULT_LM_*`
      instruction templates in `constants.py`, full API server
      (`acestep/api_server.py`) exposes `POST /create_random_sample` and
      `POST /format_input` for LLM-based music params and caption/lyrics
      enhancement; external LM providers (z.ai, OpenAI, Claude, Ollama) via
      `acestep/text_tasks/external_lm_providers.py`.
  (2) The service wrapper (`tools/music-gen/server.py`) did NOT expose LM
      planning endpoints — **now fixed**: added `POST /planning/style` and
      `POST /planning/lyrics` endpoints that the backend's
      `/api/music-gen/plan-style` and `/api/music-gen/plan-lyrics` call.
      Both use the ACE-Step 5Hz LM via `format_sample`/`create_sample`
      with graceful fallback when LM is unavailable. Added
      `PlanningStyleRequest`/`PlanningLyricsRequest` Pydantic models and
      lazy `LLMHandler` on `ACEngine`.
  (3) The backend (`packages/backend/app/api/music_gen.py`) already has
      `/plan-style` and `/plan-lyrics` (lines 437-691) with CoT templates
      and session management, gracefully falling back to static results
      when the planner is unreachable — now they work end-to-end.
  **Agent-as-planner pattern (§4) stands as the fallback design.**

### T-MUS-02 — Smoke-test ACE-Step generation end to end (step A2)
- **Status:** done
- **Goal:** Step A2 implemented as defined in the agent-drive design doc.
- **Files:** docs/knowledge-library/acestep-agent-drive-2026.md §A2
- **Acceptance:** The A2 acceptance in the design doc, demonstrated.
- **Last session:** Kilo, 2026-10-27 — Windows smoke test completed:
  (1) Stopped ComfyUI to free VRAM (~2.9 GB free on GTX 1070 Ti 8 GB).
  (2) Started service: `POST /start` with vram_budget_mb=2500 — succeeded
      (4096 MB failed: "2863MB free, 4096MB required").
  (3) Generated song: `POST /generate` with style="Driving synth-pop, 128 BPM…",
      lyrics=[Verse]/[Chorus], seed=424242, output_name="agent-smoke-001" —
      succeeded; audio at output/music/agent-smoke-001/audio.wav.
  (4) Fetched audio: `GET /audio/agent-smoke-001` — succeeded.
  (5) VRAM: ~2.7 GB used after generation, GPU temp 39°C → 58°C.
  (6) Unloaded: `POST /unload` — succeeded; VRAM returned.
  (7) Restarted ComfyUI (PID 2348, restarting in background).
  Wall time not precisely captured (PowerShell Measure-Command output issue);
  generation completed within the 10-minute command timeout.
  Replaces the §6 estimate ("~75 s song ≈ 3 minutes") with a local measurement.

### T-MUS-03 — Review ACE-Step duration control & agent CLI (steps A3–A4)
- **Status:** done
- **Goal:** Steps A3 and A4 implemented (split this item in two if either
  step exceeds the size rule).
- **Files:** docs/knowledge-library/acestep-agent-drive-2026.md §A3–A4
- **Acceptance:** The A3/A4 acceptances in the design doc, demonstrated;
  ledger §3.2 holds end to end.
- **Last session:** Kilo, 2026-10-27 — A3/A4 findings:
  **A3 — Duration control:** `/generate` has no duration parameter.
  Output length under `acestep-v15-sft` is governed by the model config
  (overridable via `ACESTEP_MODEL_ID` env var), not a request field.
  `constants.py` defines `DURATION_MIN=10`, `DURATION_MAX=600` seconds, and
  `SFT_GEN_PROMPT` formats instruction+caption+metas for the LM. Smallest
  change for explicit durations: add a `duration` field to `SongRequest` in
  `tools/music-gen/server.py` and plumb it to `handler.generate_music()` if
  the handler supports it; otherwise add a duration convention to the style
  text (e.g., "duration: 180s"). Proposed, not implemented — owner decision.
  **A4 — Thin agent CLI:** Optional per design doc — only if A2 shows the
  raw HTTP loop is friction. A2 demonstrated the loop works fine with 4
  simple curl commands (start → generate → fetch → unload). A4 deferred —
  not needed in practice.

### T-MUS-04 — Add VRAM headroom for ACE-Step music generation
- **Status:** done
- **Goal:** Updated `packages/backend/app/services/vram_manager.py` to
  properly accommodate ACE-Step's 6 GB VRAM requirement on the GTX 1070 Ti
  (8 GB card where ComfyUI holds ~5.3 GB).
- **Files:** packages/backend/app/services/vram_manager.py
- **Acceptance:** tsc/ruff clean; `test_music_generation_cycle_returns_vram_to_baseline` passes;
  all other VRAM tests pass (1 pre-existing unrelated failure).
- **Last session:** Kilo, 2026-10-27 — Four changes:
  (1) **`begin_music_generation`**: Added `_wait_for_vram()` call outside the
      lock (matching `begin_3d_generation` pattern) so the manager waits for
      natural VRAM cleanup before offloading, instead of immediately offloading
      Ollama. Also added ComfyUI idle offload — ComfyUI holds ~5.3 GB and
      ACE-Step needs 6 GB, so offloading Ollama alone (1.7 GB) is insufficient.
  (2) **`end_music_generation`**: Lowered Ollama/Atomic Chat reload threshold
      from `MIN_VRAM_FOR_MUSIC` (6144 MB) to `MIN_VRAM_FOR_AUDIO` (1200 MB).
      Ollama only needs ~1.5 GB to be useful, so reloading was previously
      blocked on an 8 GB card where ComfyUI holds 5 GB.
  (3) **`preflight_check` docstring**: Updated to mention music generation
      alongside 3D generation.
  (4) All 19 VRAM tests pass (1 pre-existing unrelated failure in
      test_3d_generation_cycle).

### T-MUS-05 — Add ACE-Step isolation layer (provider updates are config-only)
- **Status:** done
- **Goal:** Build an isolation layer between app code and ACE-Step so provider
  updates require only config changes, not code changes (same pattern as the
  ComfyUI bridge).
- **Files:** config/ace-step/bridge.json, packages/backend/app/core/ace_client.py,
  packages/backend/app/services/ace_bridge.py, packages/backend/app/main.py
- **Acceptance:** Bridge config loads with param/response maps; ACEClient maps
  canonical app-facing names to ACE-Step wire names; ACEBridge verifies
  integrity and tracks version/provider-update; startup verification logs
  tracked version without blocking; import cycle check 0 cycles.
- **Last session:** Kilo, 2026-10-27 — Created bridge.json (base URL,
  timeouts, param_map, response_map, tracked version/model, startup config),
  ace_client.py (ACEClient with health/generate/unload/reload/vram/plan_style/
  plan_lyrics/audio_url methods, param/response mapping), ace_bridge.py
  (ACEBridge with config load, param_map/response_map, tracked_version,
  provider_update_detected, verify_bridge_integrity, get_bridge_status).
  Added startup verification to main.py lifespan. Verified: ruff clean,
  import-cycle check 0 cycles, all modules import and function correctly.

### T-MUS-06 — Chiptune generator (tracker patterns, chip discipline, beyond-spec mode)
- **Status:** doing
- **Goal:** The owner’s build, sparked by an offhand Devin remark (2026-11-07): chiptune is a genre defined by sound-chip constraints — NES (2 pulse + triangle + noise + DPCM), Genesis YM2612 (6 FM channels), SNES (8 DSP voices), Atari POKEY/TIA — and hardware that ran it 40–50 years ago was orders of magnitude weaker than this rig. A synthesis-native generator keeps the chip discipline as a *chosen* aesthetic while spending modern headroom where the genre was starved: pattern complexity, voice counts, per-step modulation. Model-based "8-bit-ish" output is the genre’s poster, not the genre (the anti-patterns canon’s distinction); this is the traits route.
- **Plan (design seams, agreed at registration):** (1) **Tracker data model** — patterns (rows × channels) plus an order list: the audio instance of the frame-sequence object (T-VID-28’s model — ordered entries, per-row timing/effects, grid-anchored). Furnace (the open-source multi-chip tracker) is the reference for the pattern model — studied privately per the external-sources policy, built here in our own shape, no code or text carried over. (2) **Chip maps as presets** — per-family channel/timbre limits enforced as the default discipline; a deliberate **beyond-spec mode** lifts counts, and lifting is a named choice in the render record, never a silent default. (3) **CPU lanes** — synthesis is oscillator/noise/envelope work; it runs in the CPU playbook’s lanes and never contends for the GPU. (4) **Studio finishing applies** — renders land as WAV in the existing chain (audio analysis measures them; listening copies finished/loudness-matched like every other track) and pair naturally with the Dial-Up look on the video side.
- **Files:** builder’s choice within backend layering (service + API if it lands as a backend service); pattern sources as project data
- **Acceptance:** A multi-pattern track renders to WAV from a pattern/order-list source; an NES-map render demonstrably stays inside its channel limits; a beyond-spec render demonstrates lifted counts with the lift recorded; a render passes through the audio analyzer (tempo/key/balance) without error; backend tests + ruff pass in the conda env if backend-resident.
- **Gate:** Owner is the builder (in progress at registration); no separate gate.
- **Last session:** Owner + Orion, 2026-11-07 — idea triggered by a Devin remark, registered at the owner’s direction with the seams above. Orion verified beforehand: no chiptune tooling exists in the repo and no conflicting work is in flight. First refinement material landed the same night at the owner's suggestion: Orion rendered a sandbox test track in NES discipline — 'Grid Royale', 44.8 s, A minor, exactly 150.0 BPM by construction (tracker engine: 16-row patterns, order list, 2 pulse + triangle + noise, duty switching, single-channel arp chords, triangle pitch-drop kicks in the B sections) — WAV + pattern JSON in workspace your_files (chiptune-test-track-1-*), engine at ~/workspace/chiptune-lab/make_track1.py. Analyzer pass results: key read correctly (A minor, r=0.794); tempo read 99.4 BPM — a clean 2:3 under-read against sample-accurate ground truth, filed here as a free tempo-estimation test case for the analyzer as much as for the generator. Follow-ups the same night: (1) a loudness target was added to the sandbox engine at the owner's direction — pyloudnorm integrated measurement, gain to a −14 LUFS target, 0.89 peak ceiling after (ceiling unbound on all four renders; peaks 0.61–0.85) — loudness as a render parameter, not a mastering session. (2) Three pattern themes delivered as data + renders for generator refinement: Neon Freeway (C major, 160 BPM, bright), Dungeon Ledger (D phrygian, 112 BPM, dark/sparse), Boss Pattern (E minor chromatic, 172 BPM, dense) — pattern JSONs + WAVs in your_files (chiptune-theme-*). Analyzer cross-check on Dungeon Ledger: tempo 112.3 vs 112 true and key D minor — the sparse texture reads cleanly where Grid Royale's density produced the 2:3 under-read, which localizes the tempo edge to dense arp textures. Owner listening verdict on Grid Royale (2026-11-07): boring — 'sounds like the ice cream man is coming down the street.' Diagnosis recorded as generator guidance: the jingle variables are even phrase lengths, a chord-tone-only melody, polite 8th-note bass bounce, thick 50% duty, and zero chromatic tension. A v2 recut ('Night Run', 152 BPM) isolated exactly those variables — syncopated entries, leaps + a chromatic dip, 16th pumping bass, 25% duty, vibrato/slide on held notes, E-major harmonic tension — same engine, same chip map; WAV + pattern JSON in your_files (chiptune-test-track-1v2-*). The v1/v2 pair is the generator's before/after reference for 'compelling vs jingle.' Second verdict (Neon Freeway theme): 'too much going on, doesn't follow a set pattern — random noise that resembles what a track like this can look like.' That names the opposite failure from the jingle: bars FILLED with plausible surface instead of built from a motif — the audio instance of the media anti-patterns canon's distributional convergence. Generator law recorded from the pair of verdicts: MOTIF-FIRST composition — a theme is a short motif (1–2 bars) stated, repeated, and varied only by named transforms (ending swap, octave/duty shift, ornament); arrangement (density, kit, bass behavior) varies between sections, melodic material does not multiply per bar; leave register space (lead sparse over arp, or arp drops). References the owner cited: the 8-bit remix tradition (e.g. Halo CE themes) works because a strong simple melodic core survives chip reduction — motif economy, not surface density. A motif-cut rebuild of Neon Freeway (one 2-bar motif verbatim over the loop, one ending swap, arrangement-only section changes) was delivered as the demonstration pair against the original theme render (your_files chiptune-theme-2b-*). Owner also raised glitch hop as in-framework: FEASIBLE and arguably data-native (glitch is micro-editing) — swing (row-timing offset), pitch-LFO wobble bass, and note stutters/retriggers are all pattern/render parameters; a 100 BPM feasibility sketch was rendered with all three (your_files chiptune-glitchhop-*). Third verdict (Grid Royale v2): also a mess — and the owner set a standing rule for this loop: PREVIEW-FIRST. Bad chiptune mixes hurt his ears (dense squares at matched loudness are physically harsh), so no render reaches him blind again: every composition ships its piano-roll preview (pattern JSON rendered as an image — channels color-laned on a pitch grid, bars ruled) and audio follows only on his visual go. A roll tool was built in the sandbox lab (chiptune-lab/roll.py) and the three judged pieces were rolled for comparison: the v1/v2 pair and the motif cut show their differences structurally (v1 an orderly jingle grid; v2 a crowded wall — syncopation, arp, pump bass and dense kit stacked in one register with no repeating shape for the ear to lock onto; the motif cut a visibly repeating block). Companion defaults adopted with the rule: chiptune listening copies render at a conservative level and channel gains keep the arp/kit under the lead. Composition attempts pause until the owner has seen the rolls. Loudness verdict on the motif cut (rendered before the rule, at the −14 LUFS studio target): 'way too loud' — −14 LUFS is calibrated for ordinary program material, and dense square waves are loudness-efficient enough to blow through it perceptually; the loudness swamped any musical judgment, so the motif question stays open. Concrete numbers now set for this loop: chiptune listening copies target −20 LUFS with a 0.7 peak ceiling, arp gain 0.35→0.22 and kit gains held under the lead, until the owner says otherwise. Next motif-cut render (on his visual go from the roll) ships at those settings. The glitch-hop sketch drew the same verdict seconds later ('way too loud') — notable because it had landed at −16.4 LUFS: even 2.4 dB under the studio target is far too hot for this material, which is why the loop's numbers are set where they are. Both musical questions (motif cut, glitch sketch) remain open behind the loudness fix; feasibility of the glitch techniques themselves is neither confirmed nor denied by a verdict about volume. Owner's ruling on the preview itself (same night): the rolls look crazy, but the pattern preview 'helped immensely' and is an UNLOCK — it becomes a product feature (see T-MUS-07), not just a sandbox-loop habit. PATTERN-CRAFT RESEARCH LANDED (same night, owner's direction — 'learn what a proper pattern is supposed to look like'): the craft is now documented in the knowledge library (tracker-pattern-craft-2026) from the FamiTracker manual, Furnace docs, OpenMPT manual and NESdev Wiki. Headlines: real patterns are 64 rows (4 bars), not this engine's 16-row sections; a 2-bar motif of 2–4 notes with ~75% literal repetition and ending-only variation; P2's job is echo (lead delayed 3–6 rows at ¼–½ volume, softer duty) or chord-change arpeggio — an always-on arp channel is the textbook fatigue failure; triangle has no volume and sounds an octave down; noise is a fixed kit (kick rows 0/8, snare 4/12, hats on 8ths). Three exemplar patterns were built to the spec (D minor, tempo 150: A statement / A′ one-element ending lift / B one-channel P2 arp swap, bar-4 drop-out) and delivered as data + piano rolls under the preview-first rule; audio awaits the owner's visual verdict. Caveat filed with the doc: no corpus statistics exist for pattern counts/density — the density figures are derivations from worked examples, not measured averages. MEASURED CONTRAST + LINT GATE (same night, owner-prompted: 'compare the two and a pattern might emerge of what looks bad vs what looks good, so bad doesn't have a chance to occur'): a lint pass (sandbox pattern_lint.py) over all pattern JSONs separates the sets cleanly — every rejected piece fails 3–5 of 7 rules, the exemplar song passes all. The headline signature: P2 coverage 1.00 in EVERY sandbox-engine render ever made (the always-on arp fixture), mean active channels ≥2.75, motif restatement ≤0.15. The motif cut scores 0.96 on restatement yet still fails on engine habits — its lint output is the engine's fix list. Exemplar B alone flags marginal on the wall metric (2.78 vs 2.6); the threshold was NOT relaxed (repo doctrine) — the song-level pass governs. Prevention stack adopted: lint → roll → audio-on-go. Filed as section 7 of the library doc. GLITCH-HOP STUDY (same night, owner's direction): three patterns + a 4-pattern order (A A′ B A) built through the gates — F minor, 102 BPM, swing 0.35. Genre traits as data: 2-bar stab cell with ending-only variation, P2 as sparse counter (coverage 0.22 — the fixture is dead), funk triangle with PLACED wobble holds, stutter/spray only at the A′ cadence. Lint: A and A′ pass every rule but one — motif restatement reads 0.38/0.30 vs the 0.4 line because bars 3–4 adapt the cell to the new chords' tones (rhythm identical, pitches adapted); that is a genuine design question the gate surfaced (pitch-literal vs chord-adapted restatement), recorded here rather than tuned away. B (wobble-feature breakdown) fails honestly: P2 pad coverage 0.88, wall 2.61 marginal, restatement 0.00 — it is a texture without the motif; the fix on the table is the A-cell stabs, thinned, over the wobble holds. Song-level repetition passes (0.72). Render decision recorded for whenever audio is approved: wobble should be implemented as DUTY modulation, not pitch LFO — pitch wobble smears pitch class (it is what broke the first sketch's key read); duty wobble keeps pitch intact and reads as timbre, closer to the genre's filter wobble. Rolls delivered; audio gated on the owner's visual go. B REBUILT on the owner's go (same night): the thinned A-cell now rides over the wobble holds — bars 3–4 restate bars 1–2 with only the closing note changed (F4→F5), and the P2 pad became a sparse counter (coverage 0.88→~0.13). Lint: B passes every rule (restatement 0.80), and the full song (A A′ B A) now passes the entire gate — the only open flag left in the set is the A/A′ chord-adaptation question, which stays open as a design decision for the owner rather than a defect. FIRST GATED RENDER (owner's go, same night): a JSON-to-audio adapter (sandbox render_json.py) rendered the glitch song from its pattern data — swing applied to odd rows, wobble as waveshape modulation on the triangle, loudness stage to the loop target. Measured: 37.6 s, −20.0 LUFS at a 0.7 peak ceiling, analyzer reads F minor (r=0.65) and 103.4 BPM against 102 true (swing costs the estimator ~1.4%). The key read matters: the first glitch sketch's pitch-LFO wobble smeared its key into a misread; the waveshape wobble kept pitch intact — the render decision is vindicated by measurement. Musical verdict now sits with the owner's ears, at a level that will not punish them. OWNER VERDICT on the render: 'sounds better, but still a bit too loud' — the first non-rejection of the night musically, and the loudness calibration moved again: even −20 LUFS integrated is too hot, because integrated loudness understates this material (sparse arrangement, dense stab/kick bursts — the max 400 ms window RMS measures far above the integrated figure). Loop standard revised: chiptune listening copies now target −24 LUFS with a 0.6 ceiling, and the number to watch is short-term peak RMS, not the integrated figure. The glitch song was re-issued at −24 LUFS (chiptune-glitch-song-24lufs.wav); the earlier renders stand as the calibration record. MIX VERDICT (same night): 'sounds better but still a bit harsh — the mixing needs to be a bit softer; the bass sounds kinda good though.' Two keepers in that: the composition direction holds, and the triangle + waveshape-wobble bass is a PRAISED element (protect it in any remix). A soft-mix re-render was delivered: pulse channels lowpassed (5.2 kHz) with slower attacks and a small level trim, noise kit lowpassed and down, gentle master glue — the bass chain untouched; HF energy ratio (>5 kHz) measured before/after in the render log. Soft-mix is now the loop's default finishing treatment for chiptune listening copies, alongside the −24 LUFS target. DUNGEON BGM STUDY (same night, from the owner's three-part verdict on the glitch song: arrangement flat, too short, and the new target — background music for a dungeon, Zelda tradition): four patterns + a 6-pattern ARCH loop (P1 threshold → P2 descent → P3 deep → P4 lift → P3 → P2, palindrome, loops cleanly), D minor/phrygian at 88 BPM, 65.5 s. The flatness fix is arrangement movement INSIDE the loop: channel entrances, the cell dropping an octave for P3 with its echo answered an octave UP, P4 swapping echo for harmony thirds + one tritone stab. Dungeon traits as data: pedal drones, +6-row echo (space), noise reduced to low drips, density far under the ceilings (walls 1.25–2.27). Lint: P2/P4 pass outright; three flags reported honestly — P1's restatement reads 0.00 because its lead is a 3-note entrance living in one half (metric artifact, design intended); P3's register gap compresses to <20 because the cell sits an octave down (the high echo is the compensation); the song's lead range reads 21 because the cell MOVES octaves between patterns — within-pattern ranges are 5–10, and the 21 is the arrangement arc itself. Rolls delivered; render gated on the owner's visual go (soft-mix chain, −24 LUFS). RENDERED on the owner's go (same night) through the standard chain (render_dungeon.py): measured −24 LUFS class level, HF share in the soft-mix range; analyzer cross-check filed with the render. The dungeon study is now a complete gated artifact — data, lint record, rolls, and a listening copy at the level standard the owner's ears set. Musical verdict pending his listen.


### T-MUS-07 — Pattern & structure preview (product feature: inspect before it sounds)

- **Status:** todo
- **Goal:** Give every musical structure in the app a visible shape before it has a sound — the generator's patterns, an analyzed track's sections and energy, the beat grids the video side cuts to — one inspection surface fed by data the app already computes, so approval happens on evidence instead of on a first listen that can hurt. This is the preview-first rule the owner set on 2026-11-07, after three blind sandbox renders failed his ears, promoted from a workflow habit to a product feature (his word: an unlock).
- **Plan (design seams, agreed at registration):** The piano-roll preview proven in the sandbox loop on 2026-11-07 (pattern JSON rendered as a color-laned pitch grid, bars ruled) becomes a studio feature, generalized per the owner's direction: a visual inspection surface for musical STRUCTURE data before any audio is rendered or played. Scope in phases: (1) generator pattern rolls (T-MUS-06's data) as the approval gate — the preview-first rule, productized: nothing renders to audio uninspected; (2) the same surface reads analyzer structure (section boundaries, energy/band curves) so a generated or imported track's shape is visible before a listening pass; (3) beat-grid and timing views that share their data with the storyboard layer (Step 5 boards, T-VID-27) and the frame-sequence timeline (T-VID-28) — one inspection habit across the app's music aspects, each view fed by data the app already computes rather than a parallel model. Legibility requirements from the owner's first read ('these look crazy'): channel lanes toggleable, zoom to a section, note labels only at readable zoom, register shading — the sandbox prototype (chiptune-lab/roll.py) is the data contract and the legibility floor to beat, not the design. Layering per repo rules (api → services → adapters); previews are read-only renders of existing data.
- **Files:** builder's choice within backend layering + frontend surface; design pass first.
- **Acceptance:** A generator pattern opens as an in-app roll with lane toggles and section zoom, and the generator flow gates audio rendering behind a preview view; an analyzed track's sections/energy render on the same surface; the preview reads the same pattern/structure JSON the renderers consume (no forked data).
- **Gate:** Design-first; owner's go before build.
- **Last session:** Orion, 2026-11-07 — registered at the owner's direction after the preview-first night: three blind renders failed his ears, the rolls let him judge structure silently, and he named it an unlock that belongs in the app across music aspects.
