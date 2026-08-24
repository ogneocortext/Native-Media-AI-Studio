import {
  Activity,
  BookOpen,
  Box,
  Circle,
  Film,
  FileText,
  FolderOpen,
  Home,
  Image,
  LayoutDashboard,
  ListOrdered,
  Music2,
  Palette,
  Settings,
  Wand2,
  Sparkles,
  Zap,
  Menu,
  X,
  BarChart3,
  Brain,
  Cpu,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useHealthStore } from "../../state/healthStore";

interface NavItem { path: string; label: string; icon: React.ReactNode; badge?: string; }

const primaryNav: NavItem[] = [
  { path: "/", label: "Dashboard", icon: <Home size={18} /> },
];

const createNav: NavItem[] = [
  { path: "/three-js-studio", label: "Three.js Studio", icon: <Sparkles size={18} /> },
  { path: "/studio-3d", label: "3D Studio (ComfyUI)", icon: <Box size={18} /> },
  { path: "/generate-3d", label: "Generate 3D", icon: <Box size={18} /> },
  { path: "/image-generation", label: "Image Generation", icon: <Image size={18} /> },
  { path: "/video-generation", label: "Video Generation", icon: <Film size={18} /> },
  { path: "/audio-analysis", label: "Audio Analysis", icon: <BarChart3 size={18} /> },
  { path: "/visualizer", label: "Visualizer", icon: <Zap size={18} /> },
  { path: "/ai-tools", label: "AI Tools", icon: <Brain size={18} /> },
];

const manageNav: NavItem[] = [
  { path: "/music-video", label: "Music Video (Classic)", icon: <Film size={18} /> },
  { path: "/video-editor", label: "Video Editor", icon: <Film size={18} /> },
  { path: "/art-direction", label: "Art Direction", icon: <Palette size={18} /> },
  { path: "/queue", label: "Queue", icon: <ListOrdered size={18} /> },
  { path: "/library", label: "Media Library", icon: <FolderOpen size={18} /> },
];

const systemNav: NavItem[] = [
  { path: "/logs", label: "Logs", icon: <FileText size={18} /> },
  { path: "/diagnostics", label: "Diagnostics", icon: <Cpu size={18} /> },
  { path: "/settings", label: "Settings", icon: <Settings size={18} /> },
  { path: "/docs", label: "Documentation", icon: <BookOpen size={18} /> },
];

