import { Check, FolderOpen, Link2, Save, Server, Workflow, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Card, StatusBadge } from "../../components/common";
import { useHealth } from "../../hooks";
import { useTheme } from "../../utils/theme";

export function Settings() {
  const { serviceStatus } = useHealth();
  const { theme, toggleTheme } = useTheme();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    // Placeholder for saving settings
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 1000);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted mt-1">Configure the application</p>
      </div>

      <div className="grid grid-2 gap-6">
        {/* ComfyUI Configuration */}
        <Card title="ComfyUI Configuration" icon={<Workflow size={18} />}>
          <div className="space-y-4">
            <div>
              <label className="label">ComfyUI URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  defaultValue="http://127.0.0.1:8188"
                  placeholder="http://127.0.0.1:8188"
                />
                <button className="btn btn-secondary" title="Test Connection">
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
                  defaultValue="http://127.0.0.1:11434"
                  placeholder="http://127.0.0.1:11434"
                />
                <button className="btn btn-secondary" title="Test Connection">
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
              <select className="select" defaultValue="llama2">
                <option value="llama2">llama2</option>
                <option value="llama3">llama3</option>
                <option value="mistral">mistral</option>
                <option value="codellama">codellama</option>
              </select>
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
              <select className="select" defaultValue={1}>
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
            <select className="select" defaultValue="INFO">
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
              "Saving..."
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
        </Card>
      </div>
    </div>
  );
}
