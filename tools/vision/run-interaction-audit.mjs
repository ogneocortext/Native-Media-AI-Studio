#!/usr/bin/env node
/**
 * Run the full interaction-state vision audit pipeline:
 *
 *   1. Check VRAM (warn 70%, abort 85%) — protects the 8 GB card
 *   2. Capture interaction-state screenshots via Playwright
 *   3. Run vision analysis on each capture through Ollama/gemma4
 *   4. Aggregate findings into a structured JSON report
 *   5. Restore Ollama after completion
 *
 * Usage: node tools/vision/run-interaction-audit.mjs [baseUrl] [outDir]
 *
 * VRAM safety: sequential single-model analysis. gemma4 (~6 GB) is loaded
 * once and reused for all captures. Qwen3.5 (~4.8 GB) through Atomic Chat
 * is never loaded simultaneously with gemma4 (would be ~10.8 GB OOM).
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] || "http://127.0.0.1:5173";
const outDir = process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "output", "interaction-audit");
const captureScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "frontend", "tests", "browser", "capture-interaction-states.mjs");
const analyzeScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "analyze.mjs");
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

// VRAM thresholds
const VRAM_WARN_PCT = parseInt(process.env.VISION_VRAM_WARN_PCT || "70");
const VRAM_ABORT_PCT = parseInt(process.env.VISION_VRAM_ABORT_PCT || "85");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Query the backend VRAM status endpoint.
 * Returns null if unreachable.
 */
async function fetchVRAMStatus() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/integrations/vram/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Switch the backend to a specific model via the VRAM manager.
 * Coordinated: unloads current model before loading target.
 */
