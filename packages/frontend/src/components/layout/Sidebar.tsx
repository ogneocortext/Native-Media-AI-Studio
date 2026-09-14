import {
  Activity,
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  Clapperboard,
  FileText,
  FolderOpen,
  Home,
  Image,
  ListOrdered,
  Menu,
  X,
  BarChart3,
  Brain,
  Search,
  Settings,
  Sparkles,
  Zap,
  Wand2,
  Type,
  Thermometer,
  Play,
  Mic,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useHealthStore } from "../../state/healthStore";
import { useUIStore } from "../../state/uiStore";
import { getVideoEditorUrl } from "../../services/portConfig";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  keywords?: string;
  external?: boolean;
}

interface NavGroup {
  id: string;
  title: string;
  /** Groups collapsed by default (still one click, but out of the way). */
  collapsedByDefault?: boolean;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    title: "Home",
    items: [
      { path: "/", label: "Dashboard", icon: <Home size={18} />, keywords: "home overview start" },
    ],
  },
  {
    id: "create",
    title: "Create",
    items: [
      { path: "/music-video-wizard", label: "Music Video", icon: <Wand2 size={18} />, keywords: "wizard song video maker" },
      { path: "/three-js-studio", label: "Three.js Studio", icon: <Sparkles size={18} />, keywords: "3d scene studio character" },
      { path: "/audio-analysis", label: "Audio Analysis", icon: <BarChart3 size={18} />, keywords: "audio beat bpm analyze" },
      { path: "/visualizer", label: "Visualizer", icon: <Zap size={18} />, keywords: "visualizer shader realtime" },
      { path: "/kinetic-typography", label: "Kinetic Type", icon: <Type size={18} />, keywords: "lyrics kinetic typography text" },
      { path: "/hyperframes", label: "HyperFrames", icon: <Play size={18} />, keywords: "hyperframes animation frames" },
      { path: "/ai-tools", label: "AI Tools", icon: <Brain size={18} />, keywords: "ai tools models chat" },
      { path: "/music-prompts", label: "Music Prompts", icon: <Mic size={18} />, keywords: "music prompts lyrics suno" },
    ],
  },
  {
    id: "generate",
    title: "Generate",
    items: [
      { path: "/image-generation", label: "Image Gen", icon: <Image size={18} />, keywords: "image picture comfyui" },
      { path: "/video-generation", label: "Video Gen", icon: <Clapperboard size={18} />, keywords: "video generate motion" },
      { path: "/generate-3d", label: "3D Gen", icon: <Box size={18} />, keywords: "3d model mesh generate" },
    ],
  },
  {
    id: "manage",
    title: "Manage",
    items: [
      { path: "/library", label: "Media Library", icon: <FolderOpen size={18} />, keywords: "library media files audio video image" },
      { path: "/queue", label: "Queue", icon: <ListOrdered size={18} />, keywords: "queue jobs tasks" },
      { path: "/storyboards", label: "Storyboards", icon: <BookOpen size={18} />, keywords: "storyboard plan scenes" },
    ],
  },
  {
    id: "system",
    title: "System",
    collapsedByDefault: true,
    items: [
      { path: "/health", label: "Health", icon: <Activity size={18} />, keywords: "health status diagnostics adapters" },
      { path: "/gpu", label: "GPU", icon: <Thermometer size={18} />, keywords: "gpu vram cuda temperature" },
      { path: "/log-analytics", label: "Log Analytics", icon: <BarChart3 size={18} />, keywords: "logs analytics charts" },
      { path: "/settings", label: "Settings", icon: <Settings size={18} />, keywords: "settings config preferences" },
      { path: "/docs", label: "Docs", icon: <FileText size={18} />, keywords: "docs help guide documentation" },
    ],
  },
];

function isPathActive(current: string, target: string) {
  if (target === "/") return current === "/";
  return current === target || current.startsWith(target + "/");
}

function NavEntry({ item, active, collapsed, onNavigate }: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const className = `nav-item${collapsed ? " collapsed" : ""}${active ? " active" : ""}`;
  const label = collapsed ? item.label : undefined;
  const body = (
    <>
      <span className={`nav-item-icon ${active ? "active" : "inactive"}`}>{item.icon}</span>
      {!collapsed && <span className="nav-item-text">{item.label}</span>}
      {!collapsed && item.badge && (
        <span className={`nav-badge ${active ? "active" : "inactive"}`}>{item.badge}</span>
      )}
      {!collapsed && item.external && <span className="nav-external-hint" aria-hidden>↗</span>}
    </>
  );
  if (item.external) {
    return (
      <li>
        <a href={item.path} target="_blank" rel="noopener noreferrer" title={label} className={className}>
          {body}
        </a>
      </li>
    );
  }
  return (
    <li>
      <NavLink to={item.path} title={label} className={className} onClick={onNavigate} end={item.path === "/"}>
        {body}
      </NavLink>
    </li>
  );
}

