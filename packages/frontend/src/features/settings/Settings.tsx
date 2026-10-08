import { Check, FolderOpen, Link2, Save, Server, Workflow, Moon, Sun, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Card, StatusBadge } from "../../components/common";
import { useHealth } from "../../hooks";
import { useTheme } from "../../utils/theme";
import { getSettings, getIntegrationStatus, type IntegrationStatus } from "../../services/api";
import { getPortConfigFromEnv } from "../../services/portConfig";
import { useNotificationStore } from "../../state/notificationStore";
import {
  saveNotificationPreferences,
  subscribePush,
  unsubscribePush,
  type PushSubscriptionJSON,
} from "../../services/api/notifications";
import type { NotificationPreferences } from "../../state/notificationStore";

interface AppSettings {
  comfyui_url: string;
  ollama_url: string;
  atomic_chat_url: string;
  atomic_chat_enabled: boolean;
  log_level: string;
  max_queue_workers: number;
  backend_port: number;
  frontend_port: number;
  default_model?: string;
}

/**
 * Adapter status values that mean "up". The backend reports raw
 * AdapterStatus values ("connected"), while /api/render/health maps them
 * to "online" — accept both so the text never contradicts the badge.
 */
function isAdapterUp(status: string | undefined): boolean {
  return status === "connected" || status === "online" || status === "healthy";
}

interface ConnectionTestResult {
  status: "idle" | "testing" | "success" | "error";
  message: string;
}