async function switchBackendModel(backend, model) {
  const body = JSON.stringify({ backend, model });
  const res = await fetch(`${BACKEND_URL}/api/integrations/vram/switch-backend-model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(120000),
  });
  return await res.json();
}

/**
 * Run a shell command and return its stdout as a string.
 */
function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).trim();
}

async function main() {
  const report = {
    base,
    startedAt: new Date().toISOString(),
    vramChecks: [],
    captures: [],
    analyses: [],
    errors: [],
  };

  // ── Step 1: VRAM preflight ──────────────────────────────────────────
  console.log("[audit] Step 1 — VRAM preflight check");
  let vram = await fetchVRAMStatus();
  if (vram) {
    const v = vram.vram || vram;
    const pct = v.percent ?? 0;
    report.vramChecks.push({ when: "preflight", percent: pct, used_mb: v.used_mb, free_mb: v.free_mb });
    console.log(`[audit] VRAM: ${v.used_mb}MB / ${v.total_mb}MB (${pct}%)`);
    if (pct >= VRAM_ABORT_PCT) {
      console.error(`[audit] ABORT: VRAM at ${pct}% >= abort threshold ${VRAM_ABORT_PCT}%. Free GPU memory first.`);
      process.exit(1);
    }
    if (pct >= VRAM_WARN_PCT) {
      console.error(`[audit] WARN: VRAM at ${pct}% >= warn threshold ${VRAM_WARN_PCT}%.`);
    }
  } else {
    console.error("[audit] WARN: Could not reach backend VRAM status endpoint — proceeding blind.");
  }

  // Ensure gemma4 is loaded (single model for all analyses)
  console.log("[audit] Ensuring gemma4:e2b-it-qat is loaded via VRAM manager...");
  const switchResult = await switchBackendModel("ollama", "gemma4:e2b-it-qat");
  console.log(`[audit] Switch result: success=${switchResult.success}, ollama_loaded=${switchResult.ollama_loaded}, atomic_chat_loaded=${switchResult.atomic_chat_loaded}`);
  if (!switchResult.success) {
    report.errors.push({ step: "switch-to-gemma4", error: switchResult.error });
  }

  vram = await fetchVRAMStatus();
  if (vram) {
    const v = vram.vram || vram;
    report.vramChecks.push({ when: "post-switch", percent: v.percent, used_mb: v.used_mb, free_mb: v.free_mb });
    console.log(`[audit] VRAM after switch: ${v.used_mb}MB / ${v.total_mb}MB (${v.percent}%)`);
  }

  // ── Step 2: Capture interaction states ─────────────────────────────
  console.log("\n[audit] Step 2 — Capturing interaction states");
  const captureCmd = `node "${captureScript}" "${base}" "${outDir}"`;
  console.log(`[audit] Running: ${captureCmd}`);
  try {
    const captureOut = sh(captureCmd);
    console.log(captureOut);
  } catch (e) {
    const msg = `Capture script failed: ${e.message}`;
    console.error(msg);
    report.errors.push({ step: "capture", error: msg });
    // Continue anyway — some screenshots may exist
  }

  // Read the manifest
  const manifestPath = path.join(outDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    console.error(`[audit] Cannot read manifest: ${e.message}`);
    // Restore Ollama before exiting
    await switchBackendModel("ollama", "gemma4:e2b-it-qat");
    process.exit(1);
  }

  // ── Step 3: Analyze each capture ───────────────────────────────────
  console.log("\n[audit] Step 3 — Vision analysis of each capture");
  const analysesDir = path.join(outDir, "analyses");
  mkdirSync(analysesDir, { recursive: true });

  for (const cap of manifest.states) {
    if (!cap.file || !existsSync(cap.file)) {
      console.log(`[audit] SKIP ${cap.id} — no screenshot file`);
      continue;
    }

    // VRAM check before each analysis
    vram = await fetchVRAMStatus();
    if (vram) {
      const v = vram.vram || vram;
      const pct = v.percent ?? 0;
      report.vramChecks.push({ when: `before-${cap.id}`, percent: pct, used_mb: v.used_mb, free_mb: v.free_mb });
      if (pct >= VRAM_ABORT_PCT) {
        console.error(`[audit] ABORT at ${cap.id}: VRAM at ${pct}% >= abort threshold ${VRAM_ABORT_PCT}%.`);
        break;
      }
      if (pct >= VRAM_WARN_PCT) {
        console.error(`[audit] WARN at ${cap.id}: VRAM at ${pct}% >= warn threshold ${VRAM_WARN_PCT}%.`);
      }
    }

    console.log(`[audit] Analyzing ${cap.id} — ${cap.desc}`);
    const analyzeCmd = `node "${analyzeScript}" "${cap.file}" --mode ui --label "${cap.desc}" --backend ollama --model gemma4:e2b-it-qat --json`;
    try {
      const analyzeOut = sh(analyzeCmd);
      const result = JSON.parse(analyzeOut);
      const analysisPath = path.join(analysesDir, `${cap.id}.json`);
      writeFileSync(analysisPath, JSON.stringify(result, null, 2));
      report.analyses.push({
        id: cap.id,
        desc: cap.desc,
        file: cap.file,
        model: result.model,
        backend: result.backend,
        analysis: result.analysis,
        fallback_used: result.fallback_used,
        savedTo: analysisPath,
      });
      console.log(`[audit] ✓ ${cap.id} — model=${result.model} backend=${result.backend}`);
    } catch (e) {
      const msg = `Analysis failed for ${cap.id}: ${e.message}`;
      console.error(msg);
      report.errors.push({ step: `analyze-${cap.id}`, error: msg, file: cap.file });
    }

    // Small delay between analyses to let VRAM settle
    await sleep(1000);
  }

  // ── Step 4: Restore Ollama ─────────────────────────────────────────
  console.log("\n[audit] Step 4 — Restoring Ollama (gemma4:e2b-it-qat)");
  const restoreResult = await switchBackendModel("ollama", "gemma4:e2b-it-qat");
  console.log(`[audit] Restore: success=${restoreResult.success}`);

  vram = await fetchVRAMStatus();
  if (vram) {
    const v = vram.vram || vram;
    report.vramChecks.push({ when: "final", percent: v.percent, used_mb: v.used_mb, free_mb: v.free_mb });
    console.log(`[audit] Final VRAM: ${v.used_mb}MB / ${v.total_mb}MB (${v.percent}%)`);
  }

  // ── Step 5: Write report ───────────────────────────────────────────
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(outDir, "audit-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[audit] Report written: ${reportPath}`);
  console.log(`[audit] Analyses completed: ${report.analyses.length}/${manifest.states.length}`);
  console.log(`[audit] Errors: ${report.errors.length}`);
}

main().catch((e) => {
  console.error("[audit] FATAL:", e.message);
  // Best-effort restore
  try {
    execSync(`node -e "fetch('http://127.0.0.1:8000/api/integrations/vram/switch-backend-model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backend:'ollama',model:'gemma4:e2b-it-qat'}})}"`, { timeout: 30000 });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
