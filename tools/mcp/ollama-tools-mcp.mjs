#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONTEXT_PATH = path.join(PROJECT_ROOT, "output", "mcp-context.json");

const BASE_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const MAX_IMAGE_BASE64_BYTES = 20 * 1024 * 1024; // 20 MB safety cap

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function textResponse(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function logRequest(reqId, tool, detail) {
  console.error(`[${reqId}] ${tool} | ${detail}`);
}

// Helper: fetch with timeout and ok-check
async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function readImageBase64(imagePath) {
  const fs = await import("fs");
  const buf = fs.readFileSync(imagePath);
  const base64 = buf.toString("base64");
  if (buf.length > MAX_IMAGE_BASE64_BYTES) {
    throw new Error(`Image too large for Ollama: ${(buf.length / 1024 / 1024).toFixed(1)} MB (cap ${MAX_IMAGE_BASE64_BYTES / 1024 / 1024} MB)`);
  }
  return base64;
}

const PROMPT_TEMPLATES = {
  "3d-character": "a stylized 3D character concept, {description}, neutral A-pose, front view, studio lighting, white background, high detail, clean silhouette, game-ready",
  "3d-character-texture": "character texture sheet, {description}, albedo map, normal map details, clothing folds, skin pores, fabric materials, PBR-ready, neutral lighting",
  "3d-clothing": "clothing design, {description}, fabric texture, drape simulation reference, flat lay and worn view, material close-up, fashion tech pack style",
  "3d-skin-material": "skin material reference, {description}, subsurface scattering reference, pore detail, freckles/markings, neutral expression, studio lighting, reference plate",
  "3d-environment": "3D environment concept, {description}, wide shot, cinematic lighting, atmospheric fog, detailed props, game engine ready, matte painting style",
  "viz-ui": "UI screenshot analysis: list visible elements, text, layout issues, errors, and the highest-impact fix",
  "viz-responsive": "Responsive layout audit: viewport fit, touch targets, readability, hidden content, and one concrete fix",
  "viz-regression": "Regression review: what changed, what broke, severity, and the shortest patch path",
  "viz-compare": "Compare these two screenshots and summarize differences, improvements, and regressions",
  "viz-music-video": "Music-video frame analysis: visual elements, audio sync, style consistency, issues, and one production upgrade",
  "viz-consistency": "Visual consistency audit: color drift, typography mismatches, asset reuse needs, continuity issues, and recommendation",
};

const DEFAULT_NEGATIVE_PROMPT = "text, watermark, low quality, blurry, jpeg artifacts, cartoon, illustration, deformed, mutated, extra limbs, disfigured";

function readMCPContext() {
  try {
    if (!existsSync(CONTEXT_PATH)) return null;
    const raw = readFileSync(CONTEXT_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const server = new Server(
  { name: "ollama-tools", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============================================================
// TOOL DEFINITIONS
// ============================================================

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: "analyze_image",
      description: "Analyze an image using Ollama vision model. Returns description, objects, colors, mood.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: { type: "string", description: "Path or URL to the image" },
          prompt: { type: "string", description: "Question to ask about the image", default: "Describe this image in detail." },
          model: { type: "string", description: "Ollama vision model", default: "qwen3-vl:4b" },
        },
        required: ["image_path"],
      },
    },
    {
      name: "analyze_audio",
      description: "Analyze an audio file to extract BPM, beats, energy, sections.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Audio filename from the library" },
        },
        required: ["filename"],
      },
    },
    {
      name: "generate_image",
      description: "Generate an image via ComfyUI workflow.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Image prompt" },
          negative_prompt: { type: "string", description: "Negative prompt", default: "" },
          width: { type: "number", description: "Width in pixels", default: 1024 },
          height: { type: "number", description: "Height in pixels", default: 1024 },
          workflow: { type: "string", description: "ComfyUI workflow name", default: "txt2img" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "generate_video",
      description: "Generate a video clip via ComfyUI (LTX/Wan2.1 model).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Video prompt" },
          duration: { type: "number", description: "Duration in seconds", default: 4 },
          fps: { type: "number", description: "Frames per second", default: 24 },
        },
        required: ["prompt"],
      },
    },
    {
      name: "list_audio_library",
      description: "List all available audio tracks in the library.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_music_video_plan",
      description: "Create a music video production plan based on audio analysis and track characteristics.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Audio filename" },
          style: { type: "string", description: "Visual style preference (optional)" },
        },
        required: ["filename"],
      },
    },
    {
      name: "suggest_3d_prompt",
      description: "Enhance a raw idea into a 3D-ready prompt with skin/texture/clothing/material guidance. Returns an optimized prompt + negative prompt.",
      inputSchema: {
        type: "object",
        properties: {
          idea: { type: "string", description: "Raw character/object idea" },
          category: { type: "string", description: "One of: character, clothing, skin_material, environment", default: "character" },
          style: { type: "string", description: "Optional style hint (cyberpunk, fantasy, realistic, stylized)" },
        },
        required: ["idea"],
      },
    },
    {
      name: "generate_3d_concept",
      description: "Generate a concept image optimized for 3D conversion (Hunyuan3D-friendly). Uses prompt templates for characters, clothing, skin, or environments.",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Subject description" },
          category: { type: "string", description: "One of: 3d-character, 3d-character-texture, 3d-clothing, 3d-skin-material, 3d-environment", default: "3d-character" },
          width: { type: "number", description: "Width in pixels", default: 1024 },
          height: { type: "number", description: "Height in pixels", default: 1024 },
        },
        required: ["description"],
      },
    },
    {
      name: "update_mcp_context",
      description: "Update the shared MCP context (character, scene, audio, visualization state) so other tools/servers can use it.",
      inputSchema: {
        type: "object",
        properties: {
          context: {
            type: "object",
            description: "Partial context to merge: { character?, scene?, audio?, visualization? }",
          },
        },
        required: ["context"],
      },
    },
  ],
}));

