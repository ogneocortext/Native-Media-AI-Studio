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
    const res = await fetch(args.image_path);
    const buf = Buffer.from(await res.arrayBuffer());
    imageData = buf.toString("base64");
  } else {
    const buf = fs.readFileSync(args.image_path);
    imageData = buf.toString("base64");
  }

  const res = await fetch(`${BASE_URL}/api/generate`, {
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
  const res = await fetch(`${BACKEND_URL}/api/audio/analysis/${encodeURIComponent(args.filename)}`);
  const data = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function generateImage(args) {
  // Queue a ComfyUI workflow
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: {
        "3": { inputs: { text: args.prompt, clip: ["11", 0] }, class_type: "CLIPTextEncode" },
        "4": { inputs: { text: args.negative_prompt || "", clip: ["11", 0] }, class_type: "CLIPTextEncode" },
        // ... simplified workflow
      },
    }),
  });
  const data = await res.json();
  return { content: [{ type: "text", text: `Image generation queued: ${data.prompt_id}` }] };
}

async function generateVideo(args) {
  return { content: [{ type: "text", text: `Video generation for "${args.prompt}" (${args.duration}s @ ${args.fps}fps) - requires ComfyUI LTX/Wan model` }] };
}

async function listAudioLibrary() {
  const res = await fetch(`${BACKEND_URL}/api/audio/files`);
  const data = await res.json();
  const files = data.files.map((f) => f.filename).join("\n");
  return { content: [{ type: "text", text: `Available tracks:\n${files}` }] };
}

async function createMusicVideoPlan(args) {
  const analysisRes = await fetch(`${BACKEND_URL}/api/audio/analysis/${encodeURIComponent(args.filename)}`);
  const analysis = await analysisRes.json();
  
  const plan = {
    track: args.filename,
    bpm: analysis.tempo_bpm,
    duration: analysis.duration_seconds,
    energy: analysis.energy_curve,
    recommended_style: analysis.tempo_bpm > 120 ? "high-energy" : "chiral",
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
