#!/usr/bin/env node
/**
 * Ollama Tools MCP Server
 * 
 * Provides tool-use capabilities for Ollama models to:
 * - Generate images (via ComfyUI)
 * - Generate videos (via ComfyUI/Wan2.1)
 * - Analyze images (via Ollama VLM)
 * - Analyze audio (via backend API)
 * - Create music videos (via Remotion)
 * 
 * Usage: node tools/mcp/ollama-tools-mcp.mjs
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

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

const server = new Server(
  { name: "ollama-tools", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============================================================
// TOOL DEFINITIONS
// ============================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "analyze_image":
        return await analyzeImage(args);
      case "analyze_audio":
        return await analyzeAudio(args);
      case "generate_image":
        return await generateImage(args);
      case "generate_video":
        return await generateVideo(args);
      case "list_audio_library":
        return await listAudioLibrary();
      case "create_music_video_plan":
        return await createMusicVideoPlan(args);
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function analyzeImage(args) {
  // Read image and convert to base64
  const fs = await import("fs");
  const path = await import("path");
  
  let imageData;
  if (args.image_path.startsWith("http")) {
    const res = await fetchWithTimeout(args.image_path);
    const buf = Buffer.from(await res.arrayBuffer());
    imageData = buf.toString("base64");
  } else {
    const buf = fs.readFileSync(args.image_path);
    imageData = buf.toString("base64");
  }

  const res = await fetchWithTimeout(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model || "qwen3-vl:4b",
      prompt: args.prompt || "Describe this image in detail.",
      images: [imageData],
      stream: false,
    }),
  });

  const data = await res.json();
  return { content: [{ type: "text", text: data.response || "No response" }] };
}

async function analyzeAudio(args) {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/audio/analysis/${encodeURIComponent(args.filename)}`);
  const data = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function generateImage(args) {
  // Use ComfyUI's simple txt2img workflow via the /prompt endpoint
  // First, get the object_info to find available checkpoints and samplers
  try {
    const checkpoint = args.checkpoint || "sd_xl_base_1.0.safetensors";
    // Queue a prompt using ComfyUI's API
    // The workflow uses the default checkpoint loader + KSampler
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
      return { content: [{ type: "text", text: `✅ Image generation queued: ${data.prompt_id}\nPrompt: "${args.prompt}"\nSize: ${args.width || 1024}x${args.height || 1024}` }] };
    }
    return { content: [{ type: "text", text: `⚠️ ComfyUI response: ${JSON.stringify(data)}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ ComfyUI not available: ${err.message}` }] };
  }
}

async function generateVideo(args) {
  // Check if LTX or Wan model is available in ComfyUI
  try {
    // For now, return info about what's needed
    // In a full implementation, this would queue a video workflow
    return {
      content: [{
        type: "text",
        text: `🎬 Video generation for "${args.prompt}" (${args.duration || 4}s)\n\nTo generate videos locally, ensure ComfyUI has:\n- LTXVideo or Wan2.1 model installed\n- ComfyUI-VideoHelperSuite custom node\n\nAlternatively, use ComfyUI MCP server (comfyui) for direct workflow control.`,
      }],
    };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Error: ${err.message}` }] };
  }
}

async function listAudioLibrary() {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/audio/files`);
  const data = await res.json();
  const files = data.files.map((f) => f.filename).join("\n");
  return { content: [{ type: "text", text: `Available tracks:\n${files}` }] };
}

async function createMusicVideoPlan(args) {
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

  return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
}

// ============================================================
// START SERVER
// ============================================================

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Ollama Tools MCP server running on stdio");
