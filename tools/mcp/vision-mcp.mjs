#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ANALYZE_MJS = path.join(PROJECT_ROOT, "scripts", "vision", "analyze.mjs");
const VISION_MJS = path.join(PROJECT_ROOT, "tools", "mcp", "vision.mjs");
const ANALYZE_PY = path.join(PROJECT_ROOT, "tools", "tests", "vision_analyze.py");

const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif)$/i;

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logRequest(reqId, tool, detail) {
  console.error(`[${reqId}] ${tool} | ${detail}`);
}

function textResponse(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function runNode(script, args, timeoutMs = 120000) {
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

function runAnalyzePy(imagePath, prompt, timeoutMs = 120000) {
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
    throw new Error(`Unsupported image format: ${path.extname(abs)}`);
  }
  return abs;
}

async function describeImage(imagePath, prompt, mode) {
  const abs = resolveImagePath(imagePath);
  const finalPrompt = prompt || "Describe this image in detail.";
  const finalMode = mode || "ui";
  const reqId = generateRequestId();

  logRequest(reqId, "vision_describe", `mode=${finalMode} image=${abs}`);

  // Primary: vision.mjs (sharp resize + Ollama /api/generate)
  try {
    const args = ["analyze", abs, finalPrompt, "--mode", finalMode];
    const result = await runNode(VISION_MJS, args);
    logRequest(reqId, "vision_describe", "primary-ok");
    return result;
  } catch (e) {
    logRequest(reqId, "vision_describe", `primary-failed: ${e.message}`);

    // Fallback 1: analyze.mjs
    try {
      const result = await runNode(ANALYZE_MJS, [abs, "--prompt", finalPrompt, "--mode", finalMode]);
      logRequest(reqId, "vision_describe", "fallback1-ok");
      return result;
    } catch (e2) {
      logRequest(reqId, "vision_describe", `fallback1-failed: ${e2.message}`);

      // Fallback 2: Python
      const result = await runAnalyzePy(abs, finalPrompt);
      logRequest(reqId, "vision_describe", "fallback2-ok");
      return result;
    }
  }
}

async function compareImages(imageA, imageB, prompt) {
  const a = resolveImagePath(imageA);
  const b = resolveImagePath(imageB);
  const finalPrompt = prompt || "Compare these two images. Identify differences, improvements, or regressions. Summarize key changes.";
  const reqId = generateRequestId();

  logRequest(reqId, "vision_compare", `start ${a} vs ${b}`);

  try {
    const combined = await runNode(VISION_MJS, ["compare", a, b, finalPrompt]);
    logRequest(reqId, "vision_compare", "ok");
    return combined;
  } catch (e) {
    logRequest(reqId, "vision_compare", `failed: ${e.message}`);
    throw e;
  }
}

const server = new Server(
  { name: "native-media-vision", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: "vision_describe",
      description: "Describe a screenshot/image using local Ollama vision model (qwen3-vl-optimized). For non-vision coding agents: pass image path, get text description back. Scoped strictly to Native Media AI Studio.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Absolute or repo-relative path to image (png/jpg/webp) under Native Media AI Studio. Example: output/logs/screenshot.png or D:\\...\\Native Media AI Studio\\output\\screenshot.png"
          },
          prompt: {
            type: "string",
            description: "Custom prompt. Default: detailed UI description with element positions. Use for targeted questions."
          },
          mode: {
            type: "string",
            enum: ["ui", "responsive", "regression", "compare", "music-video", "consistency"],
            description: "Preset prompt mode. 'ui' = detailed scene/elements. 'responsive' = layout issues. 'regression' = compare vs source."
          }
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
    }
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
4. ERRORS: visible errors, warnings, broken images
5. NEXT_ACTION: what should a coding agent fix first?
Viewport: ${args?.viewport || "unknown"} Label: ${args?.label || "screen"}`;
      const text = await describeImage(args?.image_path, auditPrompt, "ui");
      return textResponse(text);
    }
    logRequest(reqId, "tools/call", `unknown-tool ${name}`);
    return textResponse(`Unknown tool ${name}`, true);
  } catch (e) {
    console.error(`[${reqId}] [vision-mcp] tool error: ${e.message}`);
    return textResponse(`Vision error: ${e.message}`, true);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("native-media-vision MCP ready (project root: " + PROJECT_ROOT + ")");
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
