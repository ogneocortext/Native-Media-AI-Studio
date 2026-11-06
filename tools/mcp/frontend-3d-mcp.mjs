#!/usr/bin/env node
/**
 * Frontend 3D Studio MCP Bridge
 * Exposes Visualizer, Three.js Studio, Animation Studio, and Model Preview
 * as MCP tools via backend API and Vision MCP integration.
 * 
 * Usage: node frontend-3d-mcp.mjs
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const PORTS_PATH = join(PROJECT_ROOT, "config", "ports.json");

// Load port configuration
let ports = {};
try {
    if (existsSync(PORTS_PATH)) {
        ports = JSON.parse(readFileSync(PORTS_PATH, "utf-8"));
    }
} catch { /* ignore */ }

const BACKEND_URL = ports.backend_url || "http://127.0.0.1:8000";
const FRONTEND_URL = ports.frontend_url || "http://127.0.0.1:5173";

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new McpServer(
    { name: "frontend-3d-studio", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

// ─── Helper: Fetch with Timeout ──────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
        }
        return await res.json();
    } catch (e) {
        if (e.name === "AbortError") return { error: `Request timed out (${timeoutMs}ms)` };
        return { error: `Fetch failed: ${e.message}` };
    } finally {
        clearTimeout(timer);
    }
}

// ─── Vision MCP Integration ──────────────────────────────────────────────────

/**
 * Capture a browser page screenshot using Vision MCP.
 * This uses the vision-mcp server's analyze_image tool.
 */
async function captureAndAnalyze(url, prompt) {
    // We'll use the vision-mcp via its stdio interface
    // For now, return the URL and prompt for the agent to handle
    return {
        note: "Use vision-mcp's analyze_image tool with this URL and prompt",
        url,
        suggested_prompt: prompt,
    };
}

// ─── Backend API Helpers ─────────────────────────────────────────────────────

async function getAudioLibrary() {
    return fetchWithTimeout(`${BACKEND_URL}/api/audio/files`);
}

async function getRemixSources() {
    return fetchWithTimeout(`${BACKEND_URL}/api/audio/remix/sources`);
}

async function getRemixList() {
    return fetchWithTimeout(`${BACKEND_URL}/api/audio/remix/list`);
}

async function getVisualizerState() {
    // Try to get current visualizer state from backend
    return fetchWithTimeout(`${BACKEND_URL}/api/visualizer/state`);
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

// 1. Visualizer Control
server.registerTool(
    "visualizer_open",
    {
        description: "Open the Visualizer page with a specific track. Returns URL for Vision MCP analysis.",
        inputSchema: z.object({
            track: z.string().optional().describe("Audio track filename to load"),
            mode: z.enum(["2d", "3d", "shader"]).optional().describe("Visualization mode"),
        }),
    },
    async ({ track, mode }) => {
        let url = `${FRONTEND_URL}/render/visualizer`;
        if (track) url += `?track=${encodeURIComponent(track)}`;
        if (mode) url += `${track ? "&" : "?"}mode=${mode}`;
        
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    action: "visualizer_open",
                    url,
                    track: track || "none (opens empty state)",
                    mode: mode || "default",
                    note: "Open this URL in browser, then use vision-mcp's analyze_image to inspect the visualizer state",
                }, null, 2),
            }],
        };
    },
);

server.registerTool(
    "visualizer_set_track",
    {
        description: "Set the active track in the Visualizer via backend API.",
        inputSchema: z.object({
            track: z.string().describe("Audio track filename"),
        }),
    },
    async ({ track }) => {
        const result = await fetchWithTimeout(`${BACKEND_URL}/api/visualizer/track`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track }),
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.registerTool(
    "visualizer_set_style",
    {
        description: "Apply a visual style preset to the Visualizer.",
        inputSchema: z.object({
            style: z.string().describe("Style preset name (e.g., 'spectral', 'waveform', 'particles', 'shader')"),
        }),
    },
    async ({ style }) => {
        const result = await fetchWithTimeout(`${BACKEND_URL}/api/visualizer/style`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ style }),
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

// 2. Three.js Studio Control
server.registerTool(
    "threestudio_open",
    {
        description: "Open Three.js Studio with optional scene/storyboard params. Returns URL for Vision MCP.",
        inputSchema: z.object({
            scene: z.string().optional().describe("Scene name or template"),
            storyboard: z.string().optional().describe("Storyboard ID"),
            autogenerate: z.boolean().optional().describe("Auto-generate scene"),
            track: z.string().optional().describe("Audio track for sync"),
        }),
    },
    async ({ scene, storyboard, autogenerate, track }) => {
        let url = `${FRONTEND_URL}/create/3d`;
        const params = new URLSearchParams();
        if (scene) params.set("scene", scene);
        if (storyboard) params.set("storyboard", storyboard);
        if (autogenerate) params.set("autogenerate", "true");
        if (track) params.set("track", track);
        if (params.toString()) url += `?${params.toString()}`;
        
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    action: "threestudio_open",
                    url,
                    params: { scene, storyboard, autogenerate, track },
                    note: "Open URL in browser, then use vision-mcp to analyze Three.js Studio state",
                }, null, 2),
            }],
        };
    },
);

