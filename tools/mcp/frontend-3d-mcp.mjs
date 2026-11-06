#!/usr/bin/env node
/**
 * Frontend 3D Studio MCP Bridge
 * Exposes Visualizer, Three.js Studio, Animation Studio, and Model Preview
 * as MCP tools via backend API and Vision MCP integration.
 * 
 * Usage: node frontend-3d-mcp.mjs
 * 
 * Requirements:
 * - Backend API running (see backend-openapi.yaml for endpoints)
 * - Frontend dev server running
 * - Vision MCP server available for screenshot analysis
 * - ports.json with backend_url and frontend_url
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, watchFile } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const PORTS_PATH = join(PROJECT_ROOT, "config", "ports.json");

// ─── Configuration Management ────────────────────────────────────────────────

let ports = { backend_url: "http://127.0.0.1:8000", frontend_url: "http://127.0.0.1:5173" };
let configWatcher = null;

function loadPortConfig() {
    try {
        if (existsSync(PORTS_PATH)) {
            const content = readFileSync(PORTS_PATH, "utf-8");
            const parsed = JSON.parse(content);
            // Merge with defaults, preserving existing values
            ports = { ...ports, ...parsed };
            console.error(`[config] Loaded ports: backend=${ports.backend_url}, frontend=${ports.frontend_url}`);
        }
    } catch (e) {
        console.error(`[config] Failed to load ports.json: ${e.message}`);
    }
    return ports;
}

function watchPortConfig() {
    if (configWatcher) return;
    try {
        watchFile(PORTS_PATH, { interval: 5000 }, (curr, prev) => {
            if (curr.mtimeMs !== prev.mtimeMs) {
                console.error("[config] ports.json changed, reloading...");
                loadPortConfig();
            }
        });
        configWatcher = true;
        console.error("[config] Watching ports.json for changes");
    } catch (e) {
        console.error(`[config] Failed to watch ports.json: ${e.message}`);
    }
}

// Initial load
loadPortConfig();
watchPortConfig();

const getBackendUrl = () => ports.backend_url || "http://127.0.0.1:8000";
const getFrontendUrl = () => ports.frontend_url || "http://127.0.0.1:5173";

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new McpServer(
    { name: "frontend-3d-studio", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

// ─── Helper: Fetch with Timeout & Proper Error Handling ──────────────────────

/**
 * Fetch with timeout, proper error handling, and optional auth.
 * Returns { data } on success, throws McpError on failure.
 */
class McpError extends Error {
    constructor(code, message, data) {
        super(message);
        this.name = "McpError";
        this.code = code;
        this.data = data;
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    
    const fetchOptions = {
        ...options,
        signal: controller.signal,
        headers: {
            "Content-Type": "application/json",
            // Add auth header if available
            ...(process.env.API_KEY && { "Authorization": `Bearer ${process.env.API_KEY}` }),
            ...options.headers,
        },
    };
    
    try {
        const res = await fetch(url, fetchOptions);
        clearTimeout(timer);
        
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new McpError("BACKEND_ERROR", `HTTP ${res.status}: ${text.slice(0, 500)}`, { status: res.status, url });
        }
        
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            return await res.json();
        }
        return await res.text();
    } catch (e) {
        clearTimeout(timer);
        if (e.name === "AbortError" || e.name === "TimeoutError") {
            throw new McpError("TIMEOUT", `Request timed out after ${timeoutMs}ms`, { url, timeoutMs });
        }
        if (e instanceof McpError) throw e;
        throw new McpError("FETCH_FAILED", `Fetch failed: ${e.message}`, { url, cause: e.message });
    }
}

// Helper to call backend APIs with proper error handling
async function callBackend(path, options = {}) {
    const baseUrl = getBackendUrl();
    const url = new URL(path, baseUrl).toString();
    return fetchWithTimeout(url, options);
}

// Helper to call frontend URLs
function buildFrontendUrl(pathname, params = {}) {
    const baseUrl = getFrontendUrl();
    const url = new URL(pathname, baseUrl);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    });
    return url.toString();
}

// ─── Vision MCP Integration ────────────────────────────────────────────────

/**
 * Capture a browser page screenshot using Vision MCP.
 * Returns instructions for the agent to call vision-mcp's analyze_image tool.
 */
function createVisionCapture(tool, customUrl, customPrompt) {
    const prompts = {
        visualizer: "Analyze this audio-reactive visualizer. Describe the 3D scene, visual elements, audio sync quality, and any issues.",
        threestudio: "Analyze this Three.js Studio scene. Describe objects, lighting, camera, and scene composition.",
        animationstudio: "Analyze this Animation Studio timeline. Describe the animation tracks, keyframes, and audio sync.",
        modelpreview: "Analyze this 3D model preview. Describe the model, materials, lighting, and any rendering issues.",
        vizcanvas: "Analyze this AI-generated 3D scene. Describe the scene, how well it matches the prompt, and any artifacts.",
    };
    
    const finalUrl = customUrl || buildFrontendUrl(
        tool === "visualizer" ? "/render/visualizer" :
        tool === "threestudio" ? "/create/3d" :
        tool === "animationstudio" ? "/create/animation" :
        tool === "modelpreview" ? "/generate3d" :
        "/ai-tools"
    );
    const finalPrompt = customPrompt || prompts[tool];
    
    return {
        action: "capture_3d_view",
        tool,
        url: finalUrl,
        vision_prompt: finalPrompt,
        note: "Use vision-mcp's analyze_image tool with this URL and prompt",
        usage: `await vision_mcp.analyze_image({ image_path: "${finalUrl}", prompt: "${finalPrompt.replace(/"/g, '\\"')}" })`,
    };
}