// ============================================================
// TOOL HANDLERS
// ============================================================

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;
  const reqId = generateRequestId();
  logRequest(reqId, name, "start");

  try {
    switch (name) {
      case "analyze_image":
        return await analyzeImage(reqId, args);
      case "analyze_audio":
        return await analyzeAudio(reqId, args);
      case "generate_image":
        return await generateImage(reqId, args);
      case "generate_video":
        return await generateVideo(reqId, args);
      case "list_audio_library":
        return await listAudioLibrary(reqId);
      case "create_music_video_plan":
        return await createMusicVideoPlan(reqId, args);
      case "suggest_3d_prompt":
        return await suggest3DPrompt(reqId, args);
      case "generate_3d_concept":
        return await generate3DConcept(reqId, args);
      case "update_mcp_context":
        return await updateMCPContext(reqId, args);
      default:
        logRequest(reqId, name, "unknown-tool");
        return textResponse(`Unknown tool: ${name}`, true);
    }
  } catch (err) {
    logRequest(reqId, name, `error: ${err.message}`);
    return textResponse(`Error: ${err.message}`, true);
  }
});

async function analyzeImage(reqId, args) {
  const fs = await import("fs");
  const path = await import("path");
  
  let imageData;
  if (args.image_path.startsWith("http")) {
    logRequest(reqId, "analyze_image", "fetching-remote-image");
    const res = await fetchWithTimeout(args.image_path);
    const buf = Buffer.from(await res.arrayBuffer());
    imageData = buf.toString("base64");
  } else {
    const abs = path.resolve(args.image_path);
    if (!fs.existsSync(abs)) {
      return textResponse(`Image not found: ${abs}`, true);
    }
    logRequest(reqId, "analyze_image", `reading-local: ${abs}`);
    imageData = await readImageBase64(abs);
  }

  logRequest(reqId, "analyze_image", `calling-ollama model=${args.model || "qwen3-vl:4b"}`);
  const res = await fetchWithTimeout(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model || "qwen3-vl:4b",
      prompt: args.prompt || "Describe this image in detail.",
      images: [imageData],
      stream: false,
      keep_alive: "60s",
    }),
  });

  const data = await res.json();
  logRequest(reqId, "analyze_image", "ollama-ok");
  return textResponse(data.response || "No response");
}

async function analyzeAudio(reqId, args) {
  if (!args.filename) {
    return textResponse("Missing required arg: filename", true);
  }
  logRequest(reqId, "analyze_audio", `filename=${args.filename}`);
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/audio/analysis/${encodeURIComponent(args.filename)}`);
  const data = await res.json();
  return textResponse(JSON.stringify(data, null, 2));
}

async function generateImage(reqId, args) {
  logRequest(reqId, "generate_image", `prompt=${args.prompt}`);
  try {
    const checkpoint = args.checkpoint || "sd_xl_base_1.0.safetensors";
    const workflow = {
      "3": {
        inputs: {
          seed: Math.floor(Math.random() * 1000000000),
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
        class_type: "KSampler",
      },
      "4": {
        inputs: { ckpt_name: checkpoint },
        class_type: "CheckpointLoaderSimple",
      },
      "5": {
        inputs: {
          batch_size: 1,
          height: args.height || 1024,
          width: args.width || 1024,
        },
        class_type: "EmptyLatentImage",
      },
      "6": {
        inputs: { text: args.prompt, clip: ["4", 1] },
        class_type: "CLIPTextEncode",
      },
      "7": {
        inputs: { text: args.negative_prompt || "text, watermark, low quality, blurry", clip: ["4", 1] },
        class_type: "CLIPTextEncode",
      },
      "8": {
        inputs: { samples: ["3", 0], vae: ["4", 2] },
        class_type: "VAEDecode",
      },
      "9": {
        inputs: { filename_prefix: "ollama_tool", images: ["8", 0] },
        class_type: "SaveImage",
      },
    };

    const res = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    const data = await res.json();
    if (data.prompt_id) {
      return textResponse(`✅ Image generation queued: ${data.prompt_id}\nPrompt: "${args.prompt}"\nSize: ${args.width || 1024}x${args.height || 1024}`);
    }
    logRequest(reqId, "generate_image", `comfyui-warn prompt_id-missing`);
    return textResponse(`⚠️ ComfyUI response: ${JSON.stringify(data)}`);
  } catch (err) {
    logRequest(reqId, "generate_image", `comfyui-error: ${err.message}`);
    return textResponse(`❌ ComfyUI not available: ${err.message}`, true);
  }
}

async function generateVideo(reqId, args) {
  logRequest(reqId, "generate_video", `prompt=${args.prompt}`);
  try {
    return textResponse(`🎬 Video generation for "${args.prompt}" (${args.duration || 4}s)\n\nTo generate videos locally, ensure ComfyUI has:\n- LTXVideo or Wan2.1 model installed\n- ComfyUI-VideoHelperSuite custom node\n\nAlternatively, use ComfyUI MCP server (comfyui) for direct workflow control.`);
  } catch (err) {
    return textResponse(`❌ Error: ${err.message}`, true);
  }
}

async function listAudioLibrary(reqId) {
  logRequest(reqId, "list_audio_library", "fetching-backend");
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/audio/files`);
  const data = await res.json();
  const files = (data.files || []).map((f) => f.filename).join("\n");
  return textResponse(`Available tracks:\n${files}`);
}

