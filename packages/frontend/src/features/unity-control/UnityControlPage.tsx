import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
  Play,
  Square,
  Camera,
  Terminal,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card } from "../../components/common";
import {
  getUnityStatus,
  listUnityCommands,
  sendUnityCommand,
  listUnityShaders,
  getUnityShaderProperties,
  getUnityMaterialProperties,
  setUnityMaterialProperties,
  type UnityCommandResult,
  type UnityCommandInfo,
} from "../../services/api";
import { showToast } from "../../utils/toast";

type StatusState = "loading" | "online" | "offline";

/** Map backend status codes (e.g. "port_file_missing") to actionable text. */
function friendlyStatusError(code?: string): string {
  switch (code) {
    case undefined:
    case "":
      return "Unity Pipeline server not reachable";
    case "port_file_missing":
      return "Unity runtime not reachable — start the Unity project once (the editor GUI is not required after startup)";
    case "unreachable":
      return "Unity Pipeline server not reachable";
    default:
      return code.startsWith("http_")
        ? `Unity Pipeline returned HTTP ${code.slice(5)}`
        : code;
  }
}

export function UnityControlPage() {
  const [statusState, setStatusState] = useState<StatusState>("loading");
  const [statusDetail, setStatusDetail] = useState<unknown>(null);
  const [statusError, setStatusError] = useState("");
  const [lastChecked, setLastChecked] = useState("");
  const [commands, setCommands] = useState<UnityCommandInfo[]>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [commandsError, setCommandsError] = useState("");
  const [commandHistory, setCommandHistory] = useState<
    Array<{ id: string; time: string; command: string; result: UnityCommandResult }>
  >([]);
  const [activeTab, setActiveTab] = useState<"quick" | "custom" | "history">("quick");
  const [customCommand, setCustomCommand] = useState("");
  const [customParams, setCustomParams] = useState("{}");
  const [running, setRunning] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  // Quick action form state
  const [objectName, setObjectName] = useState("NewObject");
  const [primitive, setPrimitive] = useState("cube");
  const [visTarget, setVisTarget] = useState("");
  const [componentTarget, setComponentTarget] = useState("");
  const [componentType, setComponentType] = useState("");
  const [animClip, setAnimClip] = useState("");
  const [animTarget, setAnimTarget] = useState("");

  // Shader / Material state
  const [shaderList, setShaderList] = useState<string[]>([]);
  const [selectedShader, setSelectedShader] = useState("");
  const [shaderPropsTarget, setShaderPropsTarget] = useState("");
  const [materialTarget, setMaterialTarget] = useState("");
  const [materialName, setMaterialName] = useState("");
  const [materialPropertyKey, setMaterialPropertyKey] = useState("");
  const [materialPropertyValue, setMaterialPropertyValue] = useState("");
  const [shaderMaterialOutput, setShaderMaterialOutput] = useState<unknown>(null);

  const statusInFlight = useRef(false);
  const runningRef = useRef(false);
  const historySeq = useRef(0);

  const refreshStatus = useCallback(async (showLoader = false) => {
    // Skip overlapping polls (interval === request timeout) and background
    // polls while the tab is hidden — a hidden-page backlog would otherwise
    // stack requests on return to the tab.
    if (statusInFlight.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    statusInFlight.current = true;
    if (showLoader) setStatusState("loading");
    try {
      const result = await getUnityStatus();
      if (result.online) {
        setStatusState("online");
        setStatusDetail(result.status);
        setStatusError("");
      } else {
        setStatusState("offline");
        setStatusError(friendlyStatusError(result.error));
      }
    } catch (e) {
      setStatusState("offline");
      setStatusError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      statusInFlight.current = false;
      setLastChecked(new Date().toLocaleTimeString());
    }
  }, []);

  const loadCommands = useCallback(async () => {
    try {
      const data = await listUnityCommands();
      setCommands(data);
      setCommandsLoaded(true);
      setCommandsError("");
    } catch (e) {
      // Surface load failures so the Custom tab can offer a retry.
      setCommandsError(e instanceof Error ? e.message : "Failed to load Unity commands");
    }
  }, []);

  useEffect(() => {
    refreshStatus(true);
    loadCommands();
    const interval = setInterval(() => {
      refreshStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [refreshStatus, loadCommands]);

  const execute = useCallback(
    async (
      command: string,
      parameters: Record<string, unknown> = {},
    ): Promise<UnityCommandResult | null> => {
      // Re-entrancy guard: Enter can fire while a command is in flight.
      if (runningRef.current) return null;
      runningRef.current = true;
      setRunning(true);
      const time = new Date().toLocaleTimeString();
      const record = (result: UnityCommandResult): UnityCommandResult => {
        setCommandHistory((prev) => {
          const entry = { id: `hist-${++historySeq.current}`, time, command, result };
          return [entry, ...prev].slice(0, 100);
        });
        return result;
      };
      try {
        const raw = await sendUnityCommand(command, parameters);
        const result: UnityCommandResult = raw.ok
          ? raw
          : { ...raw, error: raw.error || "Unknown error" };
        record(result);
        if (result.ok) {
          showToast(`Command "${command}" succeeded`, "success");
        } else {
          showToast(`Command "${command}" failed: ${result.error}`, "warning");
        }
        return result;
      } catch (e) {
        // Network / timeout failures previously escaped as unhandled rejections.
        const message = e instanceof Error ? e.message : "Network error";
        record({ ok: false, error: message });
        showToast(`Command "${command}" failed: ${message}`, "warning");
        return { ok: false, error: message };
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [],
  );

  const handleQuickCreate = async () => {
    await execute("create_gameobject", {
      name: objectName || undefined,
      primitive: primitive || undefined,
    });
  };

  const handleQuickShow = async () => {
    if (!visTarget) {
      showToast("Enter a GameObject name first", "warning");
      return;
    }
    await execute("set_object_visibility", { object_name: visTarget, visible: true });
  };

  const handleQuickHide = async () => {
    if (!visTarget) {
      showToast("Enter a GameObject name first", "warning");
      return;
    }
    await execute("set_object_visibility", { object_name: visTarget, visible: false });
  };

  const handleQuickAddComponent = async () => {
    if (!componentTarget || !componentType) {
      showToast("Target name and component type are required", "warning");
      return;
    }
    await execute("add_component", { target: componentTarget, type: componentType });
  };

  const handleQuickPlayAnim = async () => {
    if (!animTarget || !animClip) {
      showToast("Target object and clip name are required", "warning");
      return;
    }
    await execute("play_animation", {
      object_name: animTarget,
      clip_name: animClip,
      speed: 1,
      wrap_mode: "once",
    });
  };

  const handleQuickStopAnim = async () => {
    if (!animTarget) {
      showToast("Target object name is required", "warning");
      return;
    }
    await execute("stop_animation", { object_name: animTarget, return_to_bind_pose: true });
  };

  const handleListShaders = async () => {
    const result = await listUnityShaders();
    if (result?.ok) {
      const payload = result.data as
        | { success?: boolean; result?: Array<{ name?: string }> }
        | undefined;
      const names = (payload?.result ?? [])
        .map((item) => item.name)
        .filter((name): name is string => typeof name === "string");
      setShaderList(names);
      if (names.length) {
        showToast(`Loaded ${names.length} shaders`, "success");
      } else {
        showToast("No shaders returned", "warning");
      }
    }
  };

  const handleGetShaderProperties = async () => {
    if (!selectedShader) {
      showToast("Select a shader first", "warning");
      return;
    }
    const result = await getUnityShaderProperties({ shader: selectedShader });
    if (result?.ok) {
      setShaderMaterialOutput(result.data);
    }
  };

  const handleGetMaterialProperties = async () => {
    if (!materialTarget) {
      showToast("Target object name is required", "warning");
      return;
    }
    const result = await getUnityMaterialProperties({
      object_name: materialTarget,
      material_name: materialName || undefined,
    });
    if (result?.ok) {
      setShaderMaterialOutput(result.data);
    }
  };

  const handleSetMaterialProperty = async () => {
    if (!materialTarget || !materialPropertyKey || materialPropertyValue === "") {
      showToast("Target, property key, and value are required", "warning");
      return;
    }
    let value: unknown = materialPropertyValue;
    try {
      value = JSON.parse(materialPropertyValue);
    } catch {
      // keep as string when it isn't valid JSON
    }
    const result = await setUnityMaterialProperties({
      object_name: materialTarget,
      material_name: materialName || undefined,
      properties: { [materialPropertyKey]: value },
    });
    if (result?.ok) {
      setShaderMaterialOutput(result.data);
    }
  };

  const handleCustomCommand = async () => {
    if (running || !customCommand.trim()) return;
    let params: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(customParams || "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        showToast("Parameters must be a JSON object", "warning");
        return;
      }
      params = parsed as Record<string, unknown>;
    } catch {
      showToast("Invalid JSON parameters", "warning");
      return;
    }
    await execute(customCommand.trim(), params);
  };

  const handleCapture = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const result = await execute("capture_game_view", {
        source: "camera",
        width: 960,
        height: 540,
        save_path: "output/unity_control_preview.png",
        include_inline_image: true,
      });
      const payload = (result?.data as { result?: { base64?: string; width?: number; height?: number; savedPath?: string } } | undefined)?.result;
      setPreviewDataUrl(payload?.base64 ? `data:image/png;base64,${payload.base64}` : null);
      const dims = payload?.width && payload?.height ? ` (${payload.width}×${payload.height})` : "";
      showToast(
        payload?.savedPath ? `Scene captured${dims}: ${payload.savedPath}` : `Scene captured${dims}`,
        "success",
      );
    } catch (e) {
      showToast(`Capture failed: ${e instanceof Error ? e.message : "Unknown error"}`, "warning");
    } finally {
      setCapturing(false);
    }
  };

  const statusIcon =
    statusState === "loading" ? (
      <Loader2 className="animate-spin" size={20} />
    ) : statusState === "online" ? (
      <CheckCircle2 className="text-green-400" size={20} />
    ) : (
      <XCircle className="text-red-400" size={20} />
    );

  const prettyPrint = (data: unknown): string => {
    if (data === null || data === undefined) return "null";
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Unity Control</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refreshStatus(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
            title="Refresh status"
          >
            <RefreshCw size={16} />
            <span className="text-sm">Refresh</span>
          </button>
          <button
            onClick={handleCapture}
            disabled={capturing || statusState !== "online"}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors"
            title="Capture Scene View"
          >
            {capturing ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}
            <span className="text-sm">Capture</span>
          </button>
        </div>
      </div>

      {/* Live Unity preview */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${statusState === "online" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/5 text-gray-400"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusState === "online" ? "bg-emerald-300 animate-pulse-glow" : "bg-gray-500"}`} />
                {statusState === "online" ? "Live" : "Standby"}
              </span>
              <h2 className="font-semibold flex items-center gap-2"><Camera size={18} /> Live Unity Preview</h2>
            </div>
            <p className="text-xs text-gray-400 mt-2">Capture the active Unity camera to preview the current scene.</p>
          </div>
          <button
            onClick={handleCapture}
            disabled={capturing || statusState !== "online"}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors"
          >
            {capturing ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}
            {capturing ? "Rendering..." : "Refresh preview"}
          </button>
        </div>
        <div className={`unity-preview-frame w-full max-w-3xl aspect-video ${capturing ? "shimmer" : ""}`}>
          {previewDataUrl ? (
            <img src={previewDataUrl} alt="Latest Unity camera capture" className="w-full h-full object-contain" />
          ) : (
            <div className="unity-preview-empty w-full h-full flex items-center justify-center text-sm text-gray-400">
              No preview yet. Use “Refresh preview” to render the current Unity camera.
            </div>
          )}
        </div>
      </Card>

      {/* Status Card */}
      <Card>
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          {statusIcon}
          <div>
            <div className="font-semibold">
              {statusState === "loading" && "Checking Unity status..."}
              {statusState === "online" && "Unity Pipeline server is online"}
              {statusState === "offline" && "Unity Pipeline server is offline"}
              {lastChecked && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  checked {lastChecked}
                </span>
              )}
            </div>
            {statusError && (
              <div className="text-sm text-red-400 mt-1">{statusError}</div>
            )}
            {statusDetail !== null && statusState === "online" && (
              <details className="mt-2">
                <summary className="text-sm text-gray-400 cursor-pointer hover:text-white">
                  Status details
                </summary>
                <pre className="mt-2 text-xs bg-black/30 p-3 rounded-lg overflow-auto max-h-64">
                  {prettyPrint(statusDetail)}
                </pre>
              </details>
            )}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div
        className="flex gap-2 border-b border-white/10 pb-1"
        role="tablist"
        aria-label="Unity control views"
      >
        {[
          { key: "quick", label: "Quick Actions", icon: <Play size={16} /> },
          { key: "custom", label: "Custom Command", icon: <Terminal size={16} /> },
          {
            key: "history",
            label: `History${commandHistory.length ? ` (${commandHistory.length})` : ""}`,
            icon: null,
          },
        ].map((tab) => (
          <button
            key={tab.key}
            id={`unity-tab-${tab.key}`}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`unity-panel-${tab.key}`}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg transition-colors ${
              activeTab === tab.key
                ? "bg-white/10 text-white"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quick Actions Tab */}
      {activeTab === "quick" && (
        <div
          role="tabpanel"
          id="unity-panel-quick"
          aria-labelledby="unity-tab-quick"
          tabIndex={0}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          {/* Create Object */}
          <Card>
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Plus size={18} /> Create Object
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="uc-object-name" className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  id="uc-object-name"
                  type="text"
                  value={objectName}
                  onChange={(e) => setObjectName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="MyObject"
                />
              </div>
              <div>
                <label htmlFor="uc-primitive" className="block text-sm text-gray-400 mb-1">Primitive</label>
                <select
                  id="uc-primitive"
                  value={primitive}
                  onChange={(e) => setPrimitive(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="cube">Cube</option>
                  <option value="sphere">Sphere</option>
                  <option value="capsule">Capsule</option>
                  <option value="cylinder">Cylinder</option>
                  <option value="plane">Plane</option>
                  <option value="quad">Quad</option>
                </select>
              </div>
              <button
                onClick={handleQuickCreate}
                disabled={running || statusState !== "online"}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors"
              >
                {running ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                Create
              </button>
            </div>
          </Card>

          {/* Visibility */}
          <Card>
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Eye size={18} /> Visibility
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="uc-vis-target" className="block text-sm text-gray-400 mb-1">GameObject Name</label>
                <input
                  id="uc-vis-target"
                  type="text"
                  value={visTarget}
                  onChange={(e) => setVisTarget(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="MyObject"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleQuickShow}
                  disabled={running || statusState !== "online"}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/80 hover:bg-emerald-600 disabled:bg-emerald-500/30 rounded-lg transition-colors"
                >
                  <Eye size={16} /> Show
                </button>
                <button
                  onClick={handleQuickHide}
                  disabled={running || statusState !== "online"}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/80 hover:bg-red-600 disabled:bg-red-500/30 rounded-lg transition-colors"
                >
                  <EyeOff size={16} /> Hide
                </button>
              </div>
            </div>
          </Card>

          {/* Add Component */}
          <Card>
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Box size={18} /> Add Component
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="uc-component-target" className="block text-sm text-gray-400 mb-1">Target GameObject</label>
                <input
                  id="uc-component-target"
                  type="text"
                  value={componentTarget}
                  onChange={(e) => setComponentTarget(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="MyObject"
                />
              </div>
              <div>
                <label htmlFor="uc-component-type" className="block text-sm text-gray-400 mb-1">Component Type</label>
                <input
                  id="uc-component-type"
                  type="text"
                  value={componentType}
                  onChange={(e) => setComponentType(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. AudioSource, Rigidbody"
                />
              </div>
              <button
                onClick={handleQuickAddComponent}
                disabled={running || statusState !== "online"}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors"
              >
                {running ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                Add Component
              </button>
            </div>
          </Card>

          {/* Animation */}
          <Card>
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Play size={18} /> Animation
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="uc-anim-target" className="block text-sm text-gray-400 mb-1">Target GameObject</label>
                <input
                  id="uc-anim-target"
                  type="text"
                  value={animTarget}
                  onChange={(e) => setAnimTarget(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="MyObject"
                />
              </div>
              <div>
                <label htmlFor="uc-anim-clip" className="block text-sm text-gray-400 mb-1">Animation Clip Name</label>
                <input
                  id="uc-anim-clip"
                  type="text"
                  value={animClip}
                  onChange={(e) => setAnimClip(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="MyClip"
                />
              </div>
               <div className="flex gap-2">
                 <button
                   onClick={handleQuickPlayAnim}
                   disabled={running || statusState !== "online"}
                   className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/80 hover:bg-emerald-600 disabled:bg-emerald-500/30 rounded-lg transition-colors"
                 >
                   <Play size={16} /> Play
                 </button>
                 <button
                   onClick={handleQuickStopAnim}
                   disabled={running || statusState !== "online"}
                   className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/80 hover:bg-red-600 disabled:bg-red-500/30 rounded-lg transition-colors"
                 >
                   <Square size={16} /> Stop
                 </button>
               </div>
             </div>
           </Card>

          {/* Shader / Material */}
          <Card className="lg:col-span-2">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Terminal size={18} /> Shader / Material
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={handleListShaders}
                    disabled={running || statusState !== "online"}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors text-sm"
                  >
                    {running ? <Loader2 className="animate-spin" size={16} /> : <Terminal size={16} />}
                    List Shaders
                  </button>
                  <select
                    aria-label="Select shader"
                    value={selectedShader}
                    onChange={(e) => setSelectedShader(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="" disabled>Select shader...</option>
                    {shaderList.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleGetShaderProperties}
                    disabled={running || statusState !== "online" || !selectedShader}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors text-sm"
                  >
                    Get Shader Properties
                  </button>
                  <input
                    id="uc-shader-props-target"
                    type="text"
                    value={shaderPropsTarget}
                    onChange={(e) => setShaderPropsTarget(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="Optional material target override"
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    id="uc-material-target"
                    type="text"
                    value={materialTarget}
                    onChange={(e) => setMaterialTarget(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="Target object name"
                  />
                  <input
                    id="uc-material-name"
                    type="text"
                    value={materialName}
                    onChange={(e) => setMaterialName(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="Material name (optional)"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleGetMaterialProperties}
                    disabled={running || statusState !== "online" || !materialTarget}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors text-sm"
                  >
                    Get Material Properties
                  </button>
                  <input
                    id="uc-mat-prop-key"
                    type="text"
                    value={materialPropertyKey}
                    onChange={(e) => setMaterialPropertyKey(e.target.value)}
                    className="w-40 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="Property"
                  />
                  <input
                    id="uc-mat-prop-value"
                    type="text"
                    value={materialPropertyValue}
                    onChange={(e) => setMaterialPropertyValue(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
                    placeholder='Value (JSON or string)'
                  />
                  <button
                    onClick={handleSetMaterialProperty}
                    disabled={running || statusState !== "online" || !materialTarget || !materialPropertyKey || materialPropertyValue === ""}
                    className="px-3 py-2 bg-emerald-500/80 hover:bg-emerald-600 disabled:bg-emerald-500/30 rounded-lg transition-colors text-sm"
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>
            {shaderMaterialOutput !== null && (
              <pre className="mt-4 text-xs bg-black/30 p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
                {prettyPrint(shaderMaterialOutput)}
              </pre>
            )}
          </Card>
        </div>
      )}

      {/* Custom Command Tab */}
      {activeTab === "custom" && (
        <div
          role="tabpanel"
          id="unity-panel-custom"
          aria-labelledby="unity-tab-custom"
          tabIndex={0}
        >
          <Card>
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Terminal size={18} /> Custom Command
          </h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="uc-custom-command" className="block text-sm text-gray-400 mb-1">Command</label>
              <input
                id="uc-custom-command"
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCustomCommand()}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
                placeholder="e.g. create_gameobject, editor_status, list_animations"
              />
            </div>
            <div>
              <label htmlFor="uc-custom-params" className="block text-sm text-gray-400 mb-1">Parameters (JSON)</label>
              <textarea
                id="uc-custom-params"
                value={customParams}
                onChange={(e) => setCustomParams(e.target.value)}
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500 resize-y"
                placeholder='{"name": "Foo", "primitive": "sphere"}'
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCustomCommand}
                disabled={running || !customCommand.trim() || statusState !== "online"}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500/40 rounded-lg transition-colors"
              >
                {running ? <Loader2 className="animate-spin" size={16} /> : <Terminal size={16} />}
                Run Command
              </button>
              {commandsError ? (
                <button
                  onClick={() => loadCommands()}
                  className="px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded-lg transition-colors hover:bg-amber-500/20"
                  title={commandsError}
                >
                  Command list failed to load — Retry
                </button>
              ) : (
                commandsLoaded && (
                  <select
                    aria-label="Insert a Unity command"
                    onChange={(e) => {
                      if (e.target.value) {
                        setCustomCommand(e.target.value);
                        setCustomParams("{}");
                      }
                    }}
                    value=""
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="" disabled>
                      Insert command...
                    </option>
                    {commands.map((cmd) => (
                      <option key={cmd.name} value={cmd.name} title={cmd.description}>
                        {cmd.name}
                      </option>
                    ))}
                  </select>
                )
              )}
            </div>
          </div>
          </Card>
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div
          role="tabpanel"
          id="unity-panel-history"
          aria-labelledby="unity-tab-history"
          tabIndex={0}
        >
          <Card>
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Terminal size={18} /> Command History
          </h3>
          {commandHistory.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">
              No commands executed yet. Run a command to see it here.
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-auto">
              {commandHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-3 bg-white/5 rounded-lg"
                >
                  <span className="text-xs text-gray-500 whitespace-nowrap mt-0.5">
                    {entry.time}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-indigo-300">
                      {entry.command}
                    </div>
                    <pre className="mt-1 text-xs bg-black/30 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                      {entry.result.ok
                        ? prettyPrint(entry.result.data)
                        : `ERROR: ${entry.result.error}`}
                    </pre>
                  </div>
                  <span
                    className={`shrink-0 mt-0.5 ${
                      entry.result.ok ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {entry.result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  </span>
                </div>
              ))}
            </div>
          )}
          </Card>
        </div>
      )}
    </div>
  );
}
