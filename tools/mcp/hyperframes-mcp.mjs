#!/usr/bin/env node
/**
 * HyperFrames MCP Bridge
 *
 * Exposes HyperFrames CLI operations as MCP tools, scoped to an isolated
 * test project at tools/hyperframes-test/ so it does not interfere with
 * the rest of the studio tooling.
 */
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const TEST_PROJECT = path.resolve(PROJECT_ROOT, "tools", "hyperframes-test");
const HYPERFRAMES_BIN = "npx";
const HYPERFRAMES_ARGS = ["hyperframes"];

function generateRequestId() {
  return `hf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logRequest(reqId, tool, detail) {
  console.error(`[${reqId}] ${tool} | ${detail}`);
}

function textResponse(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function ensureTestProject() {
  if (!existsSync(TEST_PROJECT)) {
    mkdirSync(TEST_PROJECT, { recursive: true });
  }
}

async function runHyperframes(args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(HYPERFRAMES_BIN, [...HYPERFRAMES_ARGS, ...args], {
      cwd: TEST_PROJECT,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`hyperframes request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = err.trim() || `child process exited with code ${code}`;
        return reject(new Error(msg));
      }
      resolve({ stdout: out.trim(), stderr: err.trim() });
    });
    child.on("error", reject);
  });
}

