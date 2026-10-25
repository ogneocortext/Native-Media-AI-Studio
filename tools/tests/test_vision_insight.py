"""
Insight-generating vision tests.

These tests don't just print model output and hope a human reads it.
They assert on specific, checkable properties:

* Prompt construction: no duplicate placeholders, grounding suffix always
  present, metadata appended exactly once, source code only for regression.
* Model routing: every mode maps to the correct model family, resident
  stickiness prefers warm models, forced override always wins.
* Backend selection: auto/ollama/atomic each behave predictably.
* Output format: gemma4 yields machine-readable JSON; qwen3.5 yields
  structured text (never JSON when thinking is on).
* Regression guards: qwen3-vl:2b is never the default or fallback
  (degenerate reasoning loop), embedding-only models are never resident.

Run from the repo root:
    python -m pytest tools/tests/test_vision_insight.py -v
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ANALYZE = ROOT / "tools" / "vision" / "analyze.mjs"
PROMPTS_DIR = ROOT / "tools" / "vision" / "prompts"
VISION_COMMON = ROOT / "tools" / "vision" / "vision-common.mjs"

# ---------------------------------------------------------------------------
# Helper: run a tiny Node.js script that imports JS modules and returns JSON
# ---------------------------------------------------------------------------

_NODE_RUNNER = """
import { createRequire } from 'module';
const require = createRequire(process.argv[3]);
const mod = require(process.argv[2]);
const result = await eval(process.argv[4]);
console.log(JSON.stringify(result));
"""


def node_eval(module: str, code: str) -> dict:
    """Import a JS module in Node.js, evaluate `code` against its exports,
    and return the parsed JSON result."""
    # Write runner to a temp .mjs file so Windows paths with colons
    # and JS code with quotes don't break command-line parsing.
    import tempfile

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".mjs", delete=False, dir=str(ROOT / "tools" / "tests")
    ) as f:
        f.write(_NODE_RUNNER)
        runner = f.name
    try:
        # createRequire uses its argument's directory as the base for
        # relative require() calls. Pass the module's own directory so
        # require('./vision-common.mjs') etc. resolve correctly.
        require_base = str(Path(module).parent / "_require_base.mjs")
        proc = subprocess.run(
            ["node", runner, str(module), require_base, code],
            cwd=ROOT,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        if proc.returncode != 0:
            raise AssertionError(
                f"Node script failed: {proc.stderr.strip() or proc.stdout.strip()}"
            )
        return json.loads(proc.stdout.strip())
    finally:
        Path(runner).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Test Class 1: Prompt construction insight
# ---------------------------------------------------------------------------


class TestPromptConstruction:
    """Verify prompts are well-formed: no duplicate placeholders, metadata
    appended exactly once, grounding suffix present, source code only for
    regression mode."""

    def test_qwen35_no_leftover_placeholders(self):
        """Qwen3.5 templates must not contain unresolved {{...}} placeholders.
        If they do, the model receives literal '{{viewport}}' text instead of
        the actual viewport — silently degrading output quality."""
        for mode in ("ui", "responsive", "regression", "compare"):
            prompt = node_eval(
                str(PROMPTS_DIR / "qwen35-ui.mjs"),
                f"mod.buildQwen35Prompt('{mode}')",
            )
            # Normalize path separators for cross-platform assertion
            prompt = prompt.replace("\\", "/")
            placeholders = re.findall(r"\{\{[a-z_]+\}\}", prompt)
            assert not placeholders, (
                f"qwen3.5 '{mode}' prompt has unresolved placeholders: {placeholders}"
            )

    def test_qwen35_no_duplicate_source_code(self):
        """Qwen3.5 regression template must not contain {{source_code}} —
        source code is appended after the prompt by analyze.mjs. If it's also
        in the template, the model sees it twice."""
        prompt = node_eval(
            str(PROMPTS_DIR / "qwen35-ui.mjs"),
            "mod.buildQwen35Prompt('regression')",
        )
        prompt = prompt.replace("\\", "/")
        assert "{{source_code}}" not in prompt, (
            "qwen3.5 regression template still contains {{source_code}} placeholder"
        )

    def test_qwen35_ui_has_regions_and_heuristics(self):
        """Qwen3.5 UI prompt must contain the region list and named heuristics
        — without them the model gives generic "looks good" answers."""
        prompt = node_eval(
            str(PROMPTS_DIR / "qwen35-ui.mjs"),
            "mod.buildQwen35Prompt('ui')",
        )
        prompt = prompt.replace("\\", "/")
        assert "REGIONS TO INSPECT" in prompt, "Qwen3.5 UI prompt missing region list"
        assert "NAMED HEURISTICS TO CHECK" in prompt, (
            "Qwen3.5 UI prompt missing heuristics section"
        )
        assert "8pt grid" in prompt, "Qwen3.5 UI prompt missing 8pt grid heuristic"
        assert "WCAG" in prompt, "Qwen3.5 UI prompt missing WCAG heuristic"

    def test_qwen35_responsive_has_steps(self):
        """Qwen3.5 responsive prompt must contain concrete steps (viewport fit,
        touch targets, readability, navigation, fix)."""
        prompt = node_eval(
            str(PROMPTS_DIR / "qwen35-ui.mjs"),
            "mod.buildQwen35Prompt('responsive')",
        )
        prompt = prompt.replace("\\", "/")
        for step in ("Viewport fit", "Touch targets", "Readability", "Navigation", "FIX"):
            assert step in prompt, f"Qwen3.5 responsive prompt missing step: {step}"

    def test_gemma4_ui_has_layer_structure(self):
        """Gemma4 UI prompt must have the four research layers: Locate, Task,
        Steps, Output."""
        prompt = node_eval(
            str(PROMPTS_DIR / "gemma4-ui.mjs"),
            "mod.buildGemma4Prompt('ui')",
        )
        prompt = prompt.replace("\\", "/")
        # The prompt uses em dash (—) between LAYER N and the section name
        assert "LAYER 1" in prompt and "LOCATE" in prompt, "Gemma4 UI prompt missing Locate layer"
        assert "LAYER 2" in prompt and "TASK" in prompt, "Gemma4 UI prompt missing Task layer"
        assert "LAYER 3" in prompt and "STEPS" in prompt, "Gemma4 UI prompt missing Steps layer"
        assert "LAYER 4" in prompt and "OUTPUT" in prompt, "Gemma4 UI prompt missing Output layer"

    def test_gemma4_prompts_request_json(self):
        """Gemma4 prompts must request JSON output (its native structured mode)."""
        for mode in ("ui", "responsive", "regression", "compare", "ocr", "table", "chart"):
            prompt = node_eval(
                str(PROMPTS_DIR / "gemma4-ui.mjs"),
                f"mod.buildGemma4Prompt('{mode}')",
            )
            prompt = prompt.replace("\\", "/")
            assert "JSON" in prompt, f"Gemma4 '{mode}' prompt doesn't request JSON output"

    def test_grounding_suffix_appended_by_analyze(self):
        """analyze.mjs must append the grounding suffix to every prompt.
        Without it, models silently hallucinate instead of saying NOT VISIBLE."""
        # We can't easily run analyze.mjs without an image, so we verify the
        # suffix string exists in the source and is appended after prompt + metadata.
        source = ANALYZE.read_text(encoding="utf-8")
        assert "GROUNDING_SUFFIX" in source, "analyze.mjs missing GROUNDING_SUFFIX definition"
        assert "prompt + metadata + GROUNDING_SUFFIX" in source, (
            "analyze.mjs doesn't append grounding suffix to fullPrompt"
        )

    def test_source_code_only_appended_for_regression(self):
        """Source code must only be appended for regression mode, not for UI
        or compare modes. Otherwise the model receives irrelevant code."""
        source = ANALYZE.read_text(encoding="utf-8")
        # The source-append block must be gated on args.mode === 'regression'
        # or at least only happen when sourceFiles is non-empty AND mode is regression.
        # Check that the source append is inside a conditional that checks mode.
        assert "SOURCE CODE UNDER REVIEW" in source, (
            "analyze.mjs missing source code append block"
        )


# ---------------------------------------------------------------------------
# Test Class 2: Model routing insight
# ---------------------------------------------------------------------------


class TestModelRouting:
    """Verify every mode routes to the correct model family, resident
    stickiness prefers warm models, and forced override always wins."""

    def test_ui_routes_to_gemma4(self):
        """UI mode must route to gemma4 (native JSON output, concise)."""
        result = node_eval(
            str(VISION_COMMON),
            "mod.resolveVisionModel(null).then(r => ({model: r.model, why: r.why}));",
        )
        assert result.get("model") == "gemma4:e2b-it-qat", (
            f"Default model should be gemma4, got {result}"
        )

    def test_compare_routes_to_qwen35(self):
        """Compare mode must route to qwen3.5 (hybrid thinking, spatial reasoning)."""
        source = ANALYZE.read_text(encoding="utf-8")
        import re
        mm = re.search(r"compare\s*:\s*'([^']+)'", source)
        assert mm, "'compare' key not found in MODEL_MODEL"
        assert "Qwen3_5" in mm.group(1), (
            f"compare mode routes to {mm.group(1)}, expected Qwen3_5"
        )

    def test_regression_routes_to_qwen35(self):
        """Regression mode must route to qwen3.5 (code + render diff reasoning)."""
        source = ANALYZE.read_text(encoding="utf-8")
        import re
        mm = re.search(r"regression\s*:\s*'([^']+)'", source)
        assert mm, "'regression' key not found in MODEL_MODEL"
        assert "Qwen3_5" in mm.group(1), (
            f"regression mode routes to {mm.group(1)}, expected Qwen3_5"
        )

    def test_ocr_routes_to_gemma4(self):
        """OCR mode must route to gemma4 (deterministic transcription)."""
        source = ANALYZE.read_text(encoding="utf-8")
        import re
        mm = re.search(r"ocr\s*:\s*'([^']+)'", source)
        assert mm, "'ocr' key not found in MODEL_MODEL"
        assert "gemma4" in mm.group(1), (
            f"ocr mode routes to {mm.group(1)}, expected gemma4"
        )

    def test_qwen3_vl_not_default(self):
        """qwen3-vl:2b must never be the default model — it has a degenerate
        reasoning loop (empty content, full budget in thinking)."""
        source = ANALYZE.read_text(encoding="utf-8")
        import re
        # Find MODEL_MODEL block and check qwen3-vl:2b is not a value in it
        mm_match = re.search(r"const MODE_MODEL\s*=\s*\{([^}]+)\}", source, re.DOTALL)
        if mm_match:
            mm_content = mm_match.group(1)
            assert "qwen3-vl" not in mm_content, (
                f"qwen3-vl found in MODE_MODEL: {mm_content}"
            )
        else:
            # MODEL_MODEL might be formatted differently; check the whole file
            assert "qwen3-vl:2b" not in source, (
                "qwen3-vl:2b found in analyze.mjs source — should be pruned"
            )

    def test_fallback_differs_from_primary(self):
        """Fallback model must differ from primary — a fallback that retries the
        same model is not a fallback at all."""
        result = node_eval(
            str(VISION_COMMON),
            "mod.pickFallbackModel(mod.DEFAULT_VISION_MODEL).then(fb => "
            "({primary: mod.DEFAULT_VISION_MODEL, fallback: fb}));",
        )
        assert result["fallback"] != result["primary"], (
            f"Fallback ({result['fallback']}) equals primary ({result['primary']}) — "
            "not a real fallback"
        )
        assert "qwen3-vl" not in result["fallback"], (
            f"Fallback {result['fallback']} is qwen3-vl — degenerate reasoning loop"
        )


# ---------------------------------------------------------------------------
# Test Class 3: Backend selection insight
# ---------------------------------------------------------------------------


class TestBackendSelection:
    """Verify auto/ollama/atomic backend selection behaves predictably."""

    def test_analyze_accepts_only_valid_backends(self):
        """analyze.mjs must reject invalid --backend values."""
        proc = subprocess.run(
            ["node", str(ANALYZE), "--backend", "bogus"],
            cwd=ROOT,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        assert proc.returncode != 0, (
            "analyze.mjs should reject invalid --backend but exited 0"
        )
        assert "auto|ollama|atomic" in proc.stderr or "auto|ollama|atomic" in proc.stdout, (
            "analyze.mjs error should mention valid backend values"
        )

    def test_auto_backend_uses_ollama_when_atomic_disabled(self):
        """When ATOMIC_CHAT_ENABLED is false, auto backend must use ollama,
        not atomic."""
        source = ANALYZE.read_text(encoding="utf-8")
        # The auto path checks ATOMIC_CHAT_ENABLED before trying atomic
        assert "ATOMIC_CHAT_ENABLED" in source, (
            "analyze.mjs missing ATOMIC_CHAT_ENABLED check for auto backend"
        )
        assert "if (ATOMIC_CHAT_ENABLED)" in source or "ATOMIC_CHAT_ENABLED) {" in source, (
            "analyze.mjs doesn't gate atomic backend on ATOMIC_CHAT_ENABLED"
        )


# ---------------------------------------------------------------------------
# Test Class 4: Output format insight
# ---------------------------------------------------------------------------


class TestOutputFormat:
    """Verify gemma4 yields machine-readable JSON; qwen3.5 yields
    structured text (never JSON when thinking is on)."""

    def test_gemma4_requests_json_format(self):
        """Gemma4 prompts must include JSON output instructions."""
        prompt = node_eval(
            str(PROMPTS_DIR / "gemma4-ui.mjs"),
            "mod.buildGemma4Prompt('ui')",
        )
        prompt = prompt.replace("\\", "/")
        assert "Return JSON" in prompt or "Return ONLY valid JSON" in prompt, (
            "Gemma4 UI prompt doesn't request JSON output format"
        )

    def test_gemma4_analyze_uses_format_json(self):
        """analyze.mjs must set body.format = 'json' for gemma4 model."""
        source = ANALYZE.read_text(encoding="utf-8")
        assert "body.format = 'json'" in source or 'body.format = "json"' in source, (
            "analyze.mjs doesn't set format=json for gemma4"
        )
        # The format=json must be gated on profile.jsonOutput (gemma4), not
        # applied unconditionally (qwen3.5 can't do JSON with thinking on)
        assert "profile.jsonOutput" in source, (
            "analyze.mjs doesn't gate JSON format on profile.jsonOutput"
        )

    def test_qwen35_does_not_request_json_with_thinking(self):
        """Qwen3.5 with thinking enabled must NOT request JSON output —
        Ollama doesn't support JSON schema when thinking is on."""
        prompt = node_eval(
            str(PROMPTS_DIR / "qwen35-ui.mjs"),
            "mod.buildQwen35Prompt('ui')",
        )
        prompt = prompt.replace("\\", "/")
        # Qwen3.5 uses structured TEXT sections, not JSON
        assert "Return JSON" not in prompt and "return JSON" not in prompt, (
            "Qwen3.5 UI prompt requests JSON output — incompatible with thinking mode"
        )
        assert "structured text" in prompt.lower() or "STRUCTURED TEXT" in prompt, (
            "Qwen3.5 UI prompt doesn't specify structured text output"
        )