function NavSection({ title, items, location, collapsed }: { title: string; items: NavItem[]; location: ReturnType<typeof useLocation>; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="mb-2">
        <ul className="space-y-1">
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  title={item.label}
                  className={`flex items-center justify-center p-2.5 rounded-lg transition-colors ${isActive ? "bg-violet-600 text-white shadow-md" : "text-gray-500 hover:text-white hover:bg-white/5"}`}
                >
                  {item.icon}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <p className="px-3 mb-1.5 text-[11px] font-bold tracking-widest text-gray-500 uppercase">{title}</p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? "bg-violet-600 text-white shadow-md shadow-violet-600/20" : "text-gray-400 hover:text-white hover:bg-white/5"}`}
              >
                <span className={isActive ? "text-white shrink-0" : "text-gray-500 shrink-0"}>{item.icon}</span>
                <span className="flex-1 truncate min-w-0">{item.label}</span>
                {item.badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${isActive ? "bg-white text-violet-600" : "bg-violet-500/20 text-violet-300 border border-violet-500/30"}`}>{item.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  const { overall, adapters, isLoading, wsConnected, fetchHealth, connectWebSocket, disconnectWebSocket } = useHealthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => { fetchHealth(); connectWebSocket(); return () => disconnectWebSocket(); }, [fetchHealth, connectWebSocket, disconnectWebSocket]);

  // Responsive detection
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 900 || window.innerHeight > window.innerWidth * 1.2;
      setIsMobile(mobile);
      if (mobile) setCollapsed(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close drawer on route change (mobile)
  useEffect(() => { if (isMobile) setMobileOpen(false); }, [location.pathname, isMobile]);

  const getOverallStatus = (): "online" | "offline" | "unknown" => {
    if (isLoading && Object.keys(adapters).length === 0) return "unknown";
    switch (overall) { case "healthy": return "online"; case "degraded": return "online"; case "unhealthy": return "offline"; default: return "unknown"; }
  };
  const getStatusLabel = (): string => {
    const status = getOverallStatus();
    if (isLoading && Object.keys(adapters).length === 0) return "Checking...";
    switch (status) { case "online": return overall === "degraded" ? "Degraded" : "Online"; case "offline": return "Offline"; default: return "Unknown"; }
  };
  const getStatusColor = (status: "online" | "offline" | "unknown") => {
    switch (status) { case "online": return overall === "degraded" ? "text-amber-400" : "text-emerald-400"; case "offline": return "text-red-400"; default: return "text-gray-500"; }
  };
  const getStatusBgColor = (status: "online" | "offline" | "unknown") => {
    switch (status) { case "online": return overall === "degraded" ? "bg-amber-400" : "bg-emerald-500"; case "offline": return "bg-red-500"; default: return "bg-gray-500"; }
  };

  const adapterList = Object.entries(adapters).map(([key, adapter]) => ({
    name: adapter.name || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    status: adapter.status,
  }));
  const hasBackend = adapterList.some((a) => a.name.toLowerCase() === "backend");
  if (!hasBackend) adapterList.unshift({ name: "Backend", status: overall !== "unhealthy" ? "online" : "offline" });
  const overallStatus = getOverallStatus();

  const sidebarWidth = collapsed && !isMobile ? "w-[64px] min-w-[64px]" : "w-[260px] min-w-[260px]";
  const showText = !collapsed || isMobile;

  return (
    <>
      {/* Mobile hamburger — fixed top-left */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-3 left-3 z-40 w-9 h-9 rounded-xl bg-[#1a1a25] border border-white/10 flex items-center justify-center text-white shadow-lg md:hidden"
        aria-label="Toggle navigation"
      >
        {mobileOpen ? <X size={16} /> : <Menu size={16} />}
      </button>

      {/* Backdrop for mobile drawer */}
      {isMobile && mobileOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`sidebar flex flex-col h-full bg-[#0b0d14] border-r border-white/5 z-30
          ${isMobile ? `fixed inset-y-0 left-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} w-[280px] shadow-2xl transition-transform duration-300` : `relative ${sidebarWidth} transition-all duration-300`}
          ${collapsed && !isMobile ? "is-collapsed" : ""}`}
      >
        {/* Header */}
        <div className="p-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <Link to="/" className={`flex items-center gap-3 flex-1 min-w-0 ${collapsed && !isMobile ? "justify-center" : ""}`}>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-600/20 shrink-0">
                <LayoutDashboard size={18} className="text-white" />
              </div>
              {showText && (
                <div className="min-w-0">
                  <h1 className="font-extrabold text-[14px] tracking-tight text-white truncate">Native Media AI</h1>
                  <p className="text-[11px] text-gray-500 -mt-0.5 truncate">Studio • 2026 Pipeline</p>
                </div>
              )}
            </Link>
            {!isMobile && (
              <button onClick={() => setCollapsed(!collapsed)} className="w-7 h-7 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 shrink-0">
                {collapsed ? <Menu size={12} /> : <X size={12} />}
              </button>
            )}
            {isMobile && (
              <button onClick={() => setMobileOpen(false)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>
          {showText && (
            <Link to="/music-video-wizard" className="mt-3 flex items-center justify-center gap-2 w-full px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold shadow-md shadow-violet-600/20 transition-colors">
              <Sparkles size={14} /> New Music Video
            </Link>
          )}
          {collapsed && !isMobile && (
            <Link to="/music-video-wizard" title="New Music Video" className="mt-3 w-9 h-9 mx-auto rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-md">
              <Sparkles size={14} />
            </Link>
          )}
        </div>

        {/* Navigation — scrollable, min-h-0 is key for vertical fit */}
        <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden min-h-0 scrollbar-thin">
          <NavSection title="Start here" items={primaryNav} location={location} collapsed={collapsed && !isMobile} />
          <NavSection title="Create" items={createNav} location={location} collapsed={collapsed && !isMobile} />
          <NavSection title="Manage" items={manageNav} location={location} collapsed={collapsed && !isMobile} />
          <NavSection title="System" items={systemNav} location={location} collapsed={collapsed && !isMobile} />
        </nav>

        {/* Health — shrink-0, collapses to dots when collapsed, hides extra on very short viewports */}
        <div className={`p-2.5 border-t border-white/5 shrink-0 bg-[#0b0d14]/80 backdrop-blur ${collapsed && !isMobile ? "px-2" : ""}`}>
          {showText ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide truncate">System Health</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className={`w-2 h-2 rounded-full ${getStatusBgColor(overallStatus)} ${overallStatus === "online" ? "animate-pulse" : ""}`} title={wsConnected ? "WebSocket Connected" : "WebSocket Disconnected"} />
                  <span className={`text-xs font-bold truncate ${getStatusColor(overallStatus)}`}>{getStatusLabel()}</span>
                </div>
              </div>
              <div className="space-y-1 max-h-[16vh] overflow-y-auto pr-1">
                {adapterList.slice(0, 3).map((adapter) => (
                  <div key={adapter.name} className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Circle size={6} fill="currentColor" className={`${getStatusColor(adapter.status as never)} shrink-0`} />
                      <span className="text-gray-500 truncate">{adapter.name}</span>
                    </div>
                    <span className={`capitalize text-xs shrink-0 ${getStatusColor(adapter.status as never)}`}>{adapter.status}</span>
                  </div>
                ))}
                {adapterList.length > 3 && <p className="text-[11px] text-gray-500">+{adapterList.length - 3} more</p>}
              </div>
              <Link to="/health" className="flex items-center gap-2 px-3 py-2 mt-2 rounded-xl text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                <Activity size={16} className="shrink-0" /> <span className="truncate">Diagnostics</span>
              </Link>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-1">
              <div className={`w-2.5 h-2.5 rounded-full ${getStatusBgColor(overallStatus)} ${overallStatus === "online" ? "animate-pulse" : ""}`} title={getStatusLabel()} />
              <Link to="/health" className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 hover:text-white">
                <Activity size={14} />
              </Link>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
