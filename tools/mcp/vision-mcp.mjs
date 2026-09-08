#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ANALYZE_MJS = path.join(PROJECT_ROOT, "tools", "vision", "analyze.mjs");
const ANALYZE_PY = path.join(PROJECT_ROOT, "tools", "tests", "vision_analyze.py");

const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif)$/i;
const DEFAULT_MODEL = process.env.VISION_MODEL || "gemma4:e2b-it-qat";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logRequest(reqId, tool, detail) {
  console.error(`[${reqId}] ${tool} | ${detail}`);
}

function textResponse(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function runNode(script, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`vision request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", d => out += d);
    child.stderr.on("data", d => err += d);
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = err.trim() || `child process exited with code ${code}`;
        return reject(new Error(msg));
      }
      resolve(out.trim());
    });
    child.on("error", reject);
  });
}

function runAnalyzePy(imagePath, prompt, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [ANALYZE_PY, imagePath, prompt], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`python vision fallback timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", d => out += d);
    child.stderr.on("data", d => err += d);
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = err.trim() || `vision_analyze.py exited with code ${code}`;
        return reject(new Error(msg));
      }
      resolve(out.trim());
    });
    child.on("error", reject);
  });
}

function resolveImagePath(input) {
  if (!input || typeof input !== "string") {
    throw new Error("image_path must be a non-empty string");
  }
  const abs = path.isAbsolute(input) ? input : path.join(PROJECT_ROOT, input);
  if (!fs.existsSync(abs)) {
    throw new Error(`Image not found: ${abs}`);
  }
  if (!ALLOWED_EXTENSIONS.test(abs)) {
    throw new Error(`Unsupported image format: ${path.extname(abs)}. Allowed: png, jpg, jpeg, webp, bmp, gif`);
  }
  return abs;
}

async function resizeImage(inputPath, maxDim = 1024, quality = 80) {
  try {
    const buf = fs.readFileSync(inputPath);
    if (buf.length < 50000) return buf.toString("base64");

    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      return buf.toString("base64");
    }

    const img = sharp(buf);
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    const ratio = Math.min(maxDim / w, maxDim / h);
    const newW = Math.round(w * ratio);
    const newH = Math.round(h * ratio);

    const resized = await img
      .resize(newW, newH, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();

    return resized.toString("base64");
  } catch (e) {
    console.error(`[vision] resize failed for ${inputPath}: ${e.message}`);
    const buf = fs.readFileSync(inputPath);
    return buf.toString("base64");
  }
}

// ─── Ollama helpers ────────────────────────────────────────────────────────────

