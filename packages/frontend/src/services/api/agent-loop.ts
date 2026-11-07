/**
 * Frontend agent loop for the Native Media AI Studio.
 *
 * Provides a ReAct-style agent that:
 * 1. Discovers skills from the backend /api/mcp/skills/list endpoint
 * 2. Converts skills into Ollama tool definitions
 * 3. Calls ollamaChat with the user's message + available tools
 * 4. Executes tool calls via the backend /api/mcp/execute-tool endpoint
 * 5. Feeds tool results back to ollamaChat
 * 6. Loops until the task is complete or max iterations are reached
 *
 * Usage:
 *   import { runAgentLoop } from "./services/api/agent-loop";
 *   const result = await runAgentLoop("Create a music video plan for track.mp3");
 */

import {
  ollamaChat,
  ollamaEngineStatus,
  getOllamaModels,
  getBestCodingModel,
  getBestBenchmarkModel,
  type ChatMessage,
  type ToolDefinition,
} from "./ollama";
import { skillsList, executeTool, type ExecuteToolResponse, type SkillInfo } from "./mcp-skills";
import { getAtomicChatStatus } from "./integrations";
import { getLoadedModels } from "./diagnostics";

export interface AgentTurn {
  type: "thought" | "tool_call" | "tool_result" | "final" | "error";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ExecuteToolResponse;
}

export interface AgentLoopOptions {
  model?: string;
  taskType?: "coding" | "vision" | "chat" | "default";
  maxIterations?: number;
  onTurn?: (turn: AgentTurn) => void;
  systemPrompt?: string;
}

/**
 * Strip outer markdown fences (```python, ```json, etc.) from model output.
 *
 * llama3.1:8b and similar models often wrap code in triple-backtick fences
 * despite system prompts forbidding them. Stripping these fences prevents
 * AST/JSON parsers from rejecting otherwise-valid output.
 * See LatentMD (Sep 2026) on markdown boundary failures in LLM-generated text.
 */
