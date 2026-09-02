import { Check, FolderOpen, Link2, Save, Server, Workflow, Moon, Sun, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Card, StatusBadge } from "../../components/common";
import { useHealth } from "../../hooks";
import { useTheme } from "../../utils/theme";
import { getApiBaseUrl } from "../../services/portConfig";

interface AppSettings {
  comfyui_url: string;
  ollama_url: string;
  log_level: string;
  max_queue_workers: number;
  backend_port: number;
  frontend_port: number;
  default_model?: string;
}

export function Settings() {
  const { serviceStatus } = useHealth();
  const { theme, toggleTheme } = useTheme();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    comfyui_url: "http://127.0.0.1:8188",
    ollama_url: "http://127.0.0.1:11434",
    log_level: "INFO",
    max_queue_workers: 1,
    backend_port: 8000,
    frontend_port: 5173,
  });

  // Load current settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/api/integrations/config/settings`);
        if (res.ok) {
          const data = await res.json();
          setSettings(prev => ({ ...prev, ...data }));
        }
      } catch {
        setError("Failed to load settings from backend");
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/integrations/config/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comfyui_url: settings.comfyui_url,
          ollama_url: settings.ollama_url,
          log_level: settings.log_level,
          max_queue_workers: settings.max_queue_workers,
          default_model: settings.default_model,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail.detail || "Failed to save settings");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (url: string, type: "comfyui" | "ollama") => {
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/integrations/${type}/health`);
      if (res.ok) {
        const data = await res.json();
        alert(`${type.toUpperCase()} status: ${data.status}`);
      } else {
        alert(`${type.toUpperCase()} connection failed`);
      }
    } catch {
      alert(`${type.toUpperCase()} not reachable at ${url}`);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 size={24} className="animate-spin text-primary" />
        <span className="ml-2 text-muted">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted mt-1">Configure the application</p>
      </div>

      <div className="grid grid-2 gap-6">
        {/* Error Banner */}
        {error && (
          <div className="col-span-2 p-3 bg-red-900/20 border border-red-700/50 rounded-lg flex items-start gap-2 text-red-200 text-sm">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-white text-xs">Dismiss</button>
          </div>
        )}
        {/* ComfyUI Configuration */}
        <Card title="ComfyUI Configuration" icon={<Workflow size={18} />}>
          <div className="space-y-4">
            <div>
              <label className="label">ComfyUI URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  value={settings.comfyui_url}
                  onChange={(e) => setSettings(prev => ({ ...prev, comfyui_url: e.target.value }))}
                  placeholder="http://127.0.0.1:8188"
                />
                <button className="btn btn-secondary" title="Test Connection" onClick={() => testConnection(settings.comfyui_url, "comfyui")}>
                  <Link2 size={16} />
                </button>
              </div>
              <p className="text-xs text-muted mt-1">
                ComfyUI server address for image and video generation
              </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-background rounded-lg">
              <div className="flex items-center gap-3">
                <Server size={20} className="text-muted" />
                <div>
                  <p className="font-medium">ComfyUI Status</p>
                  <p className="text-xs text-muted">
                    {serviceStatus?.adapters?.comfyui === "online"
                      ? "Connected and ready"
                      : "Not connected"}
                  </p>
                </div>
              </div>
              <StatusBadge
                status={serviceStatus?.adapters?.comfyui || "offline"}
              />
            </div>

            <div>
              <label className="label">Default Workflow</label>
              <select className="select" defaultValue="default">
                <option value="default">Standard Image Generation</option>
                <option value="animate">AnimateDiff Video</option>
                <option value="controlnet">ControlNet + Image</option>
                <option value="ipadapter">IP-Adapter Style Transfer</option>
              </select>
              <p className="text-xs text-muted mt-1">
                Default ComfyUI workflow for image generation
              </p>
            </div>

            <div>
              <label className="label">Output Node ID</label>
              <input
                type="text"
                className="input"
                defaultValue="9"
                placeholder="SaveImage node ID"
              />
              <p className="text-xs text-muted mt-1">
                Node ID for saving images in ComfyUI workflow
              </p>
            </div>
          </div>
        </Card>

        {/* Ollama Configuration */}
        <Card title="Ollama Configuration" icon={<Server size={18} />}>
          <div className="space-y-4">
            <div>
              <label className="label">Ollama URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  value={settings.ollama_url}
                  onChange={(e) => setSettings(prev => ({ ...prev, ollama_url: e.target.value }))}
                  placeholder="http://127.0.0.1:11434"
                />
                <button className="btn btn-secondary" title="Test Connection" onClick={() => testConnection(settings.ollama_url, "ollama")}>
                  <Link2 size={16} />
                </button>
              </div>
              <p className="text-xs text-muted mt-1">
                Ollama server for LLM text generation
              </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-background rounded-lg">
              <div className="flex items-center gap-3">
                <Server size={20} className="text-muted" />
                <div>
                  <p className="font-medium">Ollama Status</p>
                  <p className="text-xs text-muted">
                    {serviceStatus?.adapters?.ollama === "online"
                      ? "Connected and ready"
                      : "Not connected"}
                  </p>
                </div>
              </div>
              <StatusBadge
                status={serviceStatus?.adapters?.ollama || "offline"}
              />
            </div>

            <div>
              <label className="label">Default Model</label>
              <select className="select" value={settings.default_model || "qwen3.5:4b"} onChange={(e) => setSettings(prev => ({ ...prev, default_model: e.target.value }))}>
                <option value="qwen3.5:4b">qwen3.5:4b (fast, 4B)</option>
                <option value="qwen3.5:9b">qwen3.5:9b (quality, 9B)</option>
                <option value="ornith-1.5:9b">ornith-1.5:9b (vision+tools)</option>
                <option value="deepseek-r1:7b">deepseek-r1:7b (reasoning)</option>
                <option value="gemma4:e2b-it-qat">gemma4:e2b-it-qat (vision)</option>
                <option value="llama3.2:3b">llama3.2:3b (lightweight)</option>
              </select>
              <p className="text-xs text-muted mt-1">Used for chat, visualizer, and 3D generation</p>
            </div>
          </div>
        </Card>

        {/* Output Settings */}
        <Card title="Output Settings">
          <div className="space-y-4">
            <div>
              <label className="label">Output Directory</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  defaultValue="./output"
                  readOnly
                />
                <button className="btn btn-secondary">
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>

            <div>
              <label className="label">Max Queue Workers</label>
              <select className="select" value={settings.max_queue_workers} onChange={(e) => setSettings(prev => ({ ...prev, max_queue_workers: parseInt(e.target.value, 10) }))}>
                <option value={1}>1 (Serial)</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
              <p className="text-xs text-muted mt-1">
                Serial execution recommended for limited VRAM
              </p>
            </div>
          </div>
        </Card>

        {/* Log Level */}
        <Card title="Logging">
            <div>
              <label className="label">Log Level</label>
              <select className="select" value={settings.log_level} onChange={(e) => setSettings(prev => ({ ...prev, log_level: e.target.value }))}>
                <option value="DEBUG">Debug</option>
                <option value="INFO">Info</option>
                <option value="WARNING">Warning</option>
                <option value="ERROR">Error</option>
              </select>
            </div>
        </Card>

        {/* Appearance / Theme */}
        <Card
          title="Appearance"
          icon={theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-xs text-muted">
                {theme === "dark" ? "Dark mode" : "Light mode"}
              </p>
            </div>
            <button
              className="btn btn-secondary flex items-center gap-2"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              Switch to {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </Card>

        {/* Save Button */}
        <Card>
          <button
            className={`btn w-full ${saved ? "btn-primary" : "btn-primary"}`}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="inline mr-2 animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <Check size={16} className="inline mr-2" />
                Saved
              </>
            ) : (
              <>
                <Save size={16} className="inline mr-2" />
                Save Settings
              </>
            )}
          </button>
          <p className="text-xs text-muted mt-2 text-center">Changes are persisted to config/settings.json</p>
        </Card>
      </div>
    </div>
  );
}
