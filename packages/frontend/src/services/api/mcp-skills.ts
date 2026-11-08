/**
 * MCP Skills API client for the Native Media AI Studio frontend agent.
 *
 * Exposes the skills served by the backend /api/mcp/skills/* endpoints so a
 * frontend agent can discover, read, and use skills for tool-calling.
 */

import { getApiBase } from "./core";
import { getJson, postJson } from "./typed-fetch";
import type {
  SkillInfo,
  SkillContent,
  ToolInfo,
  ExecuteToolRequest,
  ExecuteToolResponse,
} from "./types";

const BASE = "/api/mcp";

/**
 * List all available skills with their frontmatter metadata.
 */
export async function skillsList(): Promise<SkillInfo[]> {
  return getJson<SkillInfo[]>(`${BASE}/skills/list`, { timeout: 15000 });
}

/**
 * Get a skill's full content by URI (e.g. skill://vision/SKILL.md).
 */
export async function skillsGet(uri: string): Promise<SkillContent> {
  return getJson<SkillContent>(`${BASE}/skills/get?uri=${encodeURIComponent(uri)}`, { timeout: 15000 });
}

/**
 * Read a skill file as plain text (SKILL.md, references/GUIDE.md, etc.).
 */
export async function skillsReadFile(uri: string): Promise<string> {
  const base = getApiBase();
  const response = await fetch(`${base}${uri.startsWith("/") ? uri : "/" + uri}`);
  if (!response.ok) throw new Error(`Failed to read skill file (${response.status})`);
  return response.text();
}

/**
 * List all available tools with their descriptions.
 */
export async function toolsList(): Promise<ToolInfo[]> {
  return getJson<ToolInfo[]>(`${BASE}/tools`, { timeout: 15000 });
}

/**
 * Execute a single MCP tool via the backend unified endpoint.
 * Long-running (up to 2 minutes).
 */
export async function executeTool(request: ExecuteToolRequest): Promise<ExecuteToolResponse> {
  return postJson<ExecuteToolResponse>(`${BASE}/execute-tool`, request, { timeout: 120000 });
}

/**
 * Convert a SkillInfo into an Ollama ToolDefinition for use with ollamaChat.
 */
export function skillToToolDefinition(skill: SkillInfo): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: {
        tool: { type: "string"; description: string };
        arguments: { type: "object"; description: string };
      };
      required: ["tool", "arguments"];
    };
  };
} {
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

export type * from "./types";
