#!/usr/bin/env python3
"""Visual regression tests using Playwright + local Ollama vision model.

Captures screenshots of every frontend page and uses a local VLM
(gemma4:e2b-it-qat by default) to verify UI correctness and catch
visual regressions that unit tests miss.

Usage:
    python tests/visual/run_visual_tests.py [--update-baselines] [--model gemma4:e2b-it-qat]
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = PROJECT_ROOT / "packages" / "frontend"
BASELINE_DIR = PROJECT_ROOT / "tests" / "visual" / "baselines"
REPORT_DIR = PROJECT_ROOT / "tests" / "visual" / "reports"
OLLAMA_BASE = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
DEFAULT_VISION_MODEL = os.getenv("VISION_MODEL", "gemma4:e2b-it-qat")

# Pages to test — route path, name, and whether it requires auth/data
PAGES = [
    ("/", "Dashboard", False),
    ("/queue", "Queue", False),
    ("/health", "Health", False),
    ("/logs", "Logs", False),
    ("/settings", "Settings", False),
    ("/image-generation", "ImageGeneration", False),
    ("/audio-analysis", "AudioAnalysis", False),
    ("/video-generation", "VideoGeneration", False),
    ("/generate-3d", "Generate3D", False),
    ("/ai-tools", "AITools", False),
    ("/docs", "Docs", False),
    ("/storyboards", "Storyboards", False),
    ("/visualizer", "Visualizer", False),
    ("/library", "MediaLibrary", False),
    ("/music-video-wizard", "MusicVideoWizard", False),
    ("/three-js-studio", "ThreeJSStudio", False),
    ("/kinetic-typography", "KineticTypography", False),
    ("/gpu", "GpuMonitor", False),
    ("/preview", "Preview", False),
]


def ensure_dirs() -> None:
    BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)


def page_hash(url: str, width: int, height: int) -> str:
    """Stable hash for a page capture."""
    key = f"{url}:{width}:{height}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def capture_screenshot(page, url: str, name: str, width: int = 1400, height: int = 900) -> Path | None:
    """Navigate to a URL and capture a full-page screenshot."""
    try:
        page.set_viewport_size({"width": width, "height": height})
        page.goto(f"http://localhost:5173{url}", wait_until="domcontentloaded", timeout=30000)
        # Wait for React hydration + lazy components
        time.sleep(3)
        # Wait for network idle to catch lazy-loaded chunks
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except PlaywrightTimeout:
            pass
        time.sleep(1)
        screenshot_path = BASELINE_DIR / f"{name}.png"
        page.screenshot(path=str(screenshot_path), full_page=False)
        return screenshot_path
    except Exception as e:
        print(f"  [capture error] {url}: {e}", file=sys.stderr)
        return None


def ollama_vision_analyze(image_path: Path, prompt: str, model: str = DEFAULT_VISION_MODEL) -> dict[str, Any] | None:
    """Send a screenshot to the local Ollama vision model and return the analysis."""
    try:
        image_b64 = base64.b64encode(image_path.read_bytes()).decode("utf-8")
    except Exception as e:
        print(f"  [read error] {image_path}: {e}", file=sys.stderr)
        return None

    url = f"{OLLAMA_BASE}/api/generate"
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "images": [image_b64],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 1024},
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return {"response": result.get("response", "").strip(), "model": model}
    except urllib.error.URLError as e:
        print(f"  [ollama error] {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [ollama unexpected] {e}", file=sys.stderr)
        return None


VISION_PROMPT = """You are a QA engineer specializing in UI/UX regression detection.
Analyze this screenshot of a web application page.

Look for:
1. Layout breakage (overlapping elements, clipped text, misaligned columns)
2. Missing or broken UI components (empty cards where content should be, missing icons)
3. Console-like error indicators visible in the UI (red error banners, "Failed to load" messages)
4. Loading spinners that should have resolved but are still visible
5. Z-index/stacking issues (elements hidden behind others)
6. Responsive layout problems (horizontal scroll, elements cut off)

Respond with a JSON object:
{
  "status": "pass" | "fail" | "warn",
  "issues": ["short description of each issue found"],
  "confidence": 0.0-1.0
}

