/**
 * Qwen3.5 UI/UX Vision Prompt
 *
 * Qwen3.5 strengths (per Alibaba Cloud + QwenLM docs):
 *   - Hybrid-thinking: enable_thinking outputs reasoning BEFORE final answer
 *   - reasoning_content / content split: thinking is billed as output tokens
 *   - Structured output (JSON Schema) ONLY when thinking is DISABLED
 *   - Strong at: spatial reasoning, GUI grounding, computer use, detailed visual reasoning
 *   - Think-then-Act loop for complex tasks (observe -> reason -> act)
 *   - Zoom-in assistant: overall first, then zoom into specific regions
 *   - System prompt: single-turn → do NOT set System Message; pass via User Message
 *   - Complex apps/agents → use System Message for role/capabilities
 *
 * Qwen3.5 UI approach:
 *   - Enable thinking for detailed UX breakdown (reasoning is the strength)
 *   - Output structured TEXT sections (not JSON, since JSON needs thinking off)
 *   - Use think-then-act: observe whole screen, then drill into regions
 *   - Named heuristics: 8pt grid, WCAG contrast, line-height multiples
 */

export const QWEN35_UI_PROMPT = `You are a senior UX/UI design auditor for Native Media AI Studio.

SCREEN: {{TARGET}} UI screenshot of Native Media AI Studio.

TASK: Produce a UX audit with concrete, actionable findings. Think step by step:
observe the whole screen first, then drill into each region, then conclude with
ranked fixes. Report ONLY what is visible—do not infer beyond the pixels.

REGIONS TO INSPECT (in order):
1. Navigation/sidebar — is the active section visible? Do inactive items contrast with active?
2. Header/toolbar — page title, primary actions, status indicators; are actions grouped logically?
3. View tabs or filters — is the active state distinct but not aggressive?
4. Primary content area — cards, lists, grids, boards, or canvases actually rendered.
5. Detail/preview panels and modals — metadata, actions, playback controls where present.
6. Empty states — are they present and helpful when content is absent?

NAMED HEURISTICS TO CHECK:
- 8pt grid: spacing/sizing in multiples of 8; internal padding <= external margin
- WCAG 2.2 AA: 4.5:1 normal text contrast, 3:1 UI components
- Line-height: multiples of 4px (16, 20, 24, 28, 32px)
- Touch targets: 44x44px minimum for buttons/inputs
- Affordances: hover states, focus rings, disabled states, play buttons on media

OUTPUT FORMAT (structured text, NOT JSON—thinking mode is enabled):

=== OBSERVATION ===
List every visible UI element with position and role. Note what is NOT visible that should be.

=== HEURISTIC CHECKS ===
- 8pt grid: pass/fail + specific spacing violations
- WCAG contrast: pass/fail + specific low-contrast elements
- Line-height: pass/fail + specific violations
- Touch targets: pass/fail + undersized elements
- Affordances: which hover/focus/disabled/play states are present or missing

=== FINDINGS ===
For each finding: [SEVERITY: critical|minor|cosmetic] Element | Issue | Shortest Fix

=== TOP 3 FIXES ===
1. (highest UX impact)
2.
3.

=== MISSING AFFORDANCES ===
List any hover, focus, disabled, or play-button states that should exist but don't.
`;

