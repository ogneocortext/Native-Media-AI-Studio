# suno-templates/ — Suno v6-mini Templates (static snapshot)

Interactive prompting workbench for getting the best drafts out of **Suno
v6-mini** (free tier). Open `index.html` in a browser — no build step.

## What it does

- Style-prompt builder calibrated for v6-mini: front-loads the big decisions
  (genre → groove → vocal), counts descriptors across the whole prompt, and
  tells you to cut from the tail when you're past mini's headroom.
- **Mandatory intro direction** (lands in the style prompt and the intro tag;
  red-flagged when empty) — cheesy first seconds were the observed failure
  point (~1/4 keeper rate).
- Cheese checklist: flags bare emotion words with performance-verb swaps;
  routes real negatives to the Exclude styles field.
- Pattern library: logs which lean descriptor combos produce keepers on mini,
  hit vs miss. Entries live in the page for the session only — use the
  Download/Import JSON buttons to keep the log between visits.
- "Where mini stops" section: the handoff to this repo (see D23 in
  `docs/architecture/decision-log.md`).

## Constraints the page assumes (do not re-litigate)

- v6-mini ONLY. Never v6 or v6-wild; never suggest a Pro/Premier path.
- Mini drifts on overstuffed prompts: fewer variables, most important
  decisions first. Variety = 0.
- Mini is the raw-material instrument; this repo is the post-production
  (mix polish, consistency/arrangement repair, mastering) and the visual
  edit. D23.

## Maintenance

This is a static snapshot of the owner's "Suno v6-mini Templates" web
artifact. To update it, rebuild the artifact and re-copy `index.html`
(and `icon.jpg` if changed). Do not hand-edit the HTML for content changes —
make them in the artifact so the owner's live copy stays the source of truth.