server.registerTool(
    "threestudio_generate_scene",
    {
        description: "Generate a Three.js scene via AI prompt using the AISceneGenerator.",
        inputSchema: z.object({
            prompt: z.string().describe("Natural language scene description"),
            apply: z.boolean().optional().default(true).describe("Auto-apply to studio"),
        }),
    },
    async ({ prompt, apply }) => {
        const result = await fetchWithTimeout(`${BACKEND_URL}/api/ai/generate-scene`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, apply }),
        }, 120000);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.registerTool(
    "threestudio_export_frames",
    {
        description: "Export a frame sequence from Three.js Studio for video.",
        inputSchema: z.object({
            frames: z.number().default(360).describe("Total frames (360 = 15s @ 24fps)"),
            fps: z.number().default(24).describe("Frames per second"),
            output_dir: z.string().describe("Output directory path"),
        }),
    },
    async ({ frames, fps, output_dir }) => {
        const result = await fetchWithTimeout(`${BACKEND_URL}/api/threestudio/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ frames, fps, output_dir }),
        }, 300000);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

// 3. Animation Studio (Theatre.js) Control
server.registerTool(
    "animationstudio_open",
    {
        description: "Open Animation Studio with optional track. Returns URL for Vision MCP.",
        inputSchema: z.object({
            track: z.string().optional().describe("Audio track for sync"),
        }),
    },
    async ({ track }) => {
        let url = `${FRONTEND_URL}/create/animation`;
        if (track) url += `?track=${encodeURIComponent(track)}`;
        
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    action: "animationstudio_open",
                    url,
                    track: track || "none",
                    note: "Open URL in browser, use vision-mcp to inspect Theatre.js timeline",
                }, null, 2),
            }],
        };
    },
);

server.registerTool(
    "animationstudio_create_clip",
    {
        description: "Create an AnimationClip via Theatre.js timeline.",
        inputSchema: z.object({
            object_name: z.string().describe("Object to animate"),
            clip_path: z.string().describe("Asset path for AnimationClip"),
            keyframes: z.array(z.object({
                trackId: z.string(),
                time: z.number(),
                value: z.number(),
            })).describe("Keyframe data"),
        }),
    },
    async ({ object_name, clip_path, keyframes }) => {
        const result = await fetchWithTimeout(`${BACKEND_URL}/api/animationstudio/clip`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ object_name, clip_path, keyframes }),
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

// 4. Model Preview (3D Viewer)
server.registerTool(
    "modelpreview_open",
    {
        description: "Open Model Preview with a 3D model. Returns URL for Vision MCP.",
        inputSchema: z.object({
            model_url: z.string().describe("URL to .glb/.gltf model"),
            auto_rotate: z.boolean().optional().default(true),
        }),
    },
    async ({ model_url, auto_rotate }) => {
        let url = `${FRONTEND_URL}/generate3d?model=${encodeURIComponent(model_url)}`;
        if (!auto_rotate) url += "&autorotate=false";
        
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    action: "modelpreview_open",
                    url,
                    model_url,
                    auto_rotate,
                    note: "Open URL in browser, use vision-mcp to inspect model",
                }, null, 2),
            }],
        };
    },
);

// 5. Visualization Canvas (AI 3D Preview)
server.registerTool(
    "vizcanvas_open",
    {
        description: "Open AI Tools Visualization Canvas with a prompt.",
        inputSchema: z.object({
            prompt: z.string().describe("AI generation prompt for 3D scene"),
        }),
    },
    async ({ prompt }) => {
        const url = `${FRONTEND_URL}/ai-tools?prompt=${encodeURIComponent(prompt)}`;
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    action: "vizcanvas_open",
                    url,
                    prompt,
                    note: "Open URL in browser, use vision-mcp to analyze generated 3D scene",
                }, null, 2),
            }],
        };
    },
);

// 6. Audio/Remix Integration
server.registerTool(
    "get_audio_library",
    {
        description: "List all available audio tracks for 3D synchronization.",
        inputSchema: z.object({}),
    },
    async () => {
        const result = await getAudioLibrary();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.registerTool(
    "get_remix_sources",
    {
        description: "Get tracks with separated stems for 3D audio sync.",
        inputSchema: z.object({}),
    },
    async () => {
        const result = await getRemixSources();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.registerTool(
    "create_remix_for_3d",
    {
        description: "Create a remix recipe optimized for 3D synchronization.",
        inputSchema: z.object({
            prompt: z.string().describe("Natural language remix request"),
            target_bpm: z.number().optional().describe("Target BPM for 3D animation"),
        }),
    },
    async ({ prompt, target_bpm }) => {
        const result = await fetchWithTimeout(`${BACKEND_URL}/api/audio/remix/from-prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, target_bpm }),
        }, 180000);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