function stripMarkdownFences(content: string): string {
  const code = content.trim();
  if (code.startsWith("```")) {
    return code
      .replace(/^```(?:\w+)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  if (code.startsWith("~~~")) {
    return code
      .replace(/^~~~(?:\w+)?\s*/i, "")
      .replace(/\s*~~~$/, "")
      .trim();
  }
  return code;
}

// Cache for model selection results (TTL: 30 seconds) to avoid re-checking
// endpoints on every call.
let modelSelectionCache: { model: string; expiresAt: number } | null = null;
const MODEL_SELECTION_TTL_MS = 30_000;

/**
 * Automatically select the best model to use, preferring a model already
 * loaded in memory (resident) to avoid wasteful unload/load cycles.
 *
 * Selection order:
 *  1. If Ollama is online and has a resident model, reuse it (dynamic).
 *  2. If Atomic Chat is online and reports a model, reuse it (dynamic).
 *  3. If Ollama is online but nothing is loaded, pick the best installed
 *     model for the task type based on live benchmark scores (dynamic).
 *  4. If Atomic Chat is online but nothing is loaded, use its best model.
 *  5. Fall back to a sensible default.
 *
 * Results are cached for 30 seconds to avoid repeated endpoint checks.
 *
 * @param taskType - Task category: "coding", "vision", "chat", or "default"
 * @param preferred - Optional override model to use when nothing is resident.
 * @returns The model name to use.
 */
export async function selectModel(taskType = "default", preferred?: string): Promise<string> {
  // Return cached result if still valid
  const now = Date.now();
  if (modelSelectionCache && now < modelSelectionCache.expiresAt) {
    return modelSelectionCache.model;
  }

  const [ollamaStatus, atomicStatus, loadedModels, installedModels] = await Promise.allSettled([
    ollamaEngineStatus(),
    getAtomicChatStatus(),
    getLoadedModels(),
    getOllamaModels(false),
  ]);

  const installed: OllamaModel[] =
    installedModels.status === "fulfilled" ? installedModels.value : [];

  // 1. Reuse a resident Ollama model if one is loaded (dynamic)
  if (
    ollamaStatus.status === "fulfilled" &&
    ollamaStatus.value.online &&
    loadedModels.status === "fulfilled" &&
    loadedModels.value.loaded &&
    loadedModels.value.models.length > 0
  ) {
    const model = loadedModels.value.models[0].name;
    modelSelectionCache = { model, expiresAt: now + MODEL_SELECTION_TTL_MS };
    return model;
  }

  // 2. Reuse a resident Atomic Chat model if one is loaded (dynamic)
  if (
    atomicStatus.status === "fulfilled" &&
    atomicStatus.value.reachable &&
    atomicStatus.value.model
  ) {
    const model = atomicStatus.value.model;
    modelSelectionCache = { model, expiresAt: now + MODEL_SELECTION_TTL_MS };
    return model;
  }

  // Helper: check if a model is installed and available
  const isInstalled = (name: string): boolean =>
    installed.some((m) => m.name === name && m.is_available !== false);

  // 3. Ollama online but nothing loaded — pick best model for task (dynamic)
  if (ollamaStatus.status === "fulfilled" && ollamaStatus.value.online) {
    if (preferred && isInstalled(preferred)) {
      modelSelectionCache = {
        model: preferred,
        expiresAt: now + MODEL_SELECTION_TTL_MS,
      };
      return preferred;
    }

    try {
      switch (taskType) {
        case "coding": {
          // Use the best coding model from live benchmark results
          const best = await getBestCodingModel();
          if (best.best && isInstalled(best.best)) {
            modelSelectionCache = {
              model: best.best,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return best.best;
          }
          // Fall back to any installed coding-capable model
          const codingCandidates = installed.filter(
            (m) => m.supports_tools && m.is_available !== false,
          );
          if (codingCandidates.length > 0) {
            const model = codingCandidates[0].name;
            modelSelectionCache = {
              model,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return model;
          }
          break;
        }
        case "vision": {
          // Prefer verified vision-capable installed models
          const visionCandidates = installed.filter(
            (m) => m.supports_vision && m.is_available !== false && m.verified,
          );
          if (visionCandidates.length > 0) {
            const model = visionCandidates[0].name;
            modelSelectionCache = {
              model,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return model;
          }
          // Fall back to any vision-capable installed model
          const anyVision = installed.find((m) => m.supports_vision && m.is_available !== false);
          if (anyVision) {
            modelSelectionCache = {
              model: anyVision.name,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return anyVision.name;
          }
          break;
        }
        case "chat": {
          // Use the best benchmark model from live results
          const best = await getBestBenchmarkModel();
          if (best.best && isInstalled(best.best)) {
            modelSelectionCache = {
              model: best.best,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return best.best;
          }
          // Fall back to smallest tool-capable model for lightweight chat
          const chatCandidates = installed.filter(
            (m) => m.supports_tools && m.is_available !== false,
          );
          if (chatCandidates.length > 0) {
            const model = chatCandidates[0].name;
            modelSelectionCache = {
              model,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return model;
          }
          break;
        }
        default: {
          // Try coding benchmark best, then any installed tool-capable model
          const best = await getBestCodingModel();
          if (best.best && isInstalled(best.best)) {
            modelSelectionCache = {
              model: best.best,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return best.best;
          }
          const anyTool = installed.find((m) => m.supports_tools && m.is_available !== false);
          if (anyTool) {
            modelSelectionCache = {
              model: anyTool.name,
              expiresAt: now + MODEL_SELECTION_TTL_MS,
            };
            return anyTool.name;
          }
          break;
        }
      }
    } catch {
      // Benchmark endpoints may not be available — fall through to installed-model check
    }

    // Final fallback: first installed tool-capable model, or first installed model
    const fallback = installed.find((m) => m.is_available !== false);
    const model = fallback?.name ?? "llama3.1:8b";
    modelSelectionCache = { model, expiresAt: now + MODEL_SELECTION_TTL_MS };
    return model;
  }

  // 4. Atomic Chat online but nothing loaded — use its preferred model
  if (atomicStatus.status === "fulfilled" && atomicStatus.value.reachable) {
    const model = atomicStatus.value.model ?? "qwen3.5:4b";
    modelSelectionCache = { model, expiresAt: now + MODEL_SELECTION_TTL_MS };
    return model;
  }

  // 5. Fall back
  const fallback = preferred ?? "llama3.1:8b";
  modelSelectionCache = { model: fallback, expiresAt: now + MODEL_SELECTION_TTL_MS };
  return fallback;
}

/**
 * Clear the model selection cache. Call this when models are loaded/unloaded
 * so the next selection re-checks endpoint state.
 */
export function clearModelSelectionCache(): void {
  modelSelectionCache = null;
}

interface OllamaModel {
  name: string;
  size?: number;
  is_available?: boolean;
  capabilities?: string[];
  supports_tools?: boolean;
  supports_vision?: boolean;
  verified?: boolean;
}

export interface AgentLoopResult {
  success: boolean;
  finalResponse: string;
  turns: AgentTurn[];
  iterations: number;
}

/**
 * Execute a single tool via the backend /api/mcp/execute-tool endpoint.
 */
async function executeToolByName(
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<ExecuteToolResponse> {
  return executeTool({ tool_name: toolName, arguments: toolArgs });  
}

/**
 * Convert skills to Ollama ToolDefinitions. Each skill becomes one tool that
 * accepts a "tool" (which sub-tool within the skill) and "arguments" object.
 * This keeps the tool set small while giving the model access to all 19 tools.
 */
function skillsToToolDefinitions(skills: SkillInfo[]): ToolDefinition[] {
  return skills.map((skill) => ({
    type: "function",
    function: {
      name: `skill_${skill.name}`,
      description:
        skill.description || `Skill: ${skill.name}. Available tools: ${skill.tools.join(", ")}`,
      parameters: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: `Which tool to call within the ${skill.name} skill. Available: ${skill.tools.join(
              ", ",
            )}`,
          },
          arguments: {
            type: "object",
            description:
              "Arguments for the tool. Parameter names and types depend on the specific tool. See the skill's SKILL.md for details.",
          },
        },
        required: ["tool", "arguments"],
        additionalProperties: false,
      },
    },
  }));
}

/**
 * Run the agent loop.
 *
 * @param userMessage - The user's natural-language request
 * @param options - Optional configuration (model, max iterations, callbacks)
 */
export async function runAgentLoop(
  userMessage: string,
  options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
  const {
    model: modelOption,
    taskType = "default",
    maxIterations = 10,
    onTurn,
    systemPrompt,
  } = options;

  const model = modelOption ?? (await selectModel(taskType, modelOption));

  const turns: AgentTurn[] = [];

  const emitTurn = (turn: AgentTurn) => {
    turns.push(turn);
    onTurn?.(turn);
  };

  // Step 1: Discover skills from the backend
  emitTurn({
    type: "thought",
    content: "Discovering available skills from the backend...",
  });

  let skills: SkillInfo[];
  try {
    skills = await skillsList();
    emitTurn({
      type: "thought",
      content: `Found ${skills.length} skills with ${skills.reduce(
        (sum, s) => sum + s.tools.length,
        0,
      )} total tools.`,
    });
  } catch (err) {
    emitTurn({
      type: "error",
      content: `Failed to discover skills: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      success: false,
      finalResponse: `Failed to discover skills: ${err instanceof Error ? err.message : String(err)}`,
      turns,
      iterations: 0,
    };
  }

  const toolDefs = skillsToToolDefinitions(skills);

  // Build the system prompt that instructs the model how to use tools
  const defaultSystemPrompt = `You are an AI agent for the Native Media AI Studio. You help users create music videos, analyze audio, generate images and video, plan 3D scenes, and manage remixes.

You have access to tools organized into skills. Each skill groups related tools. When you want to use a tool, call the skill function with:
- "tool": the specific tool name within the skill
- "arguments": the tool's arguments as a JSON object

Available skills and their tools:
${skills.map((s) => `- ${s.name}: ${s.tools.join(", ")}`).join("\n")}

Guidelines:
- Always prefer using a tool over guessing when the user asks for something concrete.
- If a tool requires a filename, first list available files using the appropriate list tool.
- After each tool result, assess whether the task is complete or if more tools are needed.
- When you have enough information to answer, provide your final response.
- Be concise and focus on what the user asked for.

The current user request is: "${userMessage}"`;

  const systemPromptFinal = systemPrompt || defaultSystemPrompt;

  // Build conversation history
  const messages: ChatMessage[] = [
    { role: "system", content: systemPromptFinal },
    { role: "user", content: userMessage },
  ];

  // Step 2-6: ReAct loop
  let iteration = 0;
  let finalResponse = "";

  while (iteration < maxIterations) {
    iteration++;

    emitTurn({
      type: "thought",
      content: `Iteration ${iteration}/${maxIterations}: Calling Ollama with available tools...`,
    });

    try {
      const response = await ollamaChat(userMessage, model, {
        history: messages,
        tools: toolDefs,
        think: false,
        maxToolCalls: 5,
      });

      // Check if the model made tool calls (toolDetails contains the actual calls)
      // Backend returns snake_case "tool_details"; frontend type uses camelCase.
      // res.json() is untyped, so accept both shapes.
      const rawResponse = response as {
        tool_details?: { name: string; arguments: Record<string, unknown>; result: string }[];
        toolDetails?: { name: string; arguments: Record<string, unknown>; result: string }[];
      };
      const toolDetails = rawResponse.tool_details ?? rawResponse.toolDetails ?? [];
      if (toolDetails.length > 0) {
        // Add the assistant's tool-calling message to history
        messages.push({
          role: "assistant",
          content: stripMarkdownFences(response.response) || "I'll use tools to help with that.",
          tool_calls: toolDetails.map((tc) => ({
            name: tc.name,
            arguments: tc.arguments,
          })),
        });

        // Execute each tool call
        for (const toolCall of toolDetails) {
          const toolName = toolCall.name;
          const toolArgs: Record<string, unknown> = toolCall.arguments || {};

          emitTurn({
            type: "tool_call",
            content: `Calling ${toolName}...`,
            toolName,
            toolArgs,
          });

          // Map skill_* tool names to actual tool names
          // The tool name from ollama is like "skill_audio" but we need the actual tool name
          // from the arguments. The model should put the actual tool name in arguments.tool.
          const actualToolName = (toolArgs.tool as string) || toolName.replace(/^skill_/, "");

          let result: ExecuteToolResponse;
          try {
            result = await executeToolByName(actualToolName, toolArgs);
          } catch (err) {
            result = {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }

          emitTurn({
            type: "tool_result",
            content: result.success
              ? `Tool ${actualToolName} completed successfully.`
              : `Tool ${actualToolName} failed: ${result.error}`,
            toolName: actualToolName,
            toolResult: result,
          });

          // Add tool result to conversation
          messages.push({
            role: "tool",
            content: JSON.stringify(result),
            tool_name: actualToolName,
          });
        }

        // Continue the loop to let the model process results
        continue;
      }

      // No tool calls - this is the final response
      finalResponse =
        stripMarkdownFences(response.response) || "I'm not sure how to help with that.";
      emitTurn({
        type: "final",
        content: finalResponse,
      });

      // Add final assistant message to history
      messages.push({ role: "assistant", content: finalResponse });

      return {
        success: true,
        finalResponse,
        turns,
        iterations: iteration,
      };
    } catch (err) {
      emitTurn({
        type: "error",
        content: `Ollama call failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return {
        success: false,
        finalResponse: `Agent loop failed: ${err instanceof Error ? err.message : String(err)}`,
        turns,
        iterations: iteration,
      };
    }
  }

  // Max iterations reached
  emitTurn({
    type: "error",
    content: `Agent loop reached maximum iterations (${maxIterations}) without completing.`,
  });
  return {
    success: false,
    finalResponse:
      finalResponse || "I reached the maximum number of iterations without completing the task.",
    turns,
    iterations: iteration,
  };
}

/**
 * Convenience wrapper: run the agent loop and return just the final text.
 */
export async function runAgentTask(
  userMessage: string,
  options?: AgentLoopOptions,
): Promise<string> {
  const result = await runAgentLoop(userMessage, options);
  return result.finalResponse;
}