function SidebarGroup({ group, location, collapsed, onNavigate, forceOpen }: {
  group: NavGroup;
  location: ReturnType<typeof useLocation>;
  collapsed: boolean;
  onNavigate: () => void;
  forceOpen: boolean;
}) {
  const groupActive = group.items.some((i) => !i.external && isPathActive(location.pathname, i.path));
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  // Default: everything visible. Only groups flagged collapsedByDefault
  // (System) start folded; the active group always opens itself.
  const open = forceOpen || (userToggled ?? !group.collapsedByDefault) || groupActive;
  const toggle = () => setUserToggled((v) => !(v ?? !group.collapsedByDefault));

  if (collapsed) {
    // Slim icon rail: no headers, every destination one click away.
    return (
      <div className="nav-section nav-section-rail">
        <ul>
          {group.items.map((item) => (
            <NavEntry
              key={item.path + item.label}
              item={item}
              active={!item.external && isPathActive(location.pathname, item.path)}
              collapsed
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={`nav-section${groupActive ? " nav-section-active" : ""}`}>
      <button
        onClick={toggle}
        className="nav-section-title nav-section-toggle w-full flex items-center justify-between hover:text-white transition-colors"
        aria-expanded={open}
        aria-controls={`nav-group-${group.id}`}
        title={open ? `Collapse ${group.title}` : `Expand ${group.title}`}
      >
        <span>{group.title}</span>
        <span className="nav-section-toggle-icon">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && (
        <ul id={`nav-group-${group.id}`}>
          {group.items.map((item) => (
            <NavEntry
              key={item.path + item.label}
              item={item}
              active={!item.external && isPathActive(location.pathname, item.path)}
              collapsed={false}
              onNavigate={onNavigate}
            />
          ))}
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
  const [filter, setFilter] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  useEffect(() => {
    // Single source of truth for the mobile drawer breakpoint — must match
    // the `@media (max-width: 900px)` rules in sidebar.css. Width-only: an
    // aspect-ratio check here would disagree with CSS on tall/narrow desktop
    // windows and hide the sidebar with no visible hamburger to reopen it.
    const mq = window.matchMedia("(max-width: 900px)");
    const check = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      if (mobile) setCollapsed(false);
    };
    check();
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
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
  const rail = collapsed && !isMobile;
  const closeMobile = () => setMobileOpen(false);

  // "/" keyboard shortcut focuses the nav filter (unless typing elsewhere).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !rail) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rail]);

  const q = filter.trim().toLowerCase();
  // Remotion Studio URL is dynamic (ports.json) so it can't be a static const.
  const remotionItem: NavItem = useMemo(
    () => ({
      path: getVideoEditorUrl(),
      label: "Remotion Studio",
      icon: <Clapperboard size={18} />,
      keywords: "remotion studio editor render external",
      external: true,
    }),
    [],
  );
  const visibleGroups = useMemo(() => {
    const withExternal = NAV_GROUPS.map((g) =>
      g.id === "manage" ? { ...g, items: [...g.items, remotionItem] } : g,
    );
    if (!q) return withExternal;
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = (i: NavItem) => {
      const hay = `${i.label} ${(i.keywords ?? "")}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    };
    return withExternal
      .map((g) => ({ ...g, items: g.items.filter(matches) }))
      .filter((g) => g.items.length > 0);
  }, [q, remotionItem]);

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
        {/* Brand header */}
        <div className="sidebar-header">
          <div className="sidebar-header-inner">
            <Link
              to="/"
              className={`sidebar-brand${collapsed && !isMobile ? " sidebar-brand-centered" : ""}`}
              title="Native Media AI Studio — home"
            >
              <span className="sidebar-logo" aria-hidden>
                <Sparkles size={18} color="white" strokeWidth={2.2} />
              </span>
              {showText && (
                <span className="sidebar-brand-text">
                  <span className="sidebar-title">Native Media AI</span>
                  <span className="sidebar-tagline">Studio · 2026 Pipeline</span>
                </span>
              )}
            </Link>
            {!isMobile && (
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="sidebar-toggle"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <Menu size={12} /> : <ChevronsLeft size={12} />}
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

        {/* Navigation — all groups visible; only System starts folded. */}
        <nav className="sidebar-nav" aria-label="Primary">
          {showText && (
            <div className="sidebar-search">
              <Search size={14} className="sidebar-search-icon" aria-hidden />
              <input
                ref={searchRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
                placeholder="Filter…  ( / )"
                aria-label="Filter navigation"
                className="sidebar-search-input"
                autoComplete="off"
                spellCheck={false}
              />
              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="sidebar-search-clear"
                  aria-label="Clear filter"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          {visibleGroups.map((group) => (
            <SidebarGroup
              key={group.id}
              group={group}
              location={location}
              collapsed={rail}
              onNavigate={closeMobile}
              forceOpen={q.length > 0}
            />
          ))}
          {visibleGroups.length === 0 && (
            <p className="sidebar-no-results">No matches for “{filter.trim()}”.</p>
          )}
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