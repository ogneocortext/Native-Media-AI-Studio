/**
 * MCP Skills API client for the Native Media AI Studio frontend agent.
 *
 * Exposes the skills served by the backend /api/mcp/skills/* endpoints so a
 * frontend agent can discover, read, and use skills for tool-calling.
 */

import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";
import { type ToolDefinition } from "./ollama";

export interface SkillInfo {
  name: string;
  description: string;
  version: string | null;
  server: string | null;
  tools: string[];
  tags: string[];
  uri: string;
  resources: {
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  }[];
}

export interface SkillContent {
  name: string;
  version: string | null;
  server: string | null;
  tools: string[];
  tags: string[];
  frontmatter: Record<string, unknown>;
  body: string;
  resources: {
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  }[];
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface SkillResourceContent {
  contents: {
    uri: string;
    mimeType: string;
    text?: string;
    blob?: string;
  }[];
}

/**
 * List all available skills with their frontmatter metadata.
 */
export async function skillsList(): Promise<SkillInfo[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/mcp/skills/list`, {
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`Failed to list skills (${res.status})`);
  return res.json();
}

/**
 * Get a skill's full content by URI (e.g. skill://vision/SKILL.md).
 */
export async function skillsGet(uri: string): Promise<SkillContent> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/mcp/skills/get?uri=${encodeURIComponent(uri)}`, {
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`Failed to get skill (${res.status})`);
  return res.json();
}

/**
 * Read a skill file as plain text (SKILL.md, references/GUIDE.md, etc.).
 */
export async function skillsReadFile(uri: string): Promise<string> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}${uri.startsWith("/") ? uri : "/" + uri}`, {
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`Failed to read skill file (${res.status})`);
  return res.text();
}

/**
 * List all available tools with their descriptions.
 */
export async function toolsList(): Promise<ToolInfo[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/mcp/tools`, {
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`Failed to list tools (${res.status})`);
  return res.json();
}

/**
 * Execute a single MCP tool via the backend unified endpoint.
 */
export interface ExecuteToolRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface ExecuteToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

export async function executeTool(request: ExecuteToolRequest): Promise<ExecuteToolResponse> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/mcp/execute-tool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    timeout: 120000,
  });
  if (!res.ok) throw new Error(`Failed to execute tool (${res.status})`);
  return res.json();
}

/**
 * Convert a SkillInfo into an Ollama ToolDefinition for use with ollamaChat.
 */
export function skillToToolDefinition(skill: SkillInfo): ToolDefinition {
  return {
    type: "function",
    function: {
      name: `skill_${skill.name}`,
      description: skill.description || `Skill: ${skill.name}`,
      parameters: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: `Which tool within the ${skill.name} skill to call. Available: ${skill.tools.join(", ")}`,
          },
          arguments: {
            type: "object",
            description: "Arguments for the tool. See the skill's SKILL.md for parameter details.",
          },
        },
        required: ["tool", "arguments"],
      },
    },
  };
}