async function callOllamaChat(messages, tools = [], model, think = false, retries = 2) {
  const url = `${OLLAMA_URL}/api/chat`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const reqId = generateRequestId();
    try {
      const body = {
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: false,
        keep_alive: "5m",
        ...(think ? { think: true } : {}),
        options: {
          num_ctx: model.toLowerCase().includes("minicpm") ? 32768 : 16384,
          num_predict: 1024,
          temperature: model.toLowerCase().includes("minicpm") ? 0 : 0.3,
        },
      };

      logRequest(reqId, "ollama-chat", `attempt=${attempt + 1} model=${model} msgs=${messages.length} tools=${tools.length} think=${think}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const msg = data.message || {};
      logRequest(reqId, "ollama-chat", `ok model=${model} len=${(msg.content || "").length} tool_calls=${(msg.tool_calls || []).length}`);
      return msg;
    } catch (e) {
      logRequest(reqId, "ollama-chat", `failed attempt=${attempt + 1}: ${e.message}`);
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function callOllama(model, prompt, images = [], retries = 2, think = false) {
  const messages = [];
  if (images.length > 0) {
    messages.push({
      role: "user",
      content: prompt,
      images,
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const msg = await callOllamaChat(messages, [], model, think, retries);
  return msg.content || "";
}

// ─── Vision mode prompts ───────────────────────────────────────────────────────

const VISION_MODES = {
  ui: `You are a senior frontend engineer auditing a Native Media AI Studio UI screenshot.

Do NOT give generic descriptions. Give ONLY actionable feedback organized as:

1. ELEMENTS: List visible UI elements with approximate positions (top-left, center, bottom-right) and their role in the app
2. TEXT: Transcribe visible labels, buttons, headings, and status text
3. LAYOUT: Spacing, alignment, overflow, responsiveness issues. Reference specific CSS properties or components where possible.
4. ERRORS: Visible errors, warnings, broken images, empty states, loading skeletons, missing content
5. NEXT_ACTION: The single highest-impact fix a coding agent should make first. Explain WHY it matters for this project's user experience.`,

  responsive: `You are a senior frontend engineer auditing a Native Media AI Studio UI for responsive/layout issues.

Report ONLY actionable findings:
1. VIEWPORT FIT: Is content clipped, overflowing, or crammed? Name the offending element and its CSS fix (e.g., overflow-x, flex-wrap, grid-template).
2. TOUCH TARGETS: Are buttons/inputs smaller than 44x44px? List each offender with its current size estimate.
3. READABILITY: Is text below 14px or low-contrast? Give the exact text, size, and contrast issue.
4. NAVIGATION: Is content hidden behind menus, tabs, or scroll? Identify the hidden feature and how to expose it.
5. FIX: One concrete CSS/layout change that would have the biggest impact.`,

  regression: `You are a code reviewer comparing a rendered UI against its intended design.

For each discrepancy found:
1. WHAT CHANGED: Element, style, or layout shift from the expected design
2. SEVERITY: critical (breaks functionality), minor (visual polish), or cosmetic
3. FIX: Shortest revert or patch path. Reference the likely source file/component if identifiable.
4. CONFIDENCE: high / medium / low

Focus on regressions that affect user-facing functionality or visual polish in Native Media AI Studio.`,

  compare: `You are a design lead comparing two versions of a Native Media AI Studio screen.

For every difference:
1. LOCATION: Where on screen (top-left, center, bottom-right, full-width, etc.)
2. CHANGE: What moved, resized, recolored, appeared, or disappeared
3. IMPACT: UX improvement, regression, or neutral
4. FIX/PROMOTE: If it is a regression, what is the shortest fix. If it is an improvement, what principle does it demonstrate?

Prioritize differences that affect usability, readability, or visual hierarchy.`,

  "music-video": `You are a professional music-video director reviewing a rendered frame for Native Media AI Studio.

Evaluate this frame against broadcast-quality standards:
1. COMPOSITION: Rule of thirds, leading lines, head room, look room, depth layers (foreground/midground/background)
2. LIGHTING: Key light, rim light, color temperature consistency, exposure balance
3. COLOR: Dominant palette, mood alignment, saturation vs. intended mood
4. ENERGY: Rate 1-10. Is this appropriate for the section?
5. IMPACT: Strongest visual element and first gaze target
6. ISSUES: Top 3 improvements ranked by impact
7. BEAT SYNC: Would this frame cut cleanly on a strong beat? Why or why not?`,

  consistency: `You are a design systems auditor checking visual consistency across Native Media AI Studio media.

Audit for:
1. COLOR PALETTE DRIFT: Compare primary/secondary/accent colors across shots/scenes. Flag any deviation from the project palette.
2. TYPOGRAPHY: Font sizes, weights, line heights, and heading styles. Are they uniform?
3. ASSET REUSE: Are icons, logos, or illustrations inconsistent in style or treatment?
4. SCENE CONTINUITY: For 3D/music-video frames, does lighting, camera angle, or mood break between consecutive shots?
5. RECOMMENDATION: keep / recut / reframe with a one-line rationale.`,

  // --- MiniCPM-V optimized modes ---
  ocr: `Transcribe all visible text preserving original line breaks, punctuation, and reading order. If a table is present, convert it to markdown. If a region is unclear write [unclear]. Do NOT invent text. RLAIF-V: lower hallucination, be trustworthy.`,

  table: `Convert the table in this image to markdown, preserving headers, rows, and alignment. Keep numbers and text exactly as shown. If no table exists reply "No table detected."`,

  chart: `Describe the trend shown in this chart. Name axes, units, and relative heights. Compare bars/lines, note peaks/valleys, and flag any value that is ambiguous as "estimated". Do NOT invent exact numbers if labels are missing — say "unclear". This is RLAIF-V trustworthy chart reading.`,

  multicomp: `You are given two UI screenshots: first is BEFORE, second is AFTER. List every visual difference: layout shifts, color changes, text differences, missing/added elements, sizing, and spacing. Be exhaustive. Use the two images as in-context examples.`,
};

// ─── VRAM management ───────────────────────────────────────────────────────────

async function getRunningModels() {
  const reqId = generateRequestId();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`);
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    logRequest(reqId, "running-models", models.join(","));
    return models;
  } catch (e) {
    logRequest(reqId, "running-models-failed", e.message);
    return [];
  }
}

async function unloadModel(model) {
  const reqId = generateRequestId();
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000),
    });
    logRequest(reqId, "unloaded-model", model);
  } catch (e) {
    logRequest(reqId, "unload-failed", `model=${model} ${e.message}`);
  }
}

async function ensureVisionModel(model) {
  const running = await getRunningModels();
  if (running.length === 0) return;

  const toUnload = running.filter(m => m !== model);
  if (toUnload.length === 0) return;

  logRequest(generateRequestId(), "unloading-models", toUnload.join(","));
  for (const m of toUnload) {
    await unloadModel(m);
  }

  await new Promise(r => setTimeout(r, 1500));

  const stillRunning = await getRunningModels();
  const stillThere = stillRunning.filter(m => m !== model);
  if (stillThere.length > 0) {
    for (const m of stillThere) {
      await unloadModel(m);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function ollamaReady(timeoutMs = 10000) {
  const reqId = generateRequestId();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        logRequest(reqId, "ollama-ready", "");
        return true;
      }
    } catch {
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  logRequest(reqId, "ollama-not-ready", "");
  return false;
}

async function warmModel(model, enabled = true) {
  if (!enabled) return;
  const reqId = generateRequestId();
  try {
    await callOllama(model, "Hi", [], 0);
    logRequest(reqId, "warm-model", `model=${model}`);
  } catch (e) {
    logRequest(reqId, "warm-model-warn", `model=${model} ${e.message}`);
  }
}

// ─── Image analysis core ───────────────────────────────────────────────────────

async function describeImage(imagePath, prompt, mode) {
  const abs = resolveImagePath(imagePath);
  const finalPrompt = prompt || "Describe this image in detail.";
  const finalMode = mode || "ui";
  const reqId = generateRequestId();

  logRequest(reqId, "vision_describe", `mode=${finalMode} image=${abs}`);

  // Primary: use the standalone analyzer which has sharp + model-aware dispatch
  try {
    const args = ["analyze", abs, finalPrompt, "--mode", finalMode];
    const result = await runNode(ANALYZE_MJS, args);
    logRequest(reqId, "vision_describe", "primary-ok");
    return result;
  } catch (e) {
    logRequest(reqId, "vision_describe", `primary-failed: ${e.message}`);

    // Fallback: python analyzer
    try {
      const result = await runAnalyzePy(abs, finalPrompt);
      logRequest(reqId, "vision_describe", "fallback-py-ok");
      return result;
    } catch (e2) {
      logRequest(reqId, "vision_describe", `fallback-py-failed: ${e2.message}`);
      throw new Error(`All vision backends failed. Last error: ${e2.message}. Ensure Ollama is running and a vision model is pulled.`);
    }
  }
}

async function compareImages(imageA, imageB, prompt) {
  const a = resolveImagePath(imageA);
  const b = resolveImagePath(imageB);
  const finalPrompt = prompt || "Compare these two images. Identify differences, improvements, or regressions. Summarize key changes.";
  const reqId = generateRequestId();

  logRequest(reqId, "vision_compare", `start ${a} vs ${b}`);

  // Use the standalone analyzer for compare/diff
  try {
    const result = await runNode(ANALYZE_MJS, ["compare", a, b, finalPrompt]);
    logRequest(reqId, "vision_compare", "ok");
    return result;
  } catch (e) {
    logRequest(reqId, "vision_compare", `failed: ${e.message}`);
    throw e;
  }
}

// ─── Tool implementations (self-contained, previously imported from vision.mjs) ─

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "read_source",
      description: "Read a source file from the project. Returns first 200 lines with path metadata. Use this to check what the code SHOULD look like when diagnosing UI issues.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Repo-relative path to the file, e.g. packages/frontend/src/features/generate3d/Generation3DPage.tsx",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for files matching a regex pattern in the project. Returns up to 50 matches.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to match filenames, e.g. .*Generation3D.*\\.tsx$",
          },
          path: {
            type: "string",
            description: "Directory to search from (default: project root)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_file_info",
      description: "Get file size and modification time. Use this to verify a file exists before reading.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Repo-relative path to the file or directory",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_visuals",
      description: "Compare two images via the vision model. Returns a detailed diff summary.",
      parameters: {
        type: "object",
        properties: {
          image_a: { type: "string", description: "Repo-relative path to first image" },
          image_b: { type: "string", description: "Repo-relative path to second image" },
          prompt: { type: "string", description: "Optional focus prompt for comparison" },
        },
        required: ["image_a", "image_b"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "take_screenshot",
      description: "Capture a screenshot of a URL using headless Playwright. Returns the saved image path.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to capture (default: http://localhost:5173)",
          },
          full_page: {
            type: "boolean",
            description: "Capture full scrollable page (default: false)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_outputs",
      description: "List recent generated media files (images, video, audio) in output/ directory.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max files to return (default 20)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vision_ocr",
      description: "Specialized OCR tool: transcribe all visible text from an image preserving line breaks and layout. Preferred over generic vision_describe when the goal is text extraction. Returns raw transcription with [unclear] markers for illegible regions.",
      parameters: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Absolute or repo-relative path to image (png/jpg/webp)",
          },
          prompt: {
            type: "string",
            description: "Optional additional instructions appended to the OCR preset",
          },
        },
        required: ["image_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vision_batch_analyze",
      description: "Analyze multiple images in one call. Each image gets the same prompt/mode. Useful for reviewing a set of screenshots or frames. Returns an array of {image, analysis} objects.",
      parameters: {
        type: "object",
        properties: {
          image_paths: {
            type: "array",
            items: { type: "string" },
            description: "Array of repo-relative image paths to analyze",
          },
          prompt: {
            type: "string",
            description: "Shared prompt for all images (optional)",
          },
          mode: {
            type: "string",
            enum: ["ui", "responsive", "regression", "compare", "music-video", "consistency", "ocr", "table", "chart"],
            description: "Vision mode preset (default: ui)",
          },
        },
        required: ["image_paths"],
      },
    },
  },
];

async function executeTool(name, args) {
  const reqId = generateRequestId();
  const fn = TOOL_IMPLEMENTATIONS[name];
  if (!fn) return { error: `Unknown tool: ${name}`, hint: "Available tools: " + TOOL_DEFS.map(t => t.function.name).join(", ") };
  try {
    return await fn(args, reqId);
  } catch (e) {
    return { error: e.message, reqId };
  }
}

const TOOL_IMPLEMENTATIONS = {
  read_source: async ({ path: filePath }) => {
    const abs = path.resolve(PROJECT_ROOT, filePath);
    if (!fs.existsSync(abs)) return { error: `File not found: ${abs}` };
    const content = fs.readFileSync(abs, "utf-8");
    const lines = content.split("\n");
    return {
      path: filePath,
      absolute: abs,
      lines: lines.length,
      preview: lines.slice(0, 200).join("\n"),
    };
  },

  search_files: async ({ pattern, path: dir = "." }) => {
    const abs = path.resolve(PROJECT_ROOT, dir);
    const results = [];
    async function walk(current) {
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "target") {
            await walk(full);
          }
        } else if (entry.name.match(pattern)) {
          results.push(full.replace(abs, "").replace(/^[\\/]/, ""));
        }
      }
    }
    await walk(abs);
    return { pattern, directory: dir, matches: results.slice(0, 50) };
  },

  get_file_info: async ({ path: filePath }) => {
    const abs = path.resolve(PROJECT_ROOT, filePath);
    if (!fs.existsSync(abs)) return { error: `File not found: ${abs}` };
    const s = fs.statSync(abs);
    return {
      path: filePath,
      absolute: abs,
      size: s.size,
      isDirectory: s.isDirectory(),
      modified: s.mtime.toISOString(),
    };
  },

  compare_visuals: async ({ image_a, image_b, prompt }) => {
    const a = path.resolve(PROJECT_ROOT, image_a);
    const b = path.resolve(PROJECT_ROOT, image_b);
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      return { error: `Image not found: ${!fs.existsSync(a) ? a : b}` };
    }
    const img1 = await resizeImage(a, 1024, 80);
    const img2 = await resizeImage(b, 1024, 80);
    const finalPrompt = prompt || "Compare these two screenshots. Describe every difference.";
    const response = await callOllama(
      process.env.VISION_MODEL || DEFAULT_MODEL,
      finalPrompt,
      [img1, img2],
      2,
      false
    );
    return { comparison: response };
  },

  take_screenshot: async ({ url, selector, full_page = false }) => {
    let browser;
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      return {
        error: "playwright not available. Install it: pnpm add -D playwright",
        hint: "Or use the existing scripts/capture-visualizer-frames.mjs workflow.",
      };
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      const target = url || "http://localhost:5173";
      await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
      const outPath = path.resolve(PROJECT_ROOT, "output", "vision-screenshot.png");
      await page.screenshot({ path: outPath, fullPage: full_page === "true" || full_page === true });
      return { screenshot: outPath, url: target };
    } finally {
      await browser.close();
    }
  },

  list_outputs: async ({ limit = 20 }) => {
    const outDir = path.resolve(PROJECT_ROOT, "output");
    try {
      const entries = fs.readdirSync(outDir, { recursive: true });
      const media = entries
        .filter(e => /\.(png|jpg|jpeg|webp|mp4|webm|mov|mp3|wav)$/i.test(e.name))
        .slice(0, limit)
        .map(e => e.fullPath.replace(outDir, "output"));
      return { directory: "output", files: media };
    } catch {
      return { directory: "output", files: [] };
    }
  },

  vision_ocr: async ({ image_path, prompt }) => {
    const finalPrompt = prompt || VISION_MODES.ocr;
    const result = await describeImage(image_path, finalPrompt, "ocr");
    return { image: image_path, mode: "ocr", transcription: result };
  },

  vision_batch_analyze: async ({ image_paths, prompt, mode = "ui" }) => {
    if (!Array.isArray(image_paths) || image_paths.length === 0) {
      return { error: "image_paths must be a non-empty array" };
    }
    const results = [];
    for (const p of image_paths) {
      try {
        const analysis = await describeImage(p, prompt || null, mode);
        results.push({ image: p, mode, analysis });
      } catch (e) {
        results.push({ image: p, mode, error: e.message });
      }
    }
    return { count: results.length, results };
  },
};

// ─── MCP server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "native-media-vision", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: "vision_describe",
      description: "Describe a screenshot/image using local Ollama vision model (gemma4:e2b-it-qat with chain-of-thought). For non-vision coding agents: pass image path, get text description back. Scoped strictly to Native Media AI Studio.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Absolute or repo-relative path to image (png/jpg/webp) under Native Media AI Studio. Example: output/logs/screenshot.png or D:\\...\\Native Media AI Studio\\output\\screenshot.png",
          },
          prompt: {
            type: "string",
            description: "Custom prompt. Default: detailed UI description with element positions. Use for targeted questions.",
          },
          mode: {
            type: "string",
            enum: ["ui", "responsive", "regression", "compare", "music-video", "consistency", "ocr", "table", "chart", "multicomp"],
            description: "Preset prompt mode. 'ui' = detailed scene/elements. 'responsive' = layout issues. 'regression' = compare vs source. 'ocr' = text extraction. 'table' = markdown table. 'chart' = chart reading.",
          },
        },
        required: ["image_path"]
      }
    },
    {
      name: "vision_compare",
      description: "Compare two images via local vision model. Provide two image paths, get diff summary.",
      inputSchema: {
        type: "object",
        properties: {
          image_a: { type: "string", description: "First image path" },
          image_b: { type: "string", description: "Second image path" },
          prompt: { type: "string", description: "Optional focus prompt" }
        },
        required: ["image_a", "image_b"]
      }
    },
    {
      name: "vision_ui_audit",
      description: "Structured UI audit: returns positioned element list, visible text, layout issues, errors. Optimized for feeding to non-vision coding agents.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: { type: "string", description: "Absolute or repo-relative path to image" },
          viewport: { type: "string", description: "e.g. 1280x800" },
          label: { type: "string", description: "Screen label, e.g. Generation3DPage" }
        },
        required: ["image_path"]
      }
    },
    {
      name: "vision_ocr",
      description: "Specialized OCR: transcribe all visible text from an image preserving line breaks and layout. Preferred over vision_describe when the goal is text extraction. Returns raw transcription with [unclear] markers for illegible regions.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: { type: "string", description: "Absolute or repo-relative path to image (png/jpg/webp)" },
          prompt: { type: "string", description: "Optional additional instructions appended to the OCR preset" }
        },
        required: ["image_path"]
      }
    },
    {
      name: "vision_batch_analyze",
      description: "Analyze multiple images in one call. Each image gets the same prompt/mode. Useful for reviewing a set of screenshots or frames. Returns an array of {image, analysis} objects.",
      inputSchema: {
        type: "object",
        properties: {
          image_paths: {
            type: "array",
            items: { type: "string" },
            description: "Array of repo-relative image paths to analyze"
          },
          prompt: { type: "string", description: "Shared prompt for all images (optional)" },
          mode: {
            type: "string",
            enum: ["ui", "responsive", "regression", "compare", "music-video", "consistency", "ocr", "table", "chart"],
            description: "Vision mode preset (default: ui)"
          }
        },
        required: ["image_paths"]
      }
    },
    ...TOOL_DEFS,
  ]
}));

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;
  const reqId = generateRequestId();

  try {
    if (name === "vision_describe") {
      const text = await describeImage(args?.image_path, args?.prompt || null, args?.mode || "ui");
      return textResponse(text);
    }
    if (name === "vision_compare") {
      const prompt = args?.prompt || "Compare these two images. Identify differences, improvements, or regressions. Summarize key changes.";
      const combined = await compareImages(args?.image_a, args?.image_b, prompt);
      return textResponse(combined);
    }
    if (name === "vision_ui_audit") {
      const auditPrompt = `Perform a structured UI audit. Return JSON-like sections:
1. ELEMENTS: list visible UI elements with approximate position (top-left, center, bottom-right etc)
2. TEXT: transcribe visible text labels/buttons
3. LAYOUT: responsive/layout issues
4. ERRORS: visible errors, warnings, broken images, missing states
5. NEXT_ACTION: what should a coding agent fix first?
Viewport: ${args?.viewport || "unknown"} Label: ${args?.label || "screen"}`;
      const text = await describeImage(args?.image_path, auditPrompt, "ui");
      return textResponse(text);
    }

    if (name === "vision_ocr") {
      const result = await executeTool("vision_ocr", args || {});
      return textResponse(JSON.stringify(result, null, 2));
    }

    if (name === "vision_batch_analyze") {
      const result = await executeTool("vision_batch_analyze", args || {});
      return textResponse(JSON.stringify(result, null, 2));
    }

    // Tool-callable tools: execute directly
    if (TOOL_DEFS.some(t => t.function?.name === name)) {
      const result = await executeTool(name, args || {});
      return textResponse(JSON.stringify(result, null, 2));
    }

    logRequest(reqId, "tools/call", `unknown-tool ${name}`);
    return textResponse(`Unknown tool ${name}. Available tools: vision_describe, vision_compare, vision_ui_audit, vision_ocr, vision_batch_analyze, read_source, search_files, get_file_info, compare_visuals, take_screenshot, list_outputs`, true);
  } catch (e) {
    console.error(`[${reqId}] [vision-mcp] tool error: ${e.message}`);
    const hint = e.message.includes("Ollama")
      ? "Hint: ensure Ollama is running (ollama serve) and a vision model is pulled (ollama pull gemma4:e2b-it-qat)."
      : e.message.includes("not found")
      ? "Hint: check the file path is correct and the file exists."
      : "";
    return textResponse(`Vision error: ${e.message}${hint ? "\n" + hint : ""}`, true);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("native-media-vision MCP ready v2.0.0 (project root: " + PROJECT_ROOT + ")");
  console.error("  Tools: vision_describe, vision_compare, vision_ui_audit, vision_ocr, vision_batch_analyze, read_source, search_files, get_file_info, compare_visuals, take_screenshot, list_outputs");
  console.error("  Primary backend: tools/vision/analyze.mjs | Fallback: tools/tests/vision_analyze.py");
  console.error("  Default model: " + DEFAULT_MODEL + " | Ollama: " + OLLAMA_URL);
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
