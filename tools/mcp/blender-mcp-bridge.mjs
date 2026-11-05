#!/usr/bin/env node
/**
 * Blender MCP Bridge
 *
 * Wraps the Blender MCP addon (tools/blender_mcp_addon.py) as a local MCP
 * server. The addon runs inside Blender and listens on a raw TCP socket
 * (default localhost:9876). This bridge translates MCP tool calls into the
 * addon's JSON command protocol so the studio can drive Blender without
 * importing bpy in the backend.
 *
 * Wire protocol (addon side):
 *   Client sends:  {"type": "<command>", "params": {...}}
 *   Server replies: {"status": "success"|"error", "result"/"message": ...}
 *
 * Commands map 1:1 to BlenderAdapter's execute() command names. Commands
 * without a native addon handler are translated to `execute_code` (arbitrary
 * bpy) scripts.
 *
 * Dependency direction: this bridge imports only stdlib + the MCP SDK +
 * shared helpers. It never imports from app.api or app.services.
 */
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import { createConnection } from "net";
import path from "path";
import { fileURLToPath } from "url";
import { validateMcpToolCall, logRequest, generateRequestId, textResponse, MCPLifecycle, setupGracefulShutdown, BoundedCache } from "./_mcp_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 9876;
let BLENDER_HOST = process.env.BLENDER_MCP_HOST || DEFAULT_HOST;
let BLENDER_PORT = Number.parseInt(process.env.BLENDER_MCP_PORT || String(DEFAULT_PORT), 10);
if (!Number.isFinite(BLENDER_PORT) || BLENDER_PORT <= 0) { BLENDER_PORT = DEFAULT_PORT; }