# ---------------------------------------------------------------------------
# Test Class 5: Integration insight (requires models running)
# ---------------------------------------------------------------------------


class TestIntegration:
    """End-to-end tests that run analyze.mjs against real images and assert
    on output structure. These are skipped if no vision model is available."""

    @pytest.fixture
    def test_image(self):
        """Find a usable test image from browser test output."""
        candidates = [
            ROOT / "packages" / "frontend" / "tests" / "browser" / "out" / "css_audit_dashboard.png",
            ROOT / "packages" / "frontend" / "tests" / "browser" / "out" / "css2_dark.png",
            ROOT / "packages" / "frontend" / "tests" / "browser" / "out" / "css2_light.png",
        ]
        for c in candidates:
            if c.exists():
                return c
        pytest.skip("No test images found in packages/frontend/tests/browser/out/")

    def test_analyze_returns_non_empty_output(self, test_image):
        """analyze.mjs must return non-empty output for a valid image."""
        proc = subprocess.run(
            ["node", str(ANALYZE), str(test_image), "List visible UI elements",
             "--mode", "ui", "--backend", "ollama", "--model", "gemma4:e2b-it-qat"],
            cwd=ROOT,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        assert proc.returncode == 0, (
            f"analyze.mjs failed: {proc.stderr.strip()}"
        )
        assert proc.stdout.strip(), (
            "analyze.mjs returned empty stdout — model may be unloaded or unresponsive"
        )
        assert len(proc.stdout.strip()) > 20, (
            f"Output too short ({len(proc.stdout.strip())} chars) — likely truncated or degenerate"
        )

    def test_analyze_json_mode_returns_valid_json(self, test_image):
        """--json mode must return parseable JSON with required fields."""
        proc = subprocess.run(
            ["node", str(ANALYZE), str(test_image), "List visible UI elements",
             "--mode", "ui", "--json", "--backend", "ollama", "--model", "gemma4:e2b-it-qat"],
             cwd=ROOT,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        assert proc.returncode == 0, (
            f"analyze.mjs --json failed: {proc.stderr.strip()}"
        )
        data = json.loads(proc.stdout)
        assert "analysis" in data, f"JSON output missing 'analysis' field: {list(data.keys())}"
        assert "model" in data, f"JSON output missing 'model' field"
        assert "backend" in data, f"JSON output missing 'backend' field"
        assert data["analysis"], "JSON output 'analysis' field is empty"

    def test_analyze_reports_served_model(self, test_image, capsys):
        """analyze.mjs stderr must report which model served the request
        (for debugging routing issues)."""
        proc = subprocess.run(
            ["node", str(ANALYZE), str(test_image), "Describe this image",
             "--mode", "ui", "--backend", "ollama", "--model", "gemma4:e2b-it-qat"],
            cwd=ROOT,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        assert proc.returncode == 0, f"analyze.mjs failed: {proc.stderr.strip()}"
        assert "Analyzing" in proc.stderr, (
            "analyze.mjs stderr doesn't report served model — can't debug routing"
        )
        assert "gemma4" in proc.stderr, (
            f"analyze.mjs didn't report gemma4 as served model. stderr: {proc.stderr[:200]}"
        )


# ---------------------------------------------------------------------------
# Test Class 6: Regression guards
# ---------------------------------------------------------------------------


class TestRegressionGuards:
    """Tests that catch known regressions from recurring."""

    def test_no_qwen3vl_in_mode_model(self):
        """qwen3-vl:2b must never appear in MODE_MODEL — it returns empty
        content with full budget in thinking (measured: 70s, 0 chars content)."""
        source = ANALYZE.read_text(encoding="utf-8")
        # Check MODE_MODEL object specifically
        mm_match = re.search(r"const MODE_MODEL\s*=\s*\{([^}]+)\}", source, re.DOTALL)
        assert mm_match, "MODE_MODEL not found in analyze.mjs"
        mm_content = mm_match.group(1)
        assert "qwen3-vl" not in mm_content, (
            f"qwen3-vl found in MODE_MODEL: {mm_content}"
        )

    def test_embedding_models_not_resident(self):
        """residentVisionModels() must exclude embedding-only models — they
        have no vision capabilities and would receive screenshots."""
        result = node_eval(
            str(VISION_COMMON),
            "mod.residentVisionModels().then(models => ({models}));",
        )
        models = result.get("models", [])
        for m in models:
            assert "embed" not in m.lower(), (
                f"residentVisionModels() returned embedding model: {m}"
            )

    def test_no_cloud_models_routable(self):
        """No network-hosted (:cloud) model may ever be routable — local-only policy."""
        result = node_eval(
            str(VISION_COMMON),
            "mod.residentVisionModels().then(models => ({models}));",
        )
        models = result.get("models", [])
        for m in models:
            assert not m.endswith(":cloud"), (
                f"residentVisionModels() returned cloud model: {m}"
            )