async function createMusicVideoPlan(reqId, args) {
  if (!args.filename) {
    return textResponse("Missing required arg: filename", true);
  }
  logRequest(reqId, "create_music_video_plan", `filename=${args.filename}`);
  const analysisRes = await fetchWithTimeout(`${BACKEND_URL}/api/audio/analysis/${encodeURIComponent(args.filename)}`);
  const analysis = await analysisRes.json();
  
  const plan = {
    track: args.filename,
    bpm: analysis.tempo_bpm,
    duration: analysis.duration_seconds,
    energy: analysis.energy_curve,
    recommended_style: analysis.tempo_bpm > 120 ? "high-energy" : "chill",
    scenes: analysis.sections?.map((s) => ({
      start: s.start,
      end: s.end,
      type: s.type,
      energy: s.energy,
    })),
  };

  return textResponse(JSON.stringify(plan, null, 2));
}

async function suggest3DPrompt(reqId, args) {
  const idea = args?.idea;
  if (!idea || typeof idea !== "string") {
    return textResponse("Missing required arg: idea", true);
  }
  const category = (args?.category || "character").toLowerCase();
  const style = args?.style ? `, ${args.style} style` : "";
  const template = PROMPT_TEMPLATES[`3d-${category}`] || PROMPT_TEMPLATES["3d-character"];
  let positive = template.replace("{description}", idea) + style;

  // Enrich with frontend context when available
  const ctx = readMCPContext();
  if (ctx?.visualization?.style) {
    positive += `, ${ctx.visualization.style} visual style`;
  }
  if (ctx?.audio?.energy && ctx.audio.energy > 0.7) {
    positive += ", high energy pose";
  } else if (ctx?.audio?.energy && ctx.audio.energy < 0.3) {
    positive += ", calm relaxed pose";
  }
  if (ctx?.character?.notes) {
    positive += `, ${ctx.character.notes}`;
  }

  const result = {
    category,
    positive,
    negative: DEFAULT_NEGATIVE_PROMPT,
    context_used: !!ctx,
    note: "Use this prompt to generate a concept image for 3D conversion.",
  };
  logRequest(reqId, "suggest_3d_prompt", `category=${category} idea=${idea.slice(0, 40)}`);
  return textResponse(JSON.stringify(result, null, 2));
}

async function generate3DConcept(reqId, args) {
  const description = args?.description;
  if (!description || typeof description !== "string") {
    return textResponse("Missing required arg: description", true);
  }
  const category = (args?.category || "3d-character").toLowerCase();
  const template = PROMPT_TEMPLATES[category] || PROMPT_TEMPLATES["3d-character"];
  const prompt = template.replace("{description}", description);
  const negative = DEFAULT_NEGATIVE_PROMPT;
  logRequest(reqId, "generate_3d_concept", `category=${category} desc=${description.slice(0, 40)}`);
  return await generateImage(reqId, {
    prompt,
    negative_prompt: negative,
    width: args?.width || 1024,
    height: args?.height || 1024,
  });
}

async function updateMCPContext(reqId, args) {
  const patch = args?.context || args;
  if (!patch || typeof patch !== "object") {
    return textResponse("Missing required arg: context (partial context object)", true);
  }
  try {
    const { writeFileSync, existsSync, mkdirSync } = await import("node:fs");
    const ctxPath = path.join(PROJECT_ROOT, "output", "mcp-context.json");
    const dir = path.dirname(ctxPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const prev = readMCPContext() || {};
    const next = { ...prev, ...patch, updatedAt: Date.now() };
    writeFileSync(ctxPath, JSON.stringify(next, null, 2));
    logRequest(reqId, "update_mcp_context", `keys=${Object.keys(patch).join(",")}`);
    return textResponse(JSON.stringify({ ok: true, context: next }, null, 2));
  } catch (e) {
    logRequest(reqId, "update_mcp_context", `error=${e.message}`);
    return textResponse(`Failed to update context: ${e.message}`, true);
  }
}

// ============================================================
// START SERVER
// ============================================================

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Ollama Tools MCP server running on stdio");
