#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";

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

// ============================================================
// START SERVER
// ============================================================

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Ollama Tools MCP server running on stdio");