// ─── Backend API Helpers ───────────────────────────────────────────────────

async function getAudioLibrary() {
    return callBackend("/api/audio/files");
}

async function getRemixSources() {
    return callBackend("/api/audio/remix/sources");
}

async function getRemixList() {
    return callBackend("/api/audio/remix/list");
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
        const url = buildFrontendUrl("/render/visualizer", { track, mode });
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
        description: "Set the active track in the Visualizer via backend API. NOTE: Requires backend endpoint /api/visualizer/track to be implemented.",
        inputSchema: z.object({
            track: z.string().describe("Audio track filename"),
        }),
    },
    async ({ track }) => {
        const result = await callBackend("/api/visualizer/track", {
            method: "POST",
            body: JSON.stringify({ track }),
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.registerTool(
    "visualizer_set_style",
    {
        description: "Apply a visual style preset to the Visualizer. NOTE: Requires backend endpoint /api/visualizer/style to be implemented.",
        inputSchema: z.object({
            style: z.string().describe("Style preset name (e.g., 'spectral', 'waveform', 'particles', 'shader')"),
        }),
    },
    async ({ style }) => {
        const result = await callBackend("/api/visualizer/style", {
            method: "POST",
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
        const url = buildFrontendUrl("/create/3d", { scene, storyboard, autogenerate: autogenerate ? "true" : undefined, track });
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
        description: "Generate a Three.js scene via AI prompt using the AISceneGenerator. NOTE: Requires backend endpoint /api/ai/generate-scene to be implemented.",
        inputSchema: z.object({
            prompt: z.string().describe("Natural language scene description"),
            apply: z.boolean().optional().default(true).describe("Auto-apply to studio"),
        }),
    },
    async ({ prompt, apply }) => {
        const result = await callBackend("/api/ai/generate-scene", {
            method: "POST",
            body: JSON.stringify({ prompt, apply }),
        }, 120000);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.registerTool(
    "threestudio_export_frames",
    {
        description: "Export a frame sequence from Three.js Studio for video. NOTE: Requires backend endpoint /api/threestudio/export to be implemented.",
        inputSchema: z.object({
            frames: z.number().int().positive().max(10000).default(360).describe("Total frames (360 = 15s @ 24fps)"),
            fps: z.number().int().positive().max(60).default(24).describe("Frames per second"),
            output_dir: z.string().describe("Output directory path"),
        }),
    },
    async ({ frames, fps, output_dir }) => {
        const result = await callBackend("/api/threestudio/export", {
            method: "POST",
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
        const url = buildFrontendUrl("/create/animation", { track });
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
        description: "Create an AnimationClip via Theatre.js timeline. NOTE: Requires backend endpoint /api/animationstudio/clip to be implemented.",
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
        const result = await callBackend("/api/animationstudio/clip", {
            method: "POST",
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
            model_url: z.string().url().describe("URL to .glb/.gltf model"),
            auto_rotate: z.boolean().optional().default(true),
        }),
    },
    async ({ model_url, auto_rotate }) => {
        const url = buildFrontendUrl("/generate3d", { model: model_url, autorotate: auto_rotate ? "true" : "false" });
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
        const url = buildFrontendUrl("/ai-tools", { prompt });
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
            target_bpm: z.number().positive().max(300).optional().describe("Target BPM for 3D animation"),
        }),
    },
    async ({ prompt, target_bpm }) => {
        const result = await callBackend("/api/audio/remix/from-prompt", {
            method: "POST",
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
            url: z.string().url().optional().describe("Specific URL to capture (overrides tool)"),
            prompt: z.string().optional().describe("Custom analysis prompt"),
        }),
    },
    async ({ tool, url, prompt }) => {
        const capture = createVisionCapture(tool, url, prompt);
        return { content: [{ type: "text", text: JSON.stringify(capture, null, 2) }] };
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
            fetchWithTimeout(`${getBackendUrl()}/api/health`),
            fetchWithTimeout(getFrontendUrl()),
            fetchWithTimeout(`${getBackendUrl()}/api/audio/files`),
        ]);
        
        const status = {
            backend: checks[0].status === "fulfilled" ? "ok" : "failed",
            frontend: checks[1].status === "fulfilled" ? "ok" : "failed",
            audio_library: checks[2].status === "fulfilled" ? "ok" : "failed",
            tools: {
                visualizer: buildFrontendUrl("/render/visualizer"),
                threestudio: buildFrontendUrl("/create/3d"),
                animationstudio: buildFrontendUrl("/create/animation"),
                modelpreview: buildFrontendUrl("/generate3d"),
                vizcanvas: buildFrontendUrl("/ai-tools"),
            },
            backend_url: getBackendUrl(),
            frontend_url: getFrontendUrl(),
        };
        
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    },
);

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error(`\n[server] Received ${signal}, shutting down gracefully...`);
    
    if (configWatcher) {
        // watchFile doesn't have unwatch in all Node versions
        console.error("[config] Stopping config watcher");
    }
    
    // Give time for in-flight requests to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
    console.error("[server] Uncaught exception:", err);
    shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
    console.error("[server] Unhandled rejection:", reason);
});

// ─── Start Server ────────────────────────────────────────────────────────────

console.error("[server] Starting Frontend 3D Studio MCP server...");
console.error(`[server] Backend: ${getBackendUrl()}`);
console.error(`[server] Frontend: ${getFrontendUrl()}`);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Frontend 3D Studio MCP server running on stdio");