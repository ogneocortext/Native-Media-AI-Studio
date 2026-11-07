/**
 * Gemma 4 UI/UX Vision Prompt
 *
 * Gemma 4 strengths (per Google AI docs + Prompt Bench 2026):
 *   - Native multimodal vision: accurately identifies UI elements, layouts, color, typography
 *   - Native JSON structured output (format: "json"): reliable machine-readable results
 *   - Variable resolution budgets: tune maxDim to task (text-dense = higher)
 *   - 128K context window: fits detailed system prompt + image comfortably
 *   - Control tokens: <|turn>, <|system>, <|user>, <|model>, <|image|>
 *
 * Gemma 4 do's/don'ts:
 *   DO: be specific, name regions, provide constraints, iterative refinement
 *   DON'T: vague "analyze this", expect exact counts for dense objects
 *
 * Prompt structure (four layers from vision research):
 *   Layer 1 - Locate: region/subject to inspect
 *   Layer 2 - Task: concrete verb-led job
 *   Layer 3 - Steps: ordered observe->describe->reason->conclude
 *   Layer 4 - Output: structured format (JSON) with named fields
 *
 * Named heuristics (checkable rules, not taste):
 *   - 8pt grid: spacing/sizing in multiples of 8
 *   - WCAG 2.2 AA: 4.5:1 normal text contrast, 3:1 UI components
 *   - Line-height: multiples of 4px (16, 20, 24, 28, 32)
 *   - Internal <= external: padding no larger than margin
 */

export const GEMMA4_SYSTEM = `<|system>
You are a senior UX/UI design auditor for Native Media AI Studio. Analyze screenshots
using only visible evidence. Be specific, name regions, and provide constraints.
Do NOT infer beyond the pixels. If an element is not visible, say NOT VISIBLE.
Return ONLY valid JSON matching the schema below—no markdown fences, no prose.
<turn|>`;

export const GEMMA4_UI_PROMPT = `<|turn>user
<|image|>

TARGET: {{TARGET}} UI screenshot of Native Media AI Studio.

LAYER 1 — LOCATE:
Inspect the page's actual regions in order: navigation/sidebar, header/toolbar actions,
view tabs or filters, the primary content area, any detail/preview panels, and empty states.
Name what each region contains on THIS page before judging it.

LAYER 2 — TASK:
Produce a UX audit with concrete, actionable findings. For each finding: name the element,
describe what is visible, rate severity (critical/minor/cosmetic), and give the shortest fix.

LAYER 3 — STEPS:
(1) Observe each region and list visible elements with positions.
(2) FIRST check the page state: if the screenshot shows a loading spinner, skeleton, or empty state, say so in "summary" and report only what is actually rendered — do NOT describe expected content that is not visible.
(3) Check named heuristics: 8pt grid spacing, WCAG 4.5:1 contrast, line-height multiples of 4px,
   internal padding <= external margin.
(4) Identify affordances: hover states, focus rings, disabled states, play buttons on media.
(5) Conclude with ranked top-3 fixes by UX impact.

LAYER 4 — OUTPUT:
Return JSON with these exact keys:
- "elements": array of { name, position, role, visible: boolean }
- "layout": { issues: [string], grid_system: "8pt"|"other", spacing_violations: [string] }
- "typography": { font_sizes: [number], line_height_violations: [string], contrast_violations: [string] }
- "color": { primary_used: boolean, accent_used: boolean, contrast_ratio_issues: [string] }
- "affordances": { hover_states: [string], focus_rings: [string], disabled_states: [string], play_buttons: [string] }
- "empty_states": [string]
- "findings": array of { element, issue, severity: "critical"|"minor"|"cosmetic", confidence: "high"|"medium"|"low", fix: string } — report only issues you can actually see; use confidence "low" when the evidence is ambiguous
- "top_3_fixes": array of 3 strings ranked by UX impact
<turn|>
<|model>
`;

