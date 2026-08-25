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
  Loader2,
  Menu,
  X,
  BarChart3,
  Brain,
  Settings,
  Sparkles,
  Zap,
  Wand2,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useHealthStore } from "../../state/healthStore";
import { getApiBase } from "../../services/api";

interface NavItem { path: string; label: string; icon: React.ReactNode; badge?: string; }

const primaryNav: NavItem[] = [
  { path: "/", label: "Dashboard", icon: <Home size={18} /> },
];

const createNav: NavItem[] = [
  { path: "/music-video-wizard", label: "Music Video", icon: <Wand2 size={18} /> },
  { path: "/audio-analysis", label: "Audio Analysis", icon: <BarChart3 size={18} /> },
  { path: "/visualizer", label: "Visualizer", icon: <Zap size={18} /> },
  { path: "/ai-tools", label: "AI Tools", icon: <Brain size={18} /> },
];

const generateNav: NavItem[] = [
  { path: "/image-generation", label: "Image Gen", icon: <Image size={18} /> },
  { path: "/video-generation", label: "Video Gen", icon: <Film size={18} /> },
  { path: "/generate-3d", label: "3D Gen", icon: <Box size={18} /> },
];

const manageNav: NavItem[] = [
  { path: "/library", label: "Media Library", icon: <FolderOpen size={18} /> },
  { path: "/queue", label: "Queue", icon: <ListOrdered size={18} /> },
  { path: "/storyboards", label: "Storyboards", icon: <BookOpen size={18} /> },
];

const systemNav: NavItem[] = [
  { path: "/health", label: "Health", icon: <Activity size={18} /> },
  { path: "/logs", label: "Logs", icon: <FileText size={18} /> },
  { path: "/settings", label: "Settings", icon: <Settings size={18} /> },
  { path: "/docs", label: "Docs", icon: <BookOpen size={18} /> },
];

