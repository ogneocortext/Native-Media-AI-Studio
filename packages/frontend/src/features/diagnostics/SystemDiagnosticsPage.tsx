import { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu,
  Thermometer,
  Activity,
  Server,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Box,
  Settings,
  Clock,
  Zap,
  HardDrive,
  Pause,
  Play,
  TrendingUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import {
  getGPUSnapshot,
  get3DStatus,
  getDiagnostics,
  getSystemDiagnostics,
  checkService,
  type GPUSnapshot,
  type SystemHealth,
} from "../../services/api";
import { DS } from "../../styles/designSystem";

interface ServiceCheck {
  service: string;
  status: "online" | "offline" | "checking";
  error?: string;
  lastChecked?: number;
}

interface DataPoint {
  time: number;
  label: string;
  gpu?: number;
  vram?: number;
  cpu?: number;
  memory?: number;
  temp?: number;
}

const REFRESH_INTERVALS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
  { label: "60s", value: 60000 },
];

const MAX_HISTORY_POINTS = 60;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl">
        <p className="text-xs text-gray-400 mb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm font-medium" style={{ color: entry.color }}>
            {entry.name}: {entry.value.toFixed(1)}%
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export function SystemDiagnosticsPage() {
  const [gpu, setGpu] = useState<GPUSnapshot | null>(null);
  const [prevGpu, setPrevGpu] = useState<GPUSnapshot | null>(null);
  const [status3d, setStatus3d] = useState<Record<string, unknown>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>({});
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [prevSystemHealth, setPrevSystemHealth] = useState<SystemHealth | null>(null);
  const [serviceChecks, setServiceChecks] = useState<Record<string, ServiceCheck>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [showSettings, setShowSettings] = useState(false);
  const [activeChart, setActiveChart] = useState<string>('gpu');
  
  // History data for charts
  const [history, setHistory] = useState<DataPoint[]>([]);

  const getActiveColor = () => {
    const colors: Record<string, string> = {
      gpu: '#8b5cf6',
      vram: '#06b6d4',
      cpu: '#10b981',
      memory: '#f59e0b',
    };
    return colors[activeChart] || '#8b5cf6';
  };

  const getActiveLabel = () => {
    const labels: Record<string, string> = {
      gpu: 'GPU',
      vram: 'VRAM',
      cpu: 'CPU',
      memory: 'Memory',
    };
    return labels[activeChart] || 'GPU';
  };

  const loadAll = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const [gpuData, status3dData, diagData, sysData] = await Promise.all([
        getGPUSnapshot().catch(() => null),
        get3DStatus().catch(() => null),
        getDiagnostics().catch(() => null),
        getSystemDiagnostics().catch(() => null),
      ]);
      
      const now = Date.now();
      const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      setPrevGpu(gpu);
      setGpu(gpuData as GPUSnapshot | null);
      setStatus3d(status3dData || {});
      setDiagnostics(diagData || {});
      setPrevSystemHealth(systemHealth);
      setSystemHealth(sysData);
      setLastUpdated(new Date());
      
      // Update history
      setHistory(prev => {
        const newPoint: DataPoint = {
          time: now,
          label: timeLabel,
          gpu: gpuData?.gpu_utilization ?? 0,
          vram: gpuData?.memory_percent ?? 0,
          cpu: sysData?.cpu.usage_percent ?? 0,
          memory: sysData?.memory.percent ?? 0,
          temp: gpuData?.temperature_c ?? 0,
        };
        return [...prev.slice(-MAX_HISTORY_POINTS), newPoint];
      });
    } catch (err: any) {
      setError(err.message || "Failed to load diagnostics");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [gpu, systemHealth]);

  useEffect(() => {
    loadAll();
    if (!autoRefresh || refreshInterval === 0) return;
    const interval = setInterval(loadAll, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  const handleCheckService = async (service: string) => {
    setServiceChecks((prev) => ({
      ...prev,
      [service]: { service, status: "checking" },
    }));
    try {
      await checkService(service);
      setServiceChecks((prev) => ({
        ...prev,
        [service]: { service, status: "online", lastChecked: Date.now() },
      }));
    } catch {
      setServiceChecks((prev) => ({
        ...prev,
        [service]: { service, status: "offline", lastChecked: Date.now() },
      }));
    }
  };

  const formatTime = (date: Date | null) => {
    if (!date) return "Never";
    return date.toLocaleTimeString();
  };

  const getChangeIndicator = (current: number, previous: number | undefined, suffix: string = "") => {
    if (previous === undefined) return null;
    const diff = current - previous;
    if (Math.abs(diff) < 0.1) return null;
    const isUp = diff > 0;
    return (
      <span className={`text-[10px] ml-1 transition-all duration-300 ${isUp ? "text-amber-400" : "text-emerald-400"}`}>
        {isUp ? "↑" : "↓"}{Math.abs(diff).toFixed(1)}{suffix}
      </span>
    );
  };

  return (
    <div className={DS.pageWide}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className={DS.pageTitle}>
            <Settings size={22} className={DS.accentViolet} />
            System Diagnostics
          </h1>
          <p className={DS.pageSubtitle}>
            Real-time system monitoring with live GPU, CPU, and service status
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-2">
            {autoRefresh && refreshInterval > 0 ? (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-emerald-400">Auto</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-700 rounded-lg">
                <Pause size={10} className="text-gray-400" />
                <span className="text-[10px] text-gray-400">Paused</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock size={12} />
            <span>Updated: {formatTime(lastUpdated)}</span>
          </div>
          
          {/* Settings dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={DS.btnGhost + " p-2"}
            >
              <Settings size={16} />
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-xl z-50">
                <h4 className={DS.textSmMedium + " mb-3"}>Refresh Settings</h4>
                
                {/* Auto toggle */}
                <div className={DS.flexBetween + " mb-3"}>
                  <span className={DS.textSm}>Auto-refresh</span>
                  <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    className={`w-10 h-5 rounded-full transition-colors duration-200 ${autoRefresh ? "bg-violet-600" : "bg-gray-600"}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${autoRefresh ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                
                {/* Interval selection */}
                <div>
                  <span className={DS.textXs + " block mb-2"}>Interval</span>
                  <div className="flex flex-wrap gap-1">
                    {REFRESH_INTERVALS.map((interval) => (
                      <button
                        key={interval.value}
                        onClick={() => {
                          setRefreshInterval(interval.value);
                          if (interval.value > 0) setAutoRefresh(true);
                        }}
                        className={`px-2 py-1 rounded text-xs transition-colors ${
                          refreshInterval === interval.value && autoRefresh
                            ? "bg-violet-600 text-white"
                            : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                        }`}
                      >
                        {interval.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <button
            onClick={loadAll}
            disabled={isRefreshing}
            className={DS.btnGhost + " p-2"}
          >
            <RefreshCw size={16} className={isRefreshing ? DS.loading : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className={DS.cardError}>
          <AlertTriangle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Charts Section */}
      {history.length > 1 && (
        <div className={DS.card}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={DS.sectionTitle}>
              <TrendingUp size={16} className={DS.accentViolet} />
              Performance History
            </h2>
            <div className="flex items-center gap-1">
              {[
                { key: 'gpu', label: 'GPU', color: '#8b5cf6' },
                { key: 'vram', label: 'VRAM', color: '#06b6d4' },
                { key: 'cpu', label: 'CPU', color: '#10b981' },
                { key: 'memory', label: 'Memory', color: '#f59e0b' },
              ].map((metric) => (
                <button
                  key={metric.key}
                  onClick={() => setActiveChart(metric.key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 ${
                    activeChart === metric.key
                      ? 'text-white shadow-lg'
                      : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
                  }`}
                  style={activeChart === metric.key ? { backgroundColor: metric.color } : {}}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                <defs>
                  <linearGradient id={`gradient-${activeChart}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={getActiveColor()} stopOpacity={0.5} />
                    <stop offset="50%" stopColor={getActiveColor()} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={getActiveColor()} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis 
                  dataKey="label" 
                  tick={{ fontSize: 11, fill: '#9ca3af' }} 
                  interval="preserveStartEnd"
                  axisLine={{ stroke: '#374151' }}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 11, fill: '#9ca3af' }} 
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip 
                  content={<CustomTooltip />}
                  cursor={{ stroke: '#4b5563', strokeDasharray: '4 4' }}
                />
                <Area 
                  type="monotone" 
                  dataKey={activeChart} 
                  name={`${getActiveLabel()} %`}
                  stroke={getActiveColor()} 
                  strokeWidth={2.5} 
                  fill={`url(#gradient-${activeChart})`}
                  animationDuration={400}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, fill: '#1f2937' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          {/* Legend / Stats Row */}
          <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700/50">
            {[
              { key: 'gpu', label: 'GPU', color: '#8b5cf6', icon: Cpu },
              { key: 'vram', label: 'VRAM', color: '#06b6d4', icon: HardDrive },
              { key: 'cpu', label: 'CPU', color: '#10b981', icon: Server },
              { key: 'memory', label: 'Memory', color: '#f59e0b', icon: Activity },
            ].map((metric) => {
              const lastValue = history[history.length - 1]?.[metric.key as keyof DataPoint] as number;
              const prevValue = history[history.length - 2]?.[metric.key as keyof DataPoint] as number;
              const change = lastValue !== undefined && prevValue !== undefined ? lastValue - prevValue : 0;
              const Icon = metric.icon;
              return (
                <button
                  key={metric.key}
                  onClick={() => setActiveChart(metric.key)}
                  className={`text-left p-3 rounded-xl transition-all duration-200 ${
                    activeChart === metric.key ? 'bg-gray-700/50 ring-1 ring-gray-600' : 'hover:bg-gray-700/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={14} style={{ color: metric.color }} />
                    <span className="text-xs text-gray-400">{metric.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-bold text-white">{lastValue?.toFixed(0) ?? '—'}%</span>
                    {Math.abs(change) > 0.5 && (
                      <span className={`text-xs font-medium ${change > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GPU Status */}
        <div className={`${DS.card} transition-all duration-500 hover:border-violet-500/30`}>
          <div className={DS.flexBetween + " mb-4"}>
            <h2 className={DS.sectionTitle}>
              <Cpu size={16} className={DS.accentViolet} />
              GPU Status
            </h2>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className={DS.textXs}>Live</span>
            </div>
          </div>
          
          {gpu ? (
            <div className="space-y-4">
              {/* GPU Name & Temp */}
              <div className="flex items-center justify-between">
                <span className={DS.textSm}>{gpu.name || "GPU"}</span>
                <div className={DS.flexCenter}>
                  <Thermometer size={14} className={gpu.temperature_c > 80 ? DS.accentRed : DS.accentViolet} />
                  <span className={`text-sm font-bold ${gpu.temperature_c > 80 ? DS.accentRed : "text-white"}`}>
                    {gpu.temperature_c}°
                  </span>
                  {getChangeIndicator(gpu.temperature_c, prevGpu?.temperature_c, "°")}
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className={DS.statCard + " transition-all duration-300"}>
                  <p className={DS.statLabel}>VRAM Used</p>
                  <p className={DS.statValue + " transition-all duration-500"}>
                    {gpu.memory_used_mb ? (gpu.memory_used_mb / 1024).toFixed(1) : "—"}
                  </p>
                  <p className={DS.statSub}>/ {gpu.memory_total_mb ? (gpu.memory_total_mb / 1024).toFixed(1) : "—"} GB</p>
                </div>
                <div className={DS.statCard + " transition-all duration-300"}>
                  <p className={DS.statLabel}>Utilization</p>
                  <p className={`${DS.statValue} transition-all duration-500`}>
                    {gpu.gpu_utilization ?? "—"}%
                  </p>
                  <p className={DS.statSub}>GPU Compute</p>
                </div>
              </div>

              {/* VRAM Bar with animation */}
              <div>
                <div className={DS.flexBetween + " mb-1"}>
                  <span className={DS.textXs}>VRAM Usage</span>
                  <span className={DS.textXs}>
                    {gpu.memory_percent?.toFixed(0) ?? "—"}%
                    {getChangeIndicator(gpu.memory_percent ?? 0, prevGpu?.memory_percent, "%")}
                  </span>
                </div>
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${
                      (gpu.memory_percent ?? 0) > 90
                        ? "bg-gradient-to-r from-red-500 to-red-400"
                        : (gpu.memory_percent ?? 0) > 70
                        ? "bg-gradient-to-r from-amber-500 to-amber-400"
                        : "bg-gradient-to-r from-emerald-500 to-emerald-400"
                    }`}
                    style={{ width: `${gpu.memory_percent ?? 0}%` }}
                  />
                </div>
              </div>

              {/* Processes */}
              <div>
                <p className={DS.textXs + " mb-1"}>Active Processes: {gpu.processes?.length ?? 0}</p>
                <div className="flex flex-wrap gap-1">
                  {gpu.processes?.slice(0, 6).map((proc, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-700 rounded text-gray-400 truncate max-w-[100px]">
                      {proc.name.replace(/^.*\\/, "")}
                    </span>
                  ))}
                  {(gpu.processes?.length ?? 0) > 6 && (
                    <span className="text-[10px] text-gray-500">+{(gpu.processes?.length ?? 0) - 6} more</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={DS.textXs}>GPU data unavailable</div>
          )}
        </div>

        {/* System Health */}
        <div className={`${DS.card} transition-all duration-500 hover:border-blue-500/30`}>
          <div className={DS.flexBetween + " mb-4"}>
            <h2 className={DS.sectionTitle}>
              <Server size={16} className={DS.accentSky} />
              System Health
            </h2>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className={DS.textXs}>Live</span>
            </div>
          </div>
          
          {systemHealth ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className={DS.statCard + " transition-all duration-300"}>
                  <p className={DS.statLabel}>CPU Usage</p>
                  <p className={`${DS.statValue} transition-all duration-500`}>
                    {systemHealth.cpu.usage_percent}%
                  </p>
                  <p className={DS.statSub}>{systemHealth.cpu.count} cores</p>
                </div>
                <div className={DS.statCard + " transition-all duration-300"}>
                  <p className={DS.statLabel}>Memory</p>
                  <p className={`${DS.statValue} transition-all duration-500`}>
                    {systemHealth.memory.percent}%
                  </p>
                  <p className={DS.statSub}>
                    {systemHealth.memory.used_gb.toFixed(1)} / {systemHealth.memory.total_gb.toFixed(1)} GB
                  </p>
                </div>
              </div>

              {/* Memory Bar with animation */}
              <div>
                <div className={DS.flexBetween + " mb-1"}>
                  <span className={DS.textXs}>Memory Usage</span>
                  <span className={DS.textXs}>
                    {systemHealth.memory.percent}%
                    {getChangeIndicator(systemHealth.memory.percent, prevSystemHealth?.memory.percent, "%")}
                  </span>
                </div>
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${
                      systemHealth.memory.percent > 90
                        ? "bg-gradient-to-r from-red-500 to-red-400"
                        : systemHealth.memory.percent > 70
                        ? "bg-gradient-to-r from-amber-500 to-amber-400"
                        : "bg-gradient-to-r from-emerald-500 to-emerald-400"
                    }`}
                    style={{ width: `${systemHealth.memory.percent}%` }}
                  />
                </div>
              </div>

              {/* Disk */}
              {systemHealth.disk && !systemHealth.disk.error && (
                <div>
                  <div className={DS.flexBetween + " mb-1"}>
                    <span className={DS.flexCenter + " " + DS.textXs}>
                      <HardDrive size={12} className="mr-1" />
                      Disk
                    </span>
                    <span className={DS.textXs}>{systemHealth.disk.percent}% used</span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        (systemHealth.disk.percent ?? 0) > 90
                          ? "bg-red-500"
                          : (systemHealth.disk.percent ?? 0) > 70
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${systemHealth.disk.percent ?? 0}%` }}
                    />
                  </div>
                  <p className={DS.textXs + " mt-1"}>
                    {systemHealth.disk.free_gb?.toFixed(0)} GB free of {systemHealth.disk.total_gb?.toFixed(0)} GB
                  </p>
                </div>
              )}

              <p className={DS.textXs}>
                Platform: {systemHealth.platform} {systemHealth.platform_version}
              </p>
            </div>
          ) : (
            <div className={DS.textXs}>System health unavailable</div>
          )}
        </div>

        {/* 3D Service Status */}
        <div className={`${DS.card} transition-all duration-500 hover:border-amber-500/30`}>
          <div className={DS.flexBetween + " mb-4"}>
            <h2 className={DS.sectionTitle}>
              <Box size={16} className="text-amber-400" />
              3D Generation Service
            </h2>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${
              status3d.available 
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400" 
                : "bg-red-500/10 border border-red-500/30 text-red-400"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${status3d.available ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              {status3d.available ? "Ready" : "Unavailable"}
            </div>
          </div>
          
          {Object.keys(status3d).length > 0 ? (
            <div className="space-y-4">
              {/* Model Section */}
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Box size={12} />
                  Model
                </h3>
                <div className="space-y-1.5">
                  <div className={DS.flexBetween + " p-2 bg-gray-700/30 rounded-lg"}>
                    <span className={DS.textSm}>Status</span>
                    <span className={`text-sm font-medium ${status3d.model_exists ? DS.accentGreen : DS.accentRed}`}>
                      {status3d.model_exists ? "Found" : "Missing"}
                    </span>
                  </div>
                  {status3d.model_path != null && (
                    <div className="p-2 bg-gray-700/30 rounded-lg">
                      <span className={DS.textXs + " block text-gray-500 mb-0.5"}>Path</span>
                      <span className="text-xs text-gray-300 font-mono break-all">{String(status3d.model_path)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Environment Section */}
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Settings size={12} />
                  Environment
                </h3>
                <div className="space-y-1.5">
                  <div className={DS.flexBetween + " p-2 bg-gray-700/30 rounded-lg"}>
                    <span className={DS.textSm}>Status</span>
                    <span className={`text-sm font-medium ${status3d.env_exists ? DS.accentGreen : DS.accentRed}`}>
                      {status3d.env_exists ? "Ready" : "Missing"}
                    </span>
                  </div>
                  {status3d.env_path != null && (
                    <div className="p-2 bg-gray-700/30 rounded-lg">
                      <span className={DS.textXs + " block text-gray-500 mb-0.5"}>Python Path</span>
                      <span className="text-xs text-gray-300 font-mono break-all">{String(status3d.env_path)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Output Section */}
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <HardDrive size={12} />
                  Output
                </h3>
                <div className="space-y-1.5">
                  <div className={DS.flexBetween + " p-2 bg-gray-700/30 rounded-lg"}>
                    <span className={DS.textSm}>Generated Models</span>
                    <span className="text-sm font-medium text-white">{String(status3d.generated_count ?? 0)}</span>
                  </div>
                  {status3d.output_dir != null && (
                    <div className="p-2 bg-gray-700/30 rounded-lg">
                      <span className={DS.textXs + " block text-gray-500 mb-0.5"}>Output Directory</span>
                      <span className="text-xs text-gray-300 font-mono break-all">{String(status3d.output_dir)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={DS.textXs}>3D service status unavailable</div>
          )}
        </div>

        {/* Service Checks */}
        <div className={`${DS.card} transition-all duration-500 hover:border-emerald-500/30`}>
          <h2 className={DS.sectionTitle + " mb-4"}>
            <Activity size={16} className={DS.accentGreen} />
            Service Checks
          </h2>
          <div className="space-y-2">
            {["backend", "comfyui", "ollama", "blender", "unity"].map((service) => {
              const check = serviceChecks[service];
              return (
                <div key={service} className={DS.flexBetween + " p-2 bg-gray-700/30 rounded-lg"}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                      check?.status === "online" ? "bg-emerald-400" :
                      check?.status === "offline" ? "bg-red-400" :
                      check?.status === "checking" ? "bg-amber-400 animate-pulse" :
                      "bg-gray-600"
                    }`} />
                    <span className={DS.textSm + " capitalize"}>{service}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {check?.status === "checking" ? (
                      <Loader2 size={14} className={DS.loading + " text-amber-400"} />
                    ) : check?.status === "online" || check?.status === "offline" ? (
                      <span className={`flex items-center gap-1 text-sm transition-all duration-300 ${
                        check.status === "online" ? DS.accentGreen : DS.accentRed
                      }`}>
                        {check.status === "online" ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {check.status}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleCheckService(service)}
                        className={DS.badge + " hover:bg-violet-500/20 transition-colors"}
                      >
                        Check
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Raw Diagnostics */}
      {Object.keys(diagnostics).length > 0 && (
        <div className={DS.card}>
          <h2 className={DS.sectionTitle + " mb-4"}>
            <Zap size={16} className="text-amber-400" />
            Raw Diagnostics
          </h2>
          <pre className="bg-gray-900 rounded-lg p-4 text-xs text-gray-400 overflow-auto max-h-64 font-mono">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