function resolveCompositionPath(relativePath) {
  if (!relativePath) return path.join(TEST_PROJECT, "index.html");
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.join(TEST_PROJECT, relativePath);
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

// ─── MCP Server ───────────────────────────────────────────────────────────────

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "hyperframes_init",
      description:
        "Initialize a new HyperFrames project under tools/hyperframes-test/. Pass --example to pick a starter template (blank, warm-grain, kinetic-type, etc.).",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Project subdirectory name under tools/hyperframes-test/ (default: current test project)",
          },
          example: {
            type: "string",
            description:
              "Starter template name, e.g. blank, warm-grain, kinetic-type, product-promo, nyt-graph, vignelli, play-mode, swiss-grid, decision-tree",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_preview",
      description:
        "Start the HyperFrames preview server (Studio) for the current test project. Returns the preview URL.",
      parameters: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "Port for preview server (default: let HyperFrames choose)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_render",
      description:
        "Render the current HyperFrames composition to a video file (MP4/MOV/WebM/GIF/PNG sequence).",
      parameters: {
        type: "object",
        properties: {
          output: {
            type: "string",
            description: "Output file path, relative to tools/hyperframes-test/ or absolute",
          },
          format: {
            type: "string",
            enum: ["mp4", "mov", "webm", "gif", "png-sequence"],
            description: "Output format (default: mp4)",
          },
          fps: {
            type: "number",
            description: "Frames per second, 1-240 or rational like 30000/1001 (default: 30)",
          },
          quality: {
            type: "string",
            enum: ["draft", "standard", "high"],
            description: "Encoding quality preset (default: standard)",
          },
          workers: {
            type: "string",
            description: "Parallel render workers, 1-24 or 'auto' (default: auto)",
          },
          gpu: {
            type: "boolean",
            description: "Enable GPU encoding (NVENC/VideoToolbox/AMF/VAAPI/QSV) (default: false)",
          },
          composition: {
            type: "string",
            description: "Path to composition HTML file (default: index.html at project root)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_lint",
      description:
        "Validate the current HyperFrames composition without rendering. Returns warnings and errors.",
      parameters: {
        type: "object",
        properties: {
          composition: {
            type: "string",
            description: "Path to composition HTML file (default: index.html at project root)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_list_examples",
      description:
        "List available HyperFrames starter templates (blank, warm-grain, kinetic-type, product-promo, etc.).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_read_composition",
      description:
        "Read the current composition HTML file from the test project. Returns the first 400 lines.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to composition HTML (default: index.html)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_write_composition",
      description:
        "Write HTML composition content to the test project. Overwrites the target file. Use this to stage new video designs before rendering.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to composition HTML (default: index.html)",
          },
          content: {
            type: "string",
            description: "Full HTML content to write",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_read_assets",
      description:
        "List media assets (images, audio, video) in the test project's assets directory.",
      parameters: {
        type: "object",
        properties: {
          subfolder: {
            type: "string",
            description: "Subfolder under assets/ to scan (default: scan entire project)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hyperframes_status",
      description:
        "Return the HyperFrames test project path, whether it exists, and the installed HyperFrames version.",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function executeHyperframesTool(name, args) {
  const reqId = generateRequestId();

  if (name === "hyperframes_init") {
    const { name: projName, example } = args || {};
    logRequest(reqId, "hyperframes_init", `example=${example || "blank"} name=${projName || "default"}`);
    try {
      ensureTestProject();
      const targetDir = projName ? path.join(TEST_PROJECT, projName) : TEST_PROJECT;
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      const toolArgs = ["init", targetDir];
      if (example) toolArgs.push("--example", example);
      const result = await runHyperframes(toolArgs, 120000);
      logRequest(reqId, "hyperframes_init", "ok");
      return textResponse(
        `Initialized HyperFrames project at: ${targetDir}\n\n${result.stdout}\n\n${result.stderr}`,
      );
    } catch (e) {
      logRequest(reqId, "hyperframes_init", `error=${e.message}`);
      return textResponse(`Failed to init HyperFrames project: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_preview") {
    const { port } = args || {};
    logRequest(reqId, "hyperframes_preview", `port=${port || "auto"}`);
    try {
      ensureTestProject();
      const toolArgs = ["preview"];
      if (port) toolArgs.push("--port", String(port));
      const child = spawn(HYPERFRAMES_BIN, [...HYPERFRAMES_ARGS, ...toolArgs], {
        cwd: TEST_PROJECT,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        shell: true,
      });
      child.unref();
      const url = `http://127.0.0.1:${port || 3000}`;
      logRequest(reqId, "hyperframes_preview", `started pid=${child.pid}`);
      return textResponse(
        `Preview server starting (PID ${child.pid}).\nOpen: ${url}\nNote: Preview runs in the background. Use hyperframes_render to produce a video file.`,
      );
    } catch (e) {
      logRequest(reqId, "hyperframes_preview", `error=${e.message}`);
      return textResponse(`Failed to start preview: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_render") {
    const { output, format, fps, quality, workers, gpu, composition } = args || {};
    logRequest(reqId, "hyperframes_render", `output=${output || "default"} format=${format || "mp4"}`);
    try {
      ensureTestProject();
      const toolArgs = ["render"];
      if (output) toolArgs.push("--output", output);
      if (format) toolArgs.push("--format", format);
      if (fps) toolArgs.push("--fps", String(fps));
      if (quality) toolArgs.push("--quality", quality);
      if (workers) toolArgs.push("--workers", String(workers));
      if (gpu) toolArgs.push("--gpu");
      if (composition) toolArgs.push("--composition", composition);
      const result = await runHyperframes(toolArgs, 600000);
      logRequest(reqId, "hyperframes_render", "ok");
      return textResponse(
        `Render complete.\n\n${result.stdout}\n\n${result.stderr}`,
      );
    } catch (e) {
      logRequest(reqId, "hyperframes_render", `error=${e.message}`);
      return textResponse(`Render failed: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_lint") {
    const { composition } = args || {};
    logRequest(reqId, "hyperframes_lint", `composition=${composition || "index.html"}`);
    try {
      ensureTestProject();
      const toolArgs = ["lint"];
      if (composition) toolArgs.push("--composition", composition);
      const result = await runHyperframes(toolArgs, 60000);
      logRequest(reqId, "hyperframes_lint", "ok");
      return textResponse(
        `Lint result:\n\n${result.stdout}\n\n${result.stderr}`,
      );
    } catch (e) {
      logRequest(reqId, "hyperframes_lint", `error=${e.message}`);
      return textResponse(`Lint failed: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_list_examples") {
    logRequest(reqId, "hyperframes_list_examples", "");
    try {
      const result = await runHyperframes(["init", "--list-examples"], 30000);
      logRequest(reqId, "hyperframes_list_examples", "ok");
      return textResponse(
        `Available templates:\n\n${result.stdout}\n\n${result.stderr}`,
      );
    } catch (e) {
      logRequest(reqId, "hyperframes_list_examples", `error=${e.message}`);
      return textResponse(`Failed to list examples: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_read_composition") {
    const { path: relPath } = args || {};
    logRequest(reqId, "hyperframes_read_composition", `path=${relPath || "index.html"}`);
    try {
      ensureTestProject();
      const abs = resolveCompositionPath(relPath || "index.html");
      if (!existsSync(abs)) {
        return textResponse(`Composition not found: ${abs}`, true);
      }
      const content = readFileSync(abs, "utf-8");
      const lines = content.split("\n");
      const preview = lines.slice(0, 400).join("\n");
      return textResponse(
        `File: ${abs}\nLines: ${lines.length}\n\n${preview}${lines.length > 400 ? "\n... (truncated)" : ""}`,
      );
    } catch (e) {
      logRequest(reqId, "hyperframes_read_composition", `error=${e.message}`);
      return textResponse(`Failed to read composition: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_write_composition") {
    const { path: relPath, content } = args || {};
    logRequest(reqId, "hyperframes_write_composition", `path=${relPath || "index.html"}`);
    try {
      ensureTestProject();
      const abs = resolveCompositionPath(relPath || "index.html");
      const dir = path.dirname(abs);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(abs, content, "utf-8");
      return textResponse(`Wrote composition to: ${abs}`);
    } catch (e) {
      logRequest(reqId, "hyperframes_write_composition", `error=${e.message}`);
      return textResponse(`Failed to write composition: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_read_assets") {
    const { subfolder } = args || {};
    logRequest(reqId, "hyperframes_read_assets", `subfolder=${subfolder || "all"}`);
    try {
      ensureTestProject();
      const scanRoot = subfolder
        ? path.join(TEST_PROJECT, subfolder)
        : TEST_PROJECT;
      const mediaExts = /\.(png|jpe?g|webp|bmp|gif|mp4|webm|mov|mp3|wav|m4a|aac)$/i;
      const results = [];
      const { readdirSync } = await import("fs");
      function scan(dir, depth = 0) {
        if (depth > 5) return;
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            scan(full, depth + 1);
          } else if (entry.isFile() && mediaExts.test(entry.name)) {
            results.push(full.replace(TEST_PROJECT, "").replace(/^[\\/]/, ""));
          }
        }
      }
      scan(scanRoot);
      logRequest(reqId, "hyperframes_read_assets", `found=${results.length}`);
      return textResponse(JSON.stringify({ assets: results }, null, 2));
    } catch (e) {
      logRequest(reqId, "hyperframes_read_assets", `error=${e.message}`);
      return textResponse(`Failed to list assets: ${e.message}`, true);
    }
  }

  if (name === "hyperframes_status") {
    logRequest(reqId, "hyperframes_status", "");
    try {
      const { execSync } = await import("child_process");
      const version = execSync
        ? execSync(`${HYPERFRAMES_BIN} ${HYPERFRAMES_ARGS.join(" ")} --version`, {
            encoding: "utf-8",
            cwd: PROJECT_ROOT,
          }).trim()
        : "unknown";
      return textResponse(
        JSON.stringify(
          {
            test_project: TEST_PROJECT,
            exists: existsSync(TEST_PROJECT),
            hyperframes_cli: `${HYPERFRAMES_BIN} ${HYPERFRAMES_ARGS.join(" ")}`,
            version,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      return textResponse(
        JSON.stringify(
          {
            test_project: TEST_PROJECT,
            exists: existsSync(TEST_PROJECT),
            hyperframes_cli: `${HYPERFRAMES_BIN} ${HYPERFRAMES_ARGS.join(" ")}`,
            version: "unknown",
          },
          null,
          2,
        ),
      );
    }
  }

  logRequest(reqId, "tools/call", `unknown-tool ${name}`);
  return textResponse(`Unknown tool ${name}. Available tools: ${TOOL_DEFS.map(t => t.function.name).join(", ")}`, true);
}

const server = new Server(
  { name: "hyperframes-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler("tools/list", async () => ({
  tools: TOOL_DEFS.map(t => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
  })),
}));

server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await executeHyperframesTool(name, args || {});
    return result;
  } catch (e) {
    console.error(`[hyperframes-mcp] tool error: ${e.message}`);
    return textResponse(`HyperFrames error: ${e.message}`, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("HyperFrames MCP Bridge ready v1.0.0");
console.error(`  Test project: ${TEST_PROJECT}`);
console.error(`  CLI: ${HYPERFRAMES_BIN} ${HYPERFRAMES_ARGS.join(" ")}`);
console.error("  Tools: hyperframes_init, hyperframes_preview, hyperframes_render, hyperframes_lint, hyperframes_list_examples, hyperframes_read_composition, hyperframes_write_composition, hyperframes_read_assets, hyperframes_status");
