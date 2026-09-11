import {
  Activity,
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  Film,
  FileText,
  FolderOpen,
  Home,
  Image,
  LayoutDashboard,
  ListOrdered,
  Menu,
  X,
  BarChart3,
  Brain,
  Settings,
  Sparkles,
  Zap,
  Wand2,
  Type,
  Thermometer,
  Play,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useHealthStore } from "../../state/healthStore";
import { useUIStore } from "../../state/uiStore";
import { getVideoEditorUrl } from "../../services/portConfig";

interface NavItem { path: string; label: string; icon: React.ReactNode; badge?: string; }

const primaryNav: NavItem[] = [
  { path: "/", label: "Dashboard", icon: <Home size={18} /> },
];

const createNav: NavItem[] = [
  { path: "/music-video-wizard", label: "Music Video", icon: <Wand2 size={18} /> },
  { path: "/three-js-studio", label: "Three.js Studio", icon: <Sparkles size={18} /> },
  { path: "/audio-analysis", label: "Audio Analysis", icon: <BarChart3 size={18} /> },
  { path: "/visualizer", label: "Visualizer", icon: <Zap size={18} /> },
  { path: "/kinetic-typography", label: "Kinetic Type", icon: <Type size={18} /> },
  { path: "/hyperframes", label: "HyperFrames", icon: <Play size={18} /> },
  { path: "/ai-tools", label: "AI Tools", icon: <Brain size={18} /> },
];

// External links (dynamic ports)
const externalNav: NavItem[] = [
  { path: getVideoEditorUrl(), label: "Remotion Studio", icon: <Film size={18} /> },
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
  { path: "/gpu", label: "GPU", icon: <Thermometer size={18} /> },
  { path: "/logs", label: "Logs", icon: <FileText size={18} /> },
  { path: "/log-analytics", label: "Log Analytics", icon: <BarChart3 size={18} /> },
  { path: "/settings", label: "Settings", icon: <Settings size={18} /> },
  { path: "/docs", label: "Docs", icon: <BookOpen size={18} /> },
];