// 7. Vision MCP Integration Helpers
server.registerTool(
    "capture_3d_view",
    {
        description: "Capture and analyze a 3D view using Vision MCP. Returns URL + prompt for vision-mcp.",
        inputSchema: z.object({
            tool: z.enum(["visualizer", "threestudio", "animationstudio", "modelpreview", "vizcanvas"]).describe("Which 3D tool to capture"),
            url: z.string().optional().describe("Specific URL to capture (overrides tool)"),
            prompt: z.string().optional().describe("Custom analysis prompt"),
        }),
    },
    async ({ tool, url, prompt }) => {
        const prompts = {
            visualizer: "Analyze this audio-reactive visualizer. Describe the 3D scene, visual elements, audio sync quality, and any issues.",
            threestudio: "Analyze this Three.js Studio scene. Describe objects, lighting, camera, and scene composition.",
            animationstudio: "Analyze this Animation Studio timeline. Describe the animation tracks, keyframes, and audio sync.",
            modelpreview: "Analyze this 3D model preview. Describe the model, materials, lighting, and any rendering issues.",
            vizcanvas: "Analyze this AI-generated 3D scene. Describe the scene, how well it matches the prompt, and any artifacts.",
        };
        
        const finalUrl = url || `${FRONTEND_URL}/${tool === "visualizer" ? "render/visualizer" : tool === "threestudio" ? "create/3d" : tool === "animationstudio" ? "create/animation" : tool === "modelpreview" ? "generate3d" : "ai-tools"}`;
        const finalPrompt = prompt || prompts[tool];
        
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    action: "capture_3d_view",
                    tool,
                    url: finalUrl,
                    vision_prompt: finalPrompt,
                    note: "Use vision-mcp's analyze_image tool with this URL and prompt",
                    usage: `await vision_mcp.analyze_image({ image_path: "${finalUrl}", prompt: "${finalPrompt.replace(/"/g, '\\"')}" })`,
                }, null, 2),
            }],
        };
    },
);

// 8. Status/Health
server.registerTool(
    "frontend_3d_status",
    {
        description: "Get status of all frontend 3D tools and backend connectivity.",
        inputSchema: z.object({}),
    },
    async () => {
        const checks = await Promise.allSettled([
            fetchWithTimeout(`${BACKEND_URL}/api/health`),
            fetchWithTimeout(`${FRONTEND_URL}`),
            fetchWithTimeout(`${BACKEND_URL}/api/audio/files`),
        ]);
        
        const status = {
            backend: checks[0].status === "fulfilled" ? "ok" : "failed",
            frontend: checks[1].status === "fulfilled" ? "ok" : "failed",
            audio_library: checks[2].status === "fulfilled" ? "ok" : "failed",
            tools: {
                visualizer: `${FRONTEND_URL}/render/visualizer`,
                threestudio: `${FRONTEND_URL}/create/3d`,
                animationstudio: `${FRONTEND_URL}/create/animation`,
                modelpreview: `${FRONTEND_URL}/generate3d`,
                vizcanvas: `${FRONTEND_URL}/ai-tools`,
            },
        };
        
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    },
);

// ─── Start Server ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Frontend 3D Studio MCP server running on stdio");