// ---------------------------------------------------------------------------
// TCP socket client for the Blender MCP addon
// ---------------------------------------------------------------------------
function blenderRequest(type, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (settled) return; settled = true; reject(new Error("Blender request timed out after " + timeoutMs + "ms")); }, timeoutMs);
    const onSettled = (ok, value) => { if (settled) return; settled = true; clearTimeout(timer); if (ok) resolve(value); else reject(value); };
    const socket = createConnection({ host: BLENDER_HOST, port: BLENDER_PORT }, () => {
      socket.write(JSON.stringify({ type, params: params || {} }));
    });
    socket.setEncoding("utf-8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      try { const parsed = JSON.parse(buffer); onSettled(true, parsed); socket.end(); } catch { /* incomplete */ }
    });
    socket.on("error", (err) => onSettled(false, err));
    socket.on("end", () => { if (!settled) onSettled(false, new Error("Blender closed the connection without a response")); });
  });
}
async function isBlenderReachable() {
  try { const res = await blenderRequest("ping", {}, 5000); return res && res.status === "success"; } catch { return false; }
}
// generateRequestId and textResponse are imported from _mcp_shared.mjs
function bpyString(value) { return JSON.stringify(String(value)); }
function bpyNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function buildExecuteCode(command, parameters) {
  const p = parameters || {};
  const lines = ["import bpy", "result = {\"ok\": false}"];
  const emit = (code) => lines.push(code);
  switch (command) {
    case "load_scene": {
      const path_ = bpyString(p.path);
      emit("try:"); emit("    bpy.ops.wm.open_mainfile(filepath=" + path_ + ")");
      emit("    result = {\"ok\": True, \"command\": \"load_scene\", \"path\": " + path_ + "}");
      emit("except Exception as e:"); emit("    result = {\"ok\": False, \"command\": \"load_scene\", \"error\": str(e)}");
      break;
    }
    case "render_scene": {
      if (p.output) emit("bpy.context.scene.render.filepath = " + bpyString(p.output));
      if (p.frame_start !== undefined) emit("bpy.context.scene.frame_start = " + bpyNumber(p.frame_start));
      if (p.frame_end !== undefined) emit("bpy.context.scene.frame_end = " + bpyNumber(p.frame_end));
      if (p.engine) emit("bpy.context.scene.render.engine = " + bpyString(p.engine));
      if (p.samples !== undefined) emit("bpy.context.scene.cycles.samples = " + bpyNumber(p.samples));
      emit("try:"); emit("    bpy.ops.render.render(animation=True)");
      emit("    result = {\"ok\": True, \"command\": \"render_scene\", \"output\": " + bpyString(p.output || "") + "}");
      emit("except Exception as e:"); emit("    result = {\"ok\": False, \"command\": \"render_scene\", \"error\": str(e)}");
      break;
    }
    case "create_material": {
      emit("name = " + bpyString(p.name || "Material")); emit("mat = bpy.data.materials.new(name=name)"); emit("mat.use_nodes = True");
      if (p.color) { emit("try:"); emit('    nodes = mat.node_tree.nodes'); emit('    bsdf = nodes.get("Principled BSDF")'); emit("    if bsdf:"); emit("        bsdf.inputs[0].default_value = " + bpyString(p.color)); emit("except Exception:"); emit("    pass"); }
      if (p.roughness !== undefined) { emit("try:"); emit("    bsdf = bpy.data.materials[name].node_tree.nodes.get(\"Principled BSDF\")"); emit("    if bsdf: bsdf.inputs[9].default_value = " + bpyNumber(p.roughness)); emit("except Exception:"); emit("    pass"); }
      if (p.metallic !== undefined) { emit("try:"); emit("    bsdf = bpy.data.materials[name].node_tree.nodes.get(\"Principled BSDF\")"); emit("    if bsdf: bsdf.inputs[6].default_value = " + bpyNumber(p.metallic)); emit("except Exception:"); emit("    pass"); }
      emit("result = {\"ok\": True, \"command\": \"create_material\", \"name\": " + bpyString(p.name || "Material") + "}"); break;
    }
    case "set_material": {
      emit("obj = bpy.data.objects.get(" + bpyString(p.object) + ")"); emit("mat = bpy.data.materials.get(" + bpyString(p.material) + ")");
      emit("if obj and mat:"); emit("    if len(obj.data.materials) == 0:"); emit("        obj.data.materials.append(mat)"); emit("    else:"); emit("        obj.data.materials[0] = mat");
      emit("    result = {\"ok\": True, \"command\": \"set_material\", \"object\": " + bpyString(p.object || "") + ", \"material\": " + bpyString(p.material || "") + "}");
      emit("else:"); emit("    result = {\"ok\": False, \"command\": \"set_material\", \"error\": \"object or material not found\"}"); break;
    }
    case "animate_object": {
      emit("obj = bpy.data.objects.get(" + bpyString(p.object) + ")"); emit("if obj:"); emit("    try:");
      emit("        obj.keyframe_insert(data_path=" + bpyString(p.property_path) + ", frame=" + bpyNumber(p.frame) + ")");
      emit("        result = {\"ok\": True, \"command\": \"animate_object\", \"frame\": " + bpyNumber(p.frame) + "}");
      emit("    except Exception as e:"); emit("        result = {\"ok\": False, \"command\": \"animate_object\", \"error\": str(e)}");
      emit("else:"); emit("    result = {\"ok\": False, \"command\": \"animate_object\", \"error\": \"object not found\"}"); break;
    }
    case "create_scene": {
      emit("name = " + bpyString(p.path || "untitled")); emit("scene = bpy.data.scenes.new(name=name)"); emit("bpy.context.window.scene = scene");
      emit("result = {\"ok\": True, \"command\": \"create_scene\", \"path\": " + bpyString(p.path || "untitled") + "}"); break;
    }
    case "create_gameobject": {
      emit("primitive = " + bpyString(p.primitive || "cube")); emit("name = " + bpyString(p.name || "GameObject")); emit("try:");
      emit('    if primitive == "cube": bpy.ops.mesh.primitive_cube_add()');
      emit('    elif primitive == "sphere": bpy.ops.mesh.primitive_uv_sphere_add()');
      emit('    elif primitive == "capsule": bpy.ops.mesh.primitive_capsule_add()');
      emit('    elif primitive == "cylinder": bpy.ops.mesh.primitive_cylinder_add()');
      emit('    elif primitive == "plane": bpy.ops.mesh.primitive_plane_add()');
      emit('    elif primitive == "quad": bpy.ops.mesh.primitive_quad_add()');
      emit("    else: bpy.ops.mesh.primitive_cube_add()");
      emit("    obj = bpy.context.active_object"); emit("    obj.name = name");
      emit("    result = {\"ok\": True, \"command\": \"create_gameobject\", \"name\": " + bpyString(p.name || "GameObject") + ", \"primitive\": " + bpyString(p.primitive || "cube") + "}");
      emit("except Exception as e:"); emit("    result = {\"ok\": False, \"command\": \"create_gameobject\", \"error\": str(e)}"); break;
    }
    case "add_component": {
      emit("obj = bpy.data.objects.get(" + bpyString(p.target) + ")"); emit("if obj:");
      emit("    result = {\"ok\": True, \"command\": \"add_component\", \"target\": " + bpyString(p.target || "") + ", \"component\": " + bpyString(p.type || "") + ", \"note\": \"components map to Blender modifiers/constraints via execute_code\"}");
      emit("else:"); emit("    result = {\"ok\": False, \"command\": \"add_component\", \"error\": \"object not found\"}"); break;
    }
    case "capture_scene_view": {
      emit("path = " + bpyString(p.save_path || "/tmp/blender_capture.png")); emit("try:"); emit("    bpy.ops.wm.save_mainfile(filepath=path)");
      emit("    result = {\"ok\": True, \"command\": \"capture_scene_view\", \"path\": " + bpyString(p.save_path || "/tmp/blender_capture.png") + "}"); emit("except Exception as e:"); emit("    result = {\"ok\": False, \"command\": \"capture_scene_view\", \"error\": str(e)}"); break;
    }
    case "create_animation_clip": {
      emit("path = " + bpyString(p.path || "/tmp/animation.blend")); emit("fps = " + bpyNumber(p.frameRate || 24));
      emit("bpy.context.scene.render.fps = fps"); emit("bpy.ops.wm.save_mainfile(filepath=path)");
      emit("result = {\"ok\": True, \"command\": \"create_animation_clip\", \"path\": " + bpyString(p.path || "/tmp/animation.blend") + "}"); break;
    }
    default: { throw new Error("Unknown Blender command: " + command); }
  }
  lines.push("return result");
  return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Tool definitions (JSON schemas exposed to MCP clients)
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: "list_pipeline_commands",
    description: "List all Blender pipeline commands available from the bridge.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "blender_status",
    description: "Check whether Blender with the MCP addon is reachable.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "load_scene",
    description: "Load a Blender .blend file.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    },
  },
  {
    name: "render_scene",
    description: "Render a Blender scene (animation).",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        output: { type: "string" },
        frame_start: { type: "number" },
        frame_end: { type: "number" },
        engine: { type: "string" },
        samples: { type: "number" },
      },
    },
  },
  {
    name: "create_material",
    description: "Create a Blender material.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        color: { type: "string" },
        roughness: { type: "number" },
        metallic: { type: "number" },
      },
    },
  },
  {
    name: "set_material",
    description: "Assign a material to a Blender object.",
    inputSchema: {
      type: "object",
      required: ["object", "material"],
      properties: {
        object: { type: "string" },
        material: { type: "string" },
      },
    },
  },
  {
    name: "animate_object",
    description: "Set an animation keyframe on a Blender object property.",
    inputSchema: {
      type: "object",
      required: ["object", "property_path", "frame", "value"],
      properties: {
        object: { type: "string" },
        property_path: { type: "string" },
        frame: { type: "number" },
        value: { type: "number" },
      },
    },
  },
  {
    name: "get_scene_info",
    description: "Get information about the current Blender scene.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_object_info",
    description: "Get information about a Blender object.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "get_viewport_screenshot",
    description: "Capture a screenshot of the Blender 3D viewport.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "execute_code",
    description: "Run arbitrary bpy Python code inside Blender.",
    inputSchema: {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string" } },
    },
  },
  {
    name: "blender_command",
    description: "Execute an arbitrary Blender pipeline command (escape hatch).",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
        parameters: { type: "object" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeBlenderTool(name, args) {
  const reqId = generateRequestId();

  if (name === "list_pipeline_commands") {
    logRequest(reqId, name, "");
    const commands = TOOL_DEFS.filter(function (t) { return t.name !== "list_pipeline_commands"; }).map(function (t) {
      return { name: t.name, description: t.description };
    });
    return textResponse(JSON.stringify({ commands: commands }, null, 2));
  }

  if (name === "blender_status") {
    logRequest(reqId, name, "");
    const reachable = await isBlenderReachable();
    return textResponse(
      JSON.stringify(
        {
          online: reachable,
          host: BLENDER_HOST,
          port: BLENDER_PORT,
          addon: "blender-mcp",
          protocol: "tcp-json",
        },
        null,
        2
      ),
      !reachable
    );
  }

  const reachable = await isBlenderReachable();
  if (!reachable) {
    logRequest(reqId, name, "blender-unreachable");
    return textResponse(
      "Blender MCP addon is not reachable at " + BLENDER_HOST + ":" + BLENDER_PORT + ". " +
        "Open Blender, install/enable tools/blender_mcp_addon.py, and start the BlenderMCP server.",
      true
    );
  }

  if (name === "execute_code") {
    logRequest(reqId, name, "code_len=" + (args.code || "").length);
    const res = await blenderRequest("execute_code", { code: args.code }, 120000);
    return textResponse(JSON.stringify(res, null, 2), res.status === "error");
  }

  if (name === "get_scene_info") {
    logRequest(reqId, name, "");
    const res = await blenderRequest("get_scene_info", {}, 30000);
    return textResponse(JSON.stringify(res, null, 2), res.status === "error");
  }

  if (name === "get_object_info") {
    logRequest(reqId, name, "name=" + args.name);
    const res = await blenderRequest("get_object_info", { name: args.name || "" }, 30000);
    return textResponse(JSON.stringify(res, null, 2), res.status === "error");
  }

  if (name === "get_viewport_screenshot") {
    logRequest(reqId, name, "");
    const res = await blenderRequest("get_viewport_screenshot", {}, 60000);
    return textResponse(JSON.stringify(res, null, 2), res.status === "error");
  }

  if (name === "blender_command") {
    const command = args.command;
    logRequest(reqId, name, "command=" + command);
    if (!command) {
      return textResponse("Missing required arg: command", true);
    }
    const translateable = [
      "load_scene", "render_scene", "create_material", "set_material",
      "animate_object", "create_scene", "create_gameobject", "add_component",
      "capture_scene_view", "create_animation_clip",
    ];
    if (translateable.indexOf(command) !== -1) {
      let code;
      try {
        code = buildExecuteCode(command, args.parameters || {});
      } catch (e) {
        return textResponse("Failed to build Blender script: " + e.message, true);
      }
      const res = await blenderRequest("execute_code", { code: code }, 120000);
      return textResponse(JSON.stringify(res, null, 2), res.status === "error");
    }
    const res = await blenderRequest(command, args.parameters || {}, 60000);
    return textResponse(JSON.stringify(res, null, 2), res.status === "error");
  }

  const convenience = [
    "load_scene", "render_scene", "create_material", "set_material",
    "animate_object", "create_scene", "create_gameobject", "add_component",
    "capture_scene_view", "create_animation_clip",
  ];
  if (convenience.indexOf(name) !== -1) {
    let code;
    try {
      code = buildExecuteCode(name, args || {});
    } catch (e) {
      return textResponse("Failed to build Blender script: " + e.message, true);
    }
    const res = await blenderRequest("execute_code", { code: code }, 120000);
    return textResponse(JSON.stringify(res, null, 2), res.status === "error");
  }

  logRequest(reqId, "tools/call", "unknown-tool " + name);
  return textResponse(
    "Unknown tool " + name + ". Available tools: " + TOOL_DEFS.map(function (t) { return t.name; }).join(", "),
    true
  );
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "blender-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Lifecycle management
const lifecycle = new MCPLifecycle();
setupGracefulShutdown(server, lifecycle);
lifecycle.markReady();

server.setRequestHandler("tools/list", async function () {
  return {
    tools: TOOL_DEFS.map(function (t) {
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      };
    }),
  };
});

server.setRequestHandler("tools/call", async function (request) {
  const params = request.params || {};
  const name = params.name;
  const args = params.arguments || {};
  const validatedArgs = await validateMcpToolCall(name, args);
  const effectiveArgs = validatedArgs !== null ? validatedArgs : args;
  try {
    const result = await executeBlenderTool(name, effectiveArgs);
    return result;
  } catch (e) {
    console.error("[blender-mcp] tool error: " + e.message);
    return textResponse("Blender error: " + e.message, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Blender MCP Bridge ready v1.0.0");
console.error("  Blender addon endpoint: " + BLENDER_HOST + ":" + BLENDER_PORT);
console.error("  Tools: " + TOOL_DEFS.map(function (t) { return t.name; }).join(", "));
console.error("  Lifecycle: " + lifecycle.state);