If the page looks correct and fully rendered, status should be "pass" with an empty issues list.
Do NOT include markdown formatting in your response — raw JSON only.
"""


def analyze_screenshot(image_path: Path, model: str) -> dict[str, Any] | None:
    """Run vision analysis on a screenshot."""
    result = ollama_vision_analyze(image_path, VISION_PROMPT, model=model)
    if not result:
        return None
    response = result.get("response", "")
    # Try to extract JSON from response
    try:
        # Look for JSON block
        if "```json" in response:
            json_str = response.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in response:
            json_str = response.split("```", 1)[1].split("```", 1)[0].strip()
        else:
            json_str = response.strip()
        return json.loads(json_str)
    except json.JSONDecodeError:
        # Fallback: wrap raw response
        return {"status": "warn", "issues": [f"Vision model returned non-JSON: {response[:200]}"], "confidence": 0.5}


def compare_with_baseline(current_path: Path, baseline_path: Path) -> dict[str, Any]:
    """Simple pixel-diff comparison between current and baseline screenshots."""
    try:
        from PIL import Image
    except ImportError:
        return {"status": "skip", "reason": "PIL not installed"}

    if not baseline_path.exists():
        return {"status": "no_baseline"}

    try:
        current = Image.open(current_path).convert("RGB")
        baseline = Image.open(baseline_path).convert("RGB")
        if current.size != baseline.size:
            return {"status": "warn", "reason": f"Size mismatch: {current.size} vs {baseline.size}"}
        diff = Image.new("RGB", current.size)
        pixels_changed = 0
        total = current.size[0] * current.size[1]
        for x in range(current.size[0]):
            for y in range(current.size[1]):
                c = current.getpixel((x, y))
                b = baseline.getpixel((x, y))
                if c != b:
                    diff.putpixel((x, y), (255, 0, 0))
                    pixels_changed += 1
        diff_path = REPORT_DIR / f"diff_{baseline_path.stem}.png"
        diff.save(diff_path)
        pct = (pixels_changed / total) * 100 if total > 0 else 0
        return {
            "status": "pass" if pct < 2.0 else "warn" if pct < 10.0 else "fail",
            "pixels_changed_pct": round(pct, 2),
            "diff_image": str(diff_path),
        }
    except Exception as e:
        return {"status": "error", "reason": str(e)}


def run_visual_suite(model: str = DEFAULT_VISION_MODEL, update_baselines: bool = False) -> int:
    """Run the full visual regression suite."""
    ensure_dirs()
    print(f"Visual regression suite — vision_model={model} update_baselines={update_baselines}")
    print(f"Baseline dir: {BASELINE_DIR}")
    print(f"Report dir: {REPORT_DIR}")

    results: list[dict[str, Any]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        for route, name, _ in PAGES:
            print(f"\n[page] {name} ({route})")
            screenshot_path = capture_screenshot(page, route, name)
            if not screenshot_path:
                results.append({"page": name, "route": route, "status": "error", "error": "capture failed"})
                continue

            page_result: dict[str, Any] = {
                "page": name,
                "route": route,
                "screenshot": str(screenshot_path),
            }

            # Pixel diff against baseline
            baseline_path = BASELINE_DIR / f"{name}.png"
            diff_result = compare_with_baseline(screenshot_path, baseline_path)
            page_result["pixel_diff"] = diff_result

            if update_baselines:
                # Copy current to baseline
                import shutil
                shutil.copy2(screenshot_path, baseline_path)
                page_result["status"] = "baseline_updated"
                results.append(page_result)
                continue

            # Vision analysis
            vision = analyze_screenshot(screenshot_path, model)
            if vision:
                page_result["vision_analysis"] = vision
                page_result["status"] = vision.get("status", "warn")
                page_result["issues"] = vision.get("issues", [])
            else:
                page_result["status"] = "error"
                page_result["error"] = "vision analysis failed"

            results.append(page_result)

        browser.close()

    # Write report
    report_path = REPORT_DIR / f"visual_report_{int(time.time())}.json"
    report_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nReport written to {report_path}")

    # Print summary
    passed = sum(1 for r in results if r.get("status") == "pass")
    failed = sum(1 for r in results if r.get("status") == "fail")
    warned = sum(1 for r in results if r.get("status") == "warn")
    errored = sum(1 for r in results if r.get("status") == "error")
    print(f"\nSummary: {passed} passed, {failed} failed, {warned} warned, {errored} errors out of {len(results)} pages")

    # Print issues
    for r in results:
        if r.get("issues"):
            print(f"\n  {r['page']}:")
            for issue in r["issues"]:
                print(f"    - {issue}")

    return 1 if failed > 0 or errored > 0 else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Visual regression tests with Ollama vision")
    parser.add_argument("--model", type=str, default=DEFAULT_VISION_MODEL, help="Ollama vision model")
    parser.add_argument("--update-baselines", action="store_true", help="Overwrite baseline screenshots")
    args = parser.parse_args()

    return run_visual_suite(model=args.model, update_baselines=args.update_baselines)


if __name__ == "__main__":
    sys.exit(main())
