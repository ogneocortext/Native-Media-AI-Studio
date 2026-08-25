export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const DEFAULT_TOOLS: Tool[] = [
  {
    id: "get_project_structure",
    name: "get_project_structure",
    description: "Get the project directory structure",
    parameters: {
      type: "object",
      properties: {
        depth: { type: "number", description: "Directory depth to traverse (default: 3)" },
      },
      required: [],
    },
  },
  {
    id: "search_docs",
    name: "search_docs",
    description: "Search the project documentation for relevant information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Maximum number of results (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    id: "get_system_health",
    name: "get_system_health",
    description: "Get current system health status including CPU, memory, GPU, and VRAM usage",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    id: "list_jobs",
    name: "list_jobs",
    description: "List jobs in the queue, optionally filtered by status",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: queued, running, completed, failed" },
      },
      required: [],
    },
  },
  {
    id: "get_job_status",
    name: "get_job_status",
    description: "Get the status of a specific job by its ID",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The job ID to check" },
      },
      required: ["job_id"],
    },
  },
  {
    id: "generate_visualization",
    name: "generate_visualization",
    description: "Generate a dynamic visualization with specified style, colors, and intensity",
    parameters: {
      type: "object",
      properties: {
        style: { type: "string", description: "Visualization style: particles, waveform, or pulse" },
        color_scheme: { type: "string", description: "Color scheme: neon, fire, ocean, forest, sunset, monochrome" },
        intensity: { type: "number", description: "Visualization intensity from 0.0 to 1.0" },
        bpm: { type: "integer", description: "Beats per minute for rhythm sync" },
      },
      required: [],
    },
  },
];

export interface HistoryEntry {
  prompt: string;
  response: string;
  model: string;
  toolCalls?: number;
  timestamp: Date;
}
