/**
 * Shared context store for MCP servers and frontend.
 *
 * This module provides a simple file-backed context that MCP servers
 * can read to get current scene/character/audio state without tight
 * coupling to the frontend or backend.
 *
 * Context shape:
 * {
 *   updatedAt: number,
 *   character: { name, notes, seed, prompt, visible, animation },
 *   scene: { name, objects, camera },
 *   audio: { filename, bpm, energy, beat },
 *   visualization: { style, mode, preset }
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CONTEXT_PATH = path.join(ROOT, "output", "mcp-context.json");

export const CHARACTER_TEMPLATES = [
  {
    label: "Leather Jacket",
    prompt: "a stylized character wearing a worn brown leather jacket, metal zippers, fabric folds, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "clothing",
  },
  {
    label: "Chainmail",
    prompt: "a stylized character wearing intricate chainmail armor, metallic rings, subsurface metal reflections, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "clothing",
  },
  {
    label: "Silk Robe",
    prompt: "a stylized character wearing a flowing silk robe, fabric drape, soft highlights, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "clothing",
  },
  {
    label: "Skin Material",
    prompt: "character skin material reference, subsurface scattering, pore detail, freckles, neutral expression, studio lighting, reference plate, highly detailed",
    tag: "skin",
  },
  {
    label: "Robot Plating",
    prompt: "a futuristic robot character with panel plating, wear and tear, scuff marks, exposed wiring joints, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "material",
  },
  {
    label: "Environment Prop",
    prompt: "a detailed environment prop, weathered wood and rusted metal, cinematic lighting, matte painting style, game engine ready, highly detailed",
    tag: "environment",
  },
];

export function readContext() {
  try {
    if (!existsSync(CONTEXT_PATH)) return { updatedAt: 0 };
    const raw = readFileSync(CONTEXT_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { updatedAt: 0 };
  }
}

export function writeContext(ctx) {
  try {
    const dir = path.dirname(CONTEXT_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONTEXT_PATH, JSON.stringify({ ...ctx, updatedAt: Date.now() }, null, 2));
  } catch {
    // non-fatal
  }
}

export function updateContext(partial) {
  const current = readContext();
  writeContext({ ...current, ...partial });
}