export function Settings() {
  const { serviceStatus } = useHealth();
  const { theme, toggleTheme } = useTheme();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const env = getPortConfigFromEnv();
    return {
      comfyui_url: env.comfyui_url || "http://127.0.0.1:8188",
      ollama_url: "http://127.0.0.1:11434",
      atomic_chat_url: "http://127.0.0.1:1337",
      atomic_chat_enabled: false,
      log_level: "INFO",
      max_queue_workers: 1,
      backend_port: env.backend_port || 8000,
      frontend_port: env.frontend_port || 5173,
    };
  });
  const [connectionTests, setConnectionTests] = useState<Record<string, ConnectionTestResult>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load current settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await getSettings();
        setSettings((prev) => ({ ...prev, ...data }));
      } catch {
        setError("Failed to load settings from backend");
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasUnsavedChanges(true);
    setSaved(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/config/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comfyui_url: settings.comfyui_url,
          ollama_url: settings.ollama_url,
          atomic_chat_url: settings.atomic_chat_url,
          atomic_chat_enabled: settings.atomic_chat_enabled,
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
      setHasUnsavedChanges(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (url: string, type: "comfyui" | "ollama") => {
    const key = `${type}-${url}`;
    setConnectionTests((prev) => ({ ...prev, [key]: { status: "testing", message: "Testing..." } }));
    try {
      const data: IntegrationStatus = await getIntegrationStatus(type);
      setConnectionTests((prev) => ({
        ...prev,
        [key]: { status: "success", message: `Connected — ${data.status}` },
      }));
    } catch {
      setConnectionTests((prev) => ({
        ...prev,
        [key]: { status: "error", message: `Not reachable at ${url}` },
      }));
    }
    setTimeout(() => {
      setConnectionTests((prev) => ({ ...prev, [key]: { status: "idle", message: "" } }));
    }, 5000);
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted mt-1">Configure the application</p>
        </div>
        {hasUnsavedChanges && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Unsaved changes
          </span>
        )}
      </div>

      <div className="grid grid-2 gap-6">
        {/* Error Banner */}
        {error && (
          <div className="col-span-2 p-3 bg-red-900/20 border border-red-700/50 rounded-lg flex items-start gap-2 text-red-200 text-sm">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-300 hover:text-white text-xs"
            >
              Dismiss
            </button>
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
                  aria-label="ComfyUI URL"
                  value={settings.comfyui_url}
                  onChange={(e) => updateSetting("comfyui_url", e.target.value)}
                  placeholder="http://127.0.0.1:8188"
                />
                <button
                  className="btn btn-secondary"
                  title="Test Connection"
                  onClick={() => testConnection(settings.comfyui_url, "comfyui")}
                  disabled={connectionTests[`comfyui-${settings.comfyui_url}`]?.status === "testing"}
                >
                  {connectionTests[`comfyui-${settings.comfyui_url}`]?.status === "testing" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Link2 size={16} />
                  )}
                </button>
              </div>
              {connectionTests[`comfyui-${settings.comfyui_url}`]?.status === "success" && (
                <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} /> {connectionTests[`comfyui-${settings.comfyui_url}`].message}
                </p>
              )}
              {connectionTests[`comfyui-${settings.comfyui_url}`]?.status === "error" && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {connectionTests[`comfyui-${settings.comfyui_url}`].message}
                </p>
              )}
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
                    {isAdapterUp(serviceStatus?.adapters?.comfyui)
                      ? "Connected and ready"
                      : "Not connected"}
                  </p>
                </div>
              </div>
              <StatusBadge status={serviceStatus?.adapters?.comfyui || "offline"} />
            </div>

            <div>
              <label className="label">Default Workflow</label>
              <select className="select" defaultValue="default" aria-label="Default workflow">
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
                aria-label="Output node ID"
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
                  aria-label="Ollama URL"
                  value={settings.ollama_url}
                  onChange={(e) => updateSetting("ollama_url", e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                />
                <button
                  className="btn btn-secondary"
                  title="Test Connection"
                  onClick={() => testConnection(settings.ollama_url, "ollama")}
                  disabled={connectionTests[`ollama-${settings.ollama_url}`]?.status === "testing"}
                >
                  {connectionTests[`ollama-${settings.ollama_url}`]?.status === "testing" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Link2 size={16} />
                  )}
                </button>
              </div>
              {connectionTests[`ollama-${settings.ollama_url}`]?.status === "success" && (
                <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} /> {connectionTests[`ollama-${settings.ollama_url}`].message}
                </p>
              )}
              {connectionTests[`ollama-${settings.ollama_url}`]?.status === "error" && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {connectionTests[`ollama-${settings.ollama_url}`].message}
                </p>
              )}
              <p className="text-xs text-muted mt-1">Base Ollama server for LLM text generation</p>
            </div>

            <div className="flex items-center justify-between p-3 bg-background rounded-lg">
              <div className="flex items-center gap-3">
                <Server size={20} className="text-muted" />
                <div>
                  <p className="font-medium">Ollama Status</p>
                  <p className="text-xs text-muted">
                    {isAdapterUp(serviceStatus?.adapters?.ollama)
                      ? "Connected and ready"
                      : "Not connected"}
                  </p>
                </div>
              </div>
              <StatusBadge status={serviceStatus?.adapters?.ollama || "offline"} />
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium">Atomic Chat TurboQuant</p>
                  <p className="text-xs text-muted">
                    Route through Atomic Chat's faster OpenAI-compatible backend
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    aria-label="Enable Atomic Chat TurboQuant"
                    checked={settings.atomic_chat_enabled}
                    onChange={(e) => updateSetting("atomic_chat_enabled", e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              <div>
                <label className="label">Atomic Chat URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input flex-1"
                    aria-label="Atomic Chat URL"
                    value={settings.atomic_chat_url}
                    onChange={(e) => updateSetting("atomic_chat_url", e.target.value)}
                    placeholder="http://127.0.0.1:1337"
                    disabled={!settings.atomic_chat_enabled}
                  />
                  <button
                    className="btn btn-secondary"
                    title="Test Connection"
                    disabled={!settings.atomic_chat_enabled}
                    onClick={() => testConnection(settings.atomic_chat_url, "ollama")}
                  >
                    <Link2 size={16} />
                  </button>
                </div>
                <p className="text-xs text-muted mt-1">
                  Atomic Chat OpenAI-compatible API endpoint
                </p>
              </div>
            </div>

            <div>
              <label className="label">Default Model</label>
              <select
                className="select"
                aria-label="Default model"
                value={settings.default_model || "qwen3.5:4b"}
                onChange={(e) => updateSetting("default_model", e.target.value)}
              >
                <option value="qwen3.5:4b">qwen3.5:4b (fast, 4B)</option>
                <option value="qwen3.5:9b">qwen3.5:9b (quality, 9B)</option>
                <option value="ornith-1.5:9b">ornith-1.5:9b (vision+tools)</option>
                <option value="deepseek-r1:7b">deepseek-r1:7b (reasoning)</option>
                <option value="gemma4:e2b-it-qat">gemma4:e2b-it-qat (vision)</option>
                <option value="llama3.2:3b">llama3.2:3b (lightweight)</option>
              </select>
              <p className="text-xs text-muted mt-1">
                Used for chat, visualizer, and 3D generation
              </p>
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
                  aria-label="Output directory"
                  defaultValue="./output"
                  readOnly
                />
                <button
                  className="btn btn-secondary"
                  aria-label="Browse output directory"
                  title="Browse output directory"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>

            <div>
              <label className="label">Max Queue Workers</label>
              <select
                className="select"
                aria-label="Max queue workers"
                value={settings.max_queue_workers}
                onChange={(e) => updateSetting("max_queue_workers", parseInt(e.target.value, 10))}
              >
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
            <select
              className="select"
              aria-label="Log level"
              value={settings.log_level}
                onChange={(e) => updateSetting("log_level", e.target.value)}
            >
              <option value="DEBUG">Debug</option>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="ERROR">Error</option>
            </select>
          </div>
        </Card>

        {/* Appearance / Theme */}
        <Card title="Appearance" icon={theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-xs text-muted">{theme === "dark" ? "Dark mode" : "Light mode"}</p>
            </div>
            <button className="btn btn-secondary flex items-center gap-2" onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              Switch to {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </Card>

        {/* Notifications */}
        <NotificationPreferencesCard />

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
          <p className="text-xs text-muted mt-2 text-center">
            Changes are persisted to config/settings.json
          </p>
        </Card>
      </div>
    </div>
  );
}

function NotificationPreferencesCard() {
  const preferences = useNotificationStore((s) => s.preferences);
  const setPreferences = useNotificationStore((s) => s.setPreferences);
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof NotificationPreferences) => {
    if (key === "quietHours") return;
    setPreferences({
      ...preferences,
      [key]: !(preferences as unknown as Record<string, boolean>)[key],
    });
    setSaved(false);
  };

  const handleSave = () => {
    saveNotificationPreferences(preferences);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Card title="Notifications">
      <div className="space-y-3">
        <ToggleRow
          label="Job progress updates"
          checked={preferences.progress}
          onToggle={() => toggle("progress")}
        />
        <ToggleRow
          label="Job completed"
          checked={preferences.completed}
          onToggle={() => toggle("completed")}
        />
        <ToggleRow
          label="Job failed / dead"
          checked={preferences.failed}
          onToggle={() => toggle("failed")}
        />
        <ToggleRow
          label="Job cancelled"
          checked={preferences.cancelled}
          onToggle={() => toggle("cancelled")}
        />
        <ToggleRow
          label="System notifications"
          checked={preferences.system}
          onToggle={() => toggle("system")}
        />
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Quiet hours</p>
            <p className="text-xs text-muted">Mute notifications during set hours</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              aria-label="Enable quiet hours"
              checked={preferences.quietHours.enabled}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  quietHours: { ...preferences.quietHours, enabled: e.target.checked },
                })
              }
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>
        {preferences.quietHours.enabled && (
          <div className="flex gap-2">
            <input
              type="time"
              className="input"
              value={preferences.quietHours.start}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  quietHours: { ...preferences.quietHours, start: e.target.value },
                })
              }
              aria-label="Quiet hours start"
            />
            <span className="text-muted self-center">to</span>
            <input
              type="time"
              className="input"
              value={preferences.quietHours.end}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  quietHours: { ...preferences.quietHours, end: e.target.value },
                })
              }
              aria-label="Quiet hours end"
            />
          </div>
        )}
        <PushNotificationRow
          preferences={preferences}
          setPreferences={setPreferences}
        />
        <button
          className={`btn w-full ${saved ? "btn-primary" : "btn-secondary"}`}
          onClick={handleSave}
        >
          {saved ? "Saved" : "Save notification preferences"}
        </button>
      </div>
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="font-medium text-sm">{label}</p>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          aria-label={label}
          checked={checked}
          onChange={onToggle}
        />
        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
      </label>
    </div>
  );
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64url = base64.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const raw = atob(base64url);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function PushNotificationRow({
  preferences,
  setPreferences,
}: {
  preferences: NotificationPreferences;
  setPreferences: (prefs: NotificationPreferences) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // VAPID public key for push subscription. Set VITE_VAPID_PUBLIC_KEY in
  // packages/frontend/.env when a Web Push provider is configured; without
  // it the browser cannot create a subscription and the button reports why.
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

  const requestPermission = async () => {
    setLoading(true);
    setStatus(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("Push not supported in this browser");
        setLoading(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Permission denied");
        setLoading(false);
        return;
      }
      if (!vapidKey) {
        setStatus("Push not configured (missing VAPID key)");
        setLoading(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(vapidKey),
        });
      }
      // toJSON() already yields the standard PushSubscriptionJSON wire format
      // (base64url keys) — pass it through rather than decode/re-encode
      // round-trips, which also risk a stack overflow spreading large key arrays.
      const subscriptionJson = subscription.toJSON();
      const pushSubscription: PushSubscriptionJSON = {
        endpoint: subscriptionJson.endpoint ?? subscription.endpoint,
        keys: {
          p256dh: subscriptionJson.keys?.p256dh ?? "",
          auth: subscriptionJson.keys?.auth ?? "",
        },
      };

      await subscribePush(pushSubscription);
      setPreferences({
        ...preferences,
        push: { enabled: true, subscribed: true },
      });
      setStatus("Subscribed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to enable push");
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    setLoading(true);
    setStatus(null);
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          // The server only keys on endpoint for removal; no need to serialize keys.
          const payload = { endpoint: subscription.endpoint };
          // Server unsubscribe is best-effort: the local subscription is
          // already gone after unsubscribe(), so a backend failure must not
          // leave the UI claiming push is still on.
          try {
            await unsubscribePush(payload);
          } catch (serverError) {
            console.warn("[push] server unsubscribe failed", serverError);
          }
          await subscription.unsubscribe();
        }
      }
      setPreferences({
        ...preferences,
        push: { enabled: false, subscribed: false },
      });
      setStatus("Unsubscribed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to disable push");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="font-medium text-sm">Push notifications</p>
        <p className="text-xs text-muted">
          {preferences.push.subscribed ? "Browser push enabled" : "Receive alerts when closed"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {status && <span className="text-xs text-muted">{status}</span>}
        {preferences.push.subscribed ? (
          <button
            className="btn btn-secondary text-xs"
            onClick={unsubscribe}
            disabled={loading}
          >
            {loading ? "..." : "Disable"}
          </button>
        ) : (
          <button
            className="btn btn-secondary text-xs"
            onClick={requestPermission}
            disabled={loading}
          >
            {loading ? "..." : "Enable"}
          </button>
        )}
      </div>
    </div>
  );
}
