#!/usr/bin/env node
/**
 * Native Media AI Studio — Vision MCP Server
 * Isolated to this repo only. Routes screenshots to local Ollama vision model
 * so non-vision coding models (via Kilo) get text descriptions.
 *
 * Tools:
 *  - vision_describe  — describe single image with local vision model
 *  - vision_compare   — compare two images
 *  - vision_ui_audit  — structured UI audit (positions, text, errors)
 *
 * Depends only on:
 *  - tools/mcp/vision.mjs (primary, has sharp resize)
 *  - tools/tests/vision_analyze.py (fallback, repo-local)
 *  - Ollama at http://127.0.0.1:11434 (models: gemma4:e2b-it-qat, qwen3-vl:4b/2b)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ANALYZE_MJS = path.join(PROJECT_ROOT, "scripts", "vision", "analyze.mjs");
const VISION_MJS = path.join(PROJECT_ROOT, "tools", "mcp", "vision.mjs");
const ANALYZE_PY = path.join(PROJECT_ROOT, "tools", "tests", "vision_analyze.py");

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], { cwd: PROJECT_ROOT });
    let out = "", err = "";
    child.stdout.on("data", d => out += d);
    child.stderr.on("data", d => err += d);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(err || `exit ${code}`));
      resolve(out.trim());
    });
    child.on("error", reject);
  });
}

function runAnalyzePy(imagePath, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [ANALYZE_PY, imagePath, prompt], { cwd: PROJECT_ROOT });
    let out = "", err = "";
    child.stdout.on("data", d => out += d);
    child.stderr.on("data", d => err += d);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(err || `vision_analyze.py exit ${code}`));
      resolve(out.trim());
    });
    child.on("error", reject);
  });
}

async function describeImage(imagePath, prompt, mode) {
  const abs = path.isAbsolute(imagePath) ? imagePath : path.join(PROJECT_ROOT, imagePath);
  if (!fs.existsSync(abs)) throw new Error(`Image not found: ${abs} (project root: ${PROJECT_ROOT})`);
  // Prefer vision.mjs (has sharp resize), fallback to analyze.mjs, then python
  try {
    const args = ["analyze", abs, prompt || "Describe this image in detail.", "--mode", mode || "ui"];
    return await runNode(VISION_MJS, args);
  } catch (e) {
    try {
      return await runNode(ANALYZE_MJS, [abs, "--prompt", prompt || "Describe this image in detail.", "--mode", mode || "ui"]);
    } catch {
      return await runAnalyzePy(abs, prompt || "Describe this image in detail.");
    }
  }
}

const server = new Server(
  { name: "native-media-vision", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "vision_describe",
      description: "Describe a screenshot/image using local Ollama vision model (qwen3-vl:4b). For non-vision coding agents: pass image path, get text description back. Scoped strictly to Native Media AI Studio.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: { type: "string", description: "Absolute or repo-relative path to image (png/jpg) under Native Media AI Studio. Example: output/logs/screenshot.png or D:\\...\\Native Media AI Studio\\output\\screenshot.png" },
          prompt: { type: "string", description: "Custom prompt. Default: detailed UI description with element positions. Use for targeted questions." },
          mode: { type: "string", enum: ["ui", "responsive", "regression", "compare", "music-video", "consistency"], description: "Preset prompt mode. 'ui' = detailed scene/elements. 'responsive' = layout issues. 'regression' = compare vs source." }
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
          image_path: { type: "string" },
          viewport: { type: "string", description: "e.g. 1280x800" },
          label: { type: "string", description: "Screen label, e.g. Generation3DPage" }
        },
        required: ["image_path"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "vision_describe") {
      const text = await describeImage(args.image_path, args.prompt || null, args.mode || "ui");
      return { content: [{ type: "text", text }] };
    }
    if (name === "vision_compare") {
      const prompt = args.prompt || "Compare these two images. Identify differences, improvements, or regressions. Summarize key changes.";
      const a = path.isAbsolute(args.image_a) ? args.image_a : path.join(PROJECT_ROOT, args.image_a);
      const b = path.isAbsolute(args.image_b) ? args.image_b : path.join(PROJECT_ROOT, args.image_b);
      // Use vision.mjs compare command (has resize)
      const combined = await runNode(VISION_MJS, ["compare", a, b, prompt]);
      return { content: [{ type: "text", text: combined }] };
    }
    if (name === "vision_ui_audit") {
      const auditPrompt = `Perform a structured UI audit. Return JSON-like sections:
1. ELEMENTS: list visible UI elements with approximate position (top-left, center, bottom-right etc)
2. TEXT: transcribe visible text labels/buttons
3. LAYOUT: responsive/layout issues
4. ERRORS: visible errors, warnings, broken images
5. NEXT_ACTION: what should a coding agent fix first?
Viewport: ${args.viewport || "unknown"} Label: ${args.label || "screen"}`;
      const text = await describeImage(args.image_path, auditPrompt, "ui");
      return { content: [{ type: "text", text }] };
    }
    throw new Error(`Unknown tool ${name}`);
  } catch (e) {
    return { content: [{ type: "text", text: `Vision error: ${e.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("native-media-vision MCP ready (project root: " + PROJECT_ROOT + ")");
}
main().catch(err => { console.error(err); process.exit(1); });