export const GEMMA4_MODE_PROMPTS = {
  ui: GEMMA4_UI_PROMPT,
  responsive: `<|turn>user
<|image|>

TARGET: Native Media AI Studio UI screenshot for responsive audit.

TASK: Audit responsive layout. Return JSON only.

STEPS:
1. Check viewport fit: any clipped, overflowing, or crammed content? Name element + CSS fix.
2. Check touch targets: buttons/inputs smaller than 44x44px? List each with estimated size.
3. Check readability: text below 14px or low contrast? Give exact text + issue.
4. Check navigation: content hidden behind menus/tabs/scroll? Identify hidden feature.

OUTPUT JSON keys:
- "viewport_fit": { ok: boolean, offenders: [string] }
- "touch_targets": array of { element, estimated_size_px, issue }
- "readability": array of { text, size_px, contrast_issue }
- "navigation_hidden": [string]
- "top_fix": string
<turn|>
<|model>
`,

  regression: `<|turn>user
<|image|>

TARGET: Native Media AI Studio rendered UI vs source code.

TASK: Compare rendered output to source implementation. Return JSON only.

STEPS:
1. List each discrepancy: element, style, or layout shift.
2. Rate severity: critical (breaks function), minor (visual polish), cosmetic.
3. Give shortest fix path. Reference likely source file if identifiable.
4. Give confidence: high/medium/low.

OUTPUT JSON keys:
- "discrepancies": array of { element, change, severity, fix, confidence }
<turn|>
<|model>
`,

  compare: `<|turn>user
<|image|>

TARGET: Two Native Media AI Studio screenshots — BEFORE (image 1) and AFTER (image 2).

TASK: List every visual difference. Return JSON only.

STEPS:
1. For each difference: location, change, impact (UX improvement/regression/neutral).
2. If regression: shortest fix. If improvement: which principle it demonstrates.
3. Prioritize usability, readability, visual hierarchy.

OUTPUT JSON keys:
- "differences": array of { location, change, impact, fix_or_promote }
<turn|>
<|model>
`,

  vizmode: `<|turn>user
<|image|>

TARGET: {{TARGET}} — audio-reactive visualization mode.

The attached images are 3 chronological frames (~2s apart) of the SAME
visualizer mode playing a music track. Reason about the mode as a piece
of motion design, not a static screenshot.

LAYER 1 — LOCATE:
Identify the visual elements: spectrum/particles/waveform/3D scene/lyric
type, background treatment, any HUD or chrome baked into the canvas,
and where the visual focal point sits in the frame.

LAYER 2 — TASK:
Score the mode's presentation quality on a 1-5 scale per dimension,
then give concrete findings. A 5 means "could ship in a professional
audio plugin"; 1 means "prototype/demo quality".

DIMENSIONS:
- composition: focal hierarchy, rule-of-thirds use, negative space, does the eye know where to look
- reactivity: is the audio visibly driving the motion (beat hits, bass weight, spectral detail) or is it decorative noise
- readability: can the visualization be parsed at a glance; text/HUD legibility; contrast
- motion: from the 3 frames — does movement look eased and intentional vs jittery, strobing, or stepped; transitions between states
- color: palette cohesion and discipline vs rainbow/default-hue slop; glow/bloom restraint
- polish: anti-aliasing, particle quality, edge treatment, "designed" vs "generated-demo" finish

LAYER 3 — STEPS:
(1) Describe what each frame shows and what changed between them.
(2) Score each dimension honestly — do not inflate; most modes score 2-3.
(3) List strengths (what already works) and findings with severity.
(4) Give top fixes ranked by impact on perceived quality.

LAYER 4 — OUTPUT:
Return JSON with these exact keys:
- "mode_id": string echoing the mode name given in TARGET
- "scores": { "composition": n, "reactivity": n, "readability": n, "motion": n, "color": n, "polish": n, "overall": n } — numbers 1-5, overall is your honest composite
- "strengths": array of strings — what already works
- "findings": array of { element, issue, severity: "critical"|"major"|"minor"|"cosmetic"|"info", confidence: "high"|"medium"|"low", fix: string }
- "top_fixes": array of up to 3 strings ranked by impact
- "uncertain": array of strings — anything you cannot verify from the frames
- "summary": one sentence verdict on this mode's current presentation quality
<turn|>
<|model>
`,

  ocr: `<|turn>user
<|image|>

TASK: Transcribe all visible text preserving original line breaks, punctuation, and reading order.
If a table exists, convert to markdown. If a region is unclear write [unclear].
Do NOT invent text. Return JSON: { "text": string, "unclear_regions": [string] }.
<turn|>
<|model>
`,

  chart: `<|turn>user
<|image|>

TASK: Describe the chart trend. Name axes, units, and relative heights. Compare bars/lines.
Note peaks/valleys. Flag ambiguous values as "estimated". Do NOT invent exact numbers.
Return JSON: { "axes": [string], "trend": string, "peaks": [string], "valleys": [string], "estimated": [string] }.
<turn|>
<|model>
`,
};

export function buildGemma4Prompt(mode, args = {}) {
  const specific = (GEMMA4_MODE_PROMPTS[mode] || GEMMA4_UI_PROMPT)
    .replace('{{TARGET}}', args.label || 'application');
  const label = args.label ? `\nSCREEN: ${args.label}` : '';
  const context = args.context ? `\nCONTEXT: ${args.context}` : '';
  return GEMMA4_SYSTEM + specific + label + context;
}