function NavSection({ title, items, location, collapsed }: { title: string; items: NavItem[]; location: ReturnType<typeof useLocation>; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="nav-section">
        <ul>
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  title={item.label}
                  className={`nav-item collapsed ${isActive ? "active" : ""}`}
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
    <div className="nav-section">
      <p className="nav-section-title">{title}</p>
      <ul>
        {items.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`nav-item ${isActive ? "active" : ""}`}
              >
                <span className={`nav-item-icon ${isActive ? "active" : "inactive"}`}>{item.icon}</span>
                <span className="nav-item-text">{item.label}</span>
                {item.badge && (
                  <span className={`nav-badge ${isActive ? "active" : "inactive"}`}>
                    {item.badge}
                  </span>
                )}
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
  const { overall, adapters, isLoading, fetchHealth, connectSSE, disconnectSSE } = useHealthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => { fetchHealth(); connectSSE(); return () => disconnectSSE(); }, [fetchHealth, connectSSE, disconnectSSE]);

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

  const formatAdapterName = (key: string, fallbackName: string | undefined): string => {
    if (fallbackName) return fallbackName;
    // Handle known proper nouns
    const properNouns: Record<string, string> = { comfyui: "ComfyUI", ollama: "Ollama" };
    if (properNouns[key]) return properNouns[key];
    return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const adapterList = Object.entries(adapters).map(([key, adapter]) => ({
    name: formatAdapterName(key, adapter.name),
    status: adapter.status,
  }));
  const hasBackend = adapterList.some((a) => a.name.toLowerCase() === "backend");
  if (!hasBackend) adapterList.unshift({ name: "Backend", status: overall !== "unhealthy" ? "online" : "offline" });
  const overallStatus = getOverallStatus();
  const showText = !collapsed || isMobile;

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle navigation"
        className="sidebar-hamburger"
      >
        {mobileOpen ? <X size={16} /> : <Menu size={16} />}
      </button>

      {/* Backdrop for mobile drawer */}
      {isMobile && mobileOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`sidebar-container ${collapsed && !isMobile ? "collapsed" : "expanded"} ${isMobile ? "sidebar-mobile" : ""} ${isMobile && mobileOpen ? "open" : ""}`}
      >
        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-header-inner">
            <Link
              to="/"
              className={`sidebar-header-link ${collapsed && !isMobile ? "center" : ""}`}
            >
              <div className="sidebar-logo">
                <LayoutDashboard size={18} color="white" />
              </div>
              {showText && (
                <div style={{ minWidth: 0 }}>
                  <h1 className="sidebar-title">Native Media AI</h1>
                  <p className="sidebar-subtitle">Studio • 2026 Pipeline</p>
                </div>
              )}
            </Link>
            {!isMobile && (
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="sidebar-toggle"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <Menu size={12} /> : <X size={12} />}
              </button>
            )}
            {isMobile && (
              <button
                onClick={() => setMobileOpen(false)}
                className="sidebar-toggle"
                aria-label="Close navigation"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {showText && (
            <Link to="/music-video-wizard" className="sidebar-cta">
              <Sparkles size={14} /> New Music Video
            </Link>
          )}
          {collapsed && !isMobile && (
            <Link to="/music-video-wizard" title="New Music Video" className="sidebar-cta-collapsed">
              <Sparkles size={14} />
            </Link>
          )}
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <NavSection title="Start" items={primaryNav} location={location} collapsed={collapsed && !isMobile} />
          <NavSection title="Create" items={createNav} location={location} collapsed={collapsed && !isMobile} />
          <NavSection title="Generate" items={generateNav} location={location} collapsed={collapsed && !isMobile} />
          <NavSection title="Manage" items={manageNav} location={location} collapsed={collapsed && !isMobile} />
          <NavSection title="System" items={systemNav} location={location} collapsed={collapsed && !isMobile} />
        </nav>

        {/* Health */}
        <div className="sidebar-footer">
          {showText ? (
            <>
              <div className="health-section">
                <span className="health-label">System Health</span>
                <div className="health-status">
                  <div
                    className={`health-dot ${overallStatus}`}
                    style={{ animation: overallStatus === "online" ? "pulse-glow 2s ease-in-out infinite" : "none" }}
                  />
                  <span className={`health-text ${overallStatus}`}>{getStatusLabel()}</span>
                </div>
              </div>
              <div className="adapter-list">
                {adapterList.slice(0, 3).map((adapter) => (
                  <div key={adapter.name} className="adapter-item">
                    <div className="adapter-name">
                      <Circle size={6} fill="currentColor" className={`adapter-status ${adapter.status}`} />
                      <span className="adapter-name-text">{adapter.name}</span>
                    </div>
                    <span className={`adapter-status ${adapter.status}`}>{adapter.status}</span>
                  </div>
                ))}
                 {adapterList.length > 3 && <p className="adapter-more">+{adapterList.length - 3} more</p>}
              </div>

              {/* ComfyUI Quick Control */}
              <ComfyUIQuickControl collapsed={collapsed && !isMobile} />

              <Link to="/health" className="sidebar-diagnostics-link">
                <Activity size={16} style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Diagnostics</span>
              </Link>
            </>
          ) : (
            <div className="sidebar-footer-collapsed">
              <div className={`health-dot ${overallStatus}`} />
              <ComfyUIQuickControl collapsed={collapsed && !isMobile} />
              <Link to="/health" className="sidebar-footer-collapsed-inner">
                <Activity size={14} />
              </Link>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ComfyUI Quick Control component for sidebar
function ComfyUIQuickControl({ collapsed }: { collapsed: boolean }) {
  const [comfyui, setComfyui] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/services/comfyui/status`);
      if (res.ok) setComfyui(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async () => {
    if (!comfyui?.installed) return;
    setLoading(true);
    try {
      const base = getApiBase();
      const action = comfyui.running ? 'stop' : 'start';
      await fetch(`${base}/api/services/comfyui/${action}`, { method: 'POST' });
      await fetchStatus();
    } catch { /* ignore */ }
    setLoading(false);
  };

  if (!comfyui?.installed) return null;

  return (
    <div className={`comfyui-quick ${collapsed ? 'center' : ''}`}>
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`comfyui-quick-btn ${comfyui.running ? 'running' : 'stopped'}`}
        title={comfyui.running ? 'ComfyUI running - click to stop' : 'ComfyUI stopped - click to start'}
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Box size={12} />
        )}
        {!collapsed && (
          <span className="comfyui-quick-text">
            ComfyUI {comfyui.running ? 'ON' : 'OFF'}
          </span>
        )}
      </button>
    </div>
  );
}