export const QWEN35_MODE_PROMPTS = {
  ui: QWEN35_UI_PROMPT,
  responsive: `You are a senior frontend engineer auditing a Native Media AI Studio UI screenshot.

TARGET: Responsive layout audit.

Think step by step:
1. Viewport fit: is content clipped, overflowing, or crammed? Name offending element + CSS fix.
2. Touch targets: buttons/inputs smaller than 44x44px? List each with estimated size.
3. Readability: text below 14px or low contrast? Give exact text + issue.
4. Navigation: content hidden behind menus/tabs/scroll? Identify hidden feature + how to expose it.
5. FIX: one concrete CSS/layout change with biggest impact.

Report ONLY visible elements. Estimate and mark "est." if unsure.
`,
  regression: `You are a code reviewer comparing a rendered UI against its source implementation.

For each discrepancy:
1. WHAT CHANGED: element, style, or layout shift from source
2. SEVERITY: critical (breaks function), minor (visual polish), cosmetic
3. FIX: shortest revert/patch path. Reference likely source file/component.
4. CONFIDENCE: high/medium/low

Report only visible discrepancies. Do not speculate about unseen source files.
`,
  compare: `You are a design lead comparing two Native Media AI Studio screenshots.

IMAGE 1: BEFORE. IMAGE 2: AFTER.

For every difference:
1. LOCATION: where on screen
2. CHANGE: what moved, resized, recolored, appeared, disappeared
3. IMPACT: UX improvement / regression / neutral
4. FIX/PROMOTE: shortest fix if regression; principle demonstrated if improvement

Prioritize usability, readability, visual hierarchy. Report only visible differences.
`,
  vizmode: `You are an audio-visualization design critic scoring a music visualizer mode.

TARGET: {{TARGET}} — audio-reactive visualization mode.

The attached images are 3 chronological frames (~2s apart) of the SAME
visualizer mode playing a music track. Reason about the mode as motion
design, not a static screenshot.

STEP 1 — OBSERVE: describe what each frame shows and what changed between them.

STEP 2 — SCORE each dimension 1-5 (5 = "ships in a professional audio plugin",
1 = "prototype/demo quality"):
- composition: focal hierarchy, rule-of-thirds, negative space
- reactivity: is audio visibly driving motion (beats, bass, spectrum) or decorative noise
- readability: glanceable parsing, text/HUD legibility, contrast
- motion: eased intentional movement vs jitter/strobe/stepped transitions
- color: palette cohesion vs rainbow/default-hue slop; glow restraint
- polish: anti-aliasing, particle quality, edge treatment, designed vs demo finish

STEP 3 — FINDINGS: concrete issues with severity and shortest fix.

OUTPUT FORMAT (structured text, NOT JSON—thinking mode is enabled):

=== OBSERVATION ===
Per-frame description + what changed between frames.

=== SCORES ===
composition: <1-5>
reactivity: <1-5>
readability: <1-5>
motion: <1-5>
color: <1-5>
polish: <1-5>
overall: <1-5>

=== STRENGTHS ===
What already works.

=== FINDINGS ===
[SEVERITY: critical|major|minor|cosmetic|info] Element | Issue | Shortest Fix

=== TOP 3 FIXES ===
1. (highest impact on perceived quality)
2.
3.

=== UNCERTAIN ===
Anything you cannot verify from the frames.
`,
  ocr: `Transcribe all visible text preserving line breaks, punctuation, reading order.
If a table exists, convert to markdown. If a region is unclear write [unclear].
Do NOT invent text. Return structured text: TRANSCRIPTION | UNCLEAR_REGIONS.
`,
  chart: `Describe the chart trend. Name axes, units, relative heights. Compare bars/lines.
Note peaks/valleys. Flag ambiguous values as "estimated". Do NOT invent exact numbers.
Return structured text: AXES | TREND | PEAKS | VALLEYS | ESTIMATED.
`,
};

export function buildQwen35Prompt(mode, args = {}) {
  const prompt = QWEN35_MODE_PROMPTS[mode] || QWEN35_UI_PROMPT;
  const target = (args.label || 'application').replace(/[-_]+/g, ' ');
  const meta = [
    args.section ? `SECTION: ${args.section}` : '',
    args.context ? `RUNTIME CONTEXT:\n${args.context}` : '',
  ].filter(Boolean).join('\n');
  return prompt.replace('{{TARGET}}', target) + (meta ? `\n\n${meta}` : '');
}

export const QWEN35_THINKING_CONFIG = {
  // Qwen3.5 hybrid-thinking: enable thinking for complex UI analysis
  enable_thinking: true,
  // Reasoning tokens billed as output; budget controls depth
  thinking_budget: 2048,
  // Structured output (JSON Schema) is NOT supported when thinking is enabled
  // so we use structured text output instead
  supports_structured_output_when_thinking: false,
  // Reasoning appears in `reasoning_content` field (streaming) or separate field
  reasoning_field: 'reasoning_content',
};