function NavSection({ title, items, location, collapsed, collapsible, defaultOpen }: { title: string; items: NavItem[]; location: ReturnType<typeof useLocation>; collapsed?: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const isExternal = (path: string) => path.startsWith("http");
  const [open, setOpen] = useState(defaultOpen ?? true);
  // Auto-open if current route is inside this section
  const containsActive = items.some((i) => location.pathname === i.path || location.pathname.startsWith(i.path + "/"));
  useEffect(() => { if (containsActive && collapsible) setOpen(true); }, [containsActive, collapsible]);

  if (collapsed) {
    return (
      <div className="nav-section">
        <ul>
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            const external = isExternal(item.path);
            return (
              <li key={item.path}>
                {external ? (
                  <a href={item.path} target="_blank" rel="noopener noreferrer" title={item.label} className="nav-item collapsed">
                    {item.icon}
                  </a>
                ) : (
                  <Link
                    to={item.path}
                    title={item.label}
                    className={`nav-item collapsed ${isActive ? "active" : ""}`}
                  >
                    {item.icon}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const header = collapsible ? (
    <button
      onClick={() => setOpen((v: boolean) => !v)}
      className="nav-section-title nav-section-toggle w-full flex items-center justify-between hover:text-white transition-colors"
      aria-expanded={open}
    >
      <span>{title}</span>
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    </button>
  ) : (
    <p className="nav-section-title">{title}</p>
  );

  return (
    <div className="nav-section">
      {header}
      {(!collapsible || open) && (
        <ul>
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            const external = isExternal(item.path);
            return (
              <li key={item.path}>
                {external ? (
                  <a href={item.path} target="_blank" rel="noopener noreferrer" className="nav-item">
                    <span className="nav-item-icon inactive">{item.icon}</span>
                    <span className="nav-item-text">{item.label}</span>
                    <span style={{ marginLeft: "auto", opacity: 0.5, fontSize: 10 }}>↗</span>
                  </a>
                ) : (
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
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  const { overall, adapters, isLoading, fetchHealth } = useHealthStore();
  const { focusMode } = useUIStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

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

  const [systemFooterOpen, setSystemFooterOpen] = useState(false);

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
  if (!hasBackend) {
    const backendStatus = isLoading && Object.keys(adapters).length === 0 ? "unknown" : (overall !== "unhealthy" ? "online" as const : "offline" as const);
    adapterList.unshift({ name: "Backend", status: backendStatus });
  }
  const overallStatus = getOverallStatus();
  const showText = !collapsed || isMobile;

  return (
    <>
      {isMobile && (
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle navigation"
          className="sidebar-hamburger"
        >
          {mobileOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      )}

      {/* Backdrop for mobile drawer */}
      {isMobile && mobileOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`sidebar-container ${collapsed && !isMobile ? "collapsed" : "expanded"} ${isMobile ? "sidebar-mobile" : ""} ${isMobile && mobileOpen ? "open" : ""} ${focusMode ? "focus-mode-hidden" : ""}`}
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
        </div>

        {/* Navigation — progressive disclosure: Create+Manage open, System collapsed by default */}
        <nav className="sidebar-nav">
          <NavSection title="Start" items={primaryNav} location={location} collapsed={collapsed && !isMobile} collapsible defaultOpen={true} />
          <NavSection title="Create" items={createNav} location={location} collapsed={collapsed && !isMobile} collapsible defaultOpen={false} />
          <NavSection title="Generate" items={generateNav} location={location} collapsed={collapsed && !isMobile} collapsible defaultOpen={false} />
          <NavSection title="Manage" items={manageNav} location={location} collapsed={collapsed && !isMobile} collapsible defaultOpen={false} />
          {/* External is a single link — render as subtle footer link instead of full section */}
          {!collapsed || isMobile ? (
            <div className="nav-section">
              <a
                href={getVideoEditorUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-item nav-external-link"
                title="Open Remotion Studio in new tab"
              >
                <span className="nav-item-icon inactive"><Film size={14} /></span>
                <span className="nav-item-text text-xs">Remotion Studio ↗</span>
              </a>
            </div>
          ) : (
            <NavSection title="External" items={externalNav} location={location} collapsed={true} />
          )}
          <NavSection title="System" items={systemNav} location={location} collapsed={collapsed && !isMobile} collapsible defaultOpen={false} />
        </nav>

        {/* Health / System */}
        <div className="sidebar-footer">
          {showText ? (
            <>
              <button
                onClick={() => setSystemFooterOpen((v) => !v)}
                className="sidebar-footer-toggle"
                aria-expanded={systemFooterOpen}
                aria-label="Toggle system status"
              >
                <span className="health-label">System</span>
                <span className="sidebar-footer-toggle-indicator">
                  {systemFooterOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
              </button>
              {systemFooterOpen && (
                <>
                  <div className="system-status-summary">
                    <div className={`system-status-indicator ${overallStatus}`} />
                    <div className="system-status-text">
                      <div className={`system-status-label ${overallStatus}`}>{getStatusLabel()}</div>
                      <div className="system-status-count">{adapterList.length} adapter{adapterList.length === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                  <div className="adapter-list">
                    {adapterList.map((adapter) => (
                      <div key={adapter.name} className="adapter-item">
                        <div className="adapter-name">
                          <span className={`adapter-status-dot ${adapter.status}`} />
                          <span className="adapter-name-text">{adapter.name}</span>
                        </div>
                        <span className={`adapter-status-text ${adapter.status}`}>{adapter.status}</span>
                      </div>
                    ))}
                  </div>
                  <Link to="/health" className="sidebar-diagnostics-link">
                    <Activity size={14} />
                    <span>View Diagnostics</span>
                  </Link>
                </>
              )}
            </>
          ) : (
            <div className="sidebar-footer-collapsed">
              <div className={`health-dot ${overallStatus}`} />
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