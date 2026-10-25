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

TARGET: Media Library UI screenshot of Native Media AI Studio (\`output/\` file browser).

LAYER 1 — LOCATE:
Inspect these regions in order: (1) sidebar nav, (2) view tabs (Library/Favorites/Collections/Trash),
(3) toolbar (Grid/List toggles, Find Duplicates, Trash, Refresh), (4) FilterBar (search + type pills + sort),
(5) file cards grid/list, (6) detail modal, (7) playback modal, (8) empty states.

LAYER 2 — TASK:
Produce a UX audit with concrete, actionable findings. For each finding: name the element,
describe what is visible, rate severity (critical/minor/cosmetic), and give the shortest fix.

LAYER 3 — STEPS:
(1) Observe each region and list visible elements with positions.
(2) Check named heuristics: 8pt grid spacing, WCAG 4.5:1 contrast, line-height multiples of 4px,
   internal padding <= external margin.
(3) Identify affordances: hover states, focus rings, disabled states, play buttons on media.
(4) Conclude with ranked top-3 fixes by UX impact.

LAYER 4 — OUTPUT:
Return JSON with these exact keys:
- "elements": array of { name, position, role, visible: boolean }
- "layout": { issues: [string], grid_system: "8pt"|"other", spacing_violations: [string] }
- "typography": { font_sizes: [number], line_height_violations: [string], contrast_violations: [string] }
- "color": { primary_used: boolean, accent_used: boolean, contrast_ratio_issues: [string] }
- "affordances": { hover_states: [string], focus_rings: [string], disabled_states: [string], play_buttons: [string] }
- "empty_states": [string]
- "findings": array of { element, issue, severity: "critical"|"minor"|"cosmetic", fix: string }
- "top_3_fixes": array of 3 strings ranked by UX impact
<turn|>
<|model>
`;

export function buildGemma4UIPrompt(args = {}) {
  const label = args.label ? `\nSCREEN: ${args.label}` : '';
  const section = args.section ? `\nSECTION: ${args.section}` : '';
  const context = args.context ? `\nCONTEXT: ${args.context}` : '';
  const viewport = args.viewport ? `\nVIEWPORT: ${args.viewport}` : '';
  return GEMMA4_SYSTEM + GEMMA4_UI_PROMPT + label + section + context + viewport;
}

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
  const specific = GEMMA4_MODE_PROMPTS[mode] || GEMMA4_UI_PROMPT;
  const label = args.label ? `\nSCREEN: ${args.label}` : '';
  const context = args.context ? `\nCONTEXT: ${args.context}` : '';
  return GEMMA4_SYSTEM + specific + label + context;
}
