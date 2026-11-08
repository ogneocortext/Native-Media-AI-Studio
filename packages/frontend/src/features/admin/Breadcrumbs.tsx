import { useLocation, NavLink } from "react-router-dom";
import {
  ChevronRight,
  Home,
  Settings,
  Database,
  BarChart3,
  Zap,
  Cpu,
  AlertTriangle,
  FileText,
  Monitor,
  ListOrdered,
  FolderOpen,
  Video,
  Music,
  BookOpen,
  Rocket,
  Wand2,
  Clapperboard,
  Box,
  Type,
  Play,
  Image,
  Brain,
  Film,
  Gamepad2,
  Mic,
  MessageSquare,
} from "lucide-react";

interface BreadcrumbItem {
  label: string;
  path: string;
  icon?: React.ReactNode;
}

const ROUTE_LABELS: Partial<
  Record<string, { label: string; icon?: React.ReactNode }>
> = {
  "/system": { label: "Dashboard", icon: <Home size={14} /> },
  "/system/admin": { label: "Admin Dashboard", icon: <Monitor size={14} /> },
  "/system/health": { label: "Health", icon: <AlertTriangle size={14} /> },
  "/system/queue": { label: "Queue", icon: <ListOrdered size={14} /> },
  "/system/settings": { label: "Settings", icon: <Settings size={14} /> },
  "/system/data-management": { label: "Data Management", icon: <FileText size={14} /> },
  "/system/database": { label: "Database", icon: <Database size={14} /> },
  "/system/gpu": { label: "GPU Monitor", icon: <Cpu size={14} /> },
  "/system/log-analytics": { label: "Log Analytics", icon: <BarChart3 size={14} /> },
  "/system/notifications": { label: "Notifications", icon: <Zap size={14} /> },
  "/system/docs": { label: "Documentation", icon: <BookOpen size={14} /> },
  "/system/onboarding": { label: "Quick Start", icon: <Rocket size={14} /> },
  "/create/music-video": { label: "Music Video", icon: <Wand2 size={14} /> },
  "/create/video": { label: "Video Generation", icon: <Clapperboard size={14} /> },
  "/create/3d": { label: "3D Generation", icon: <Box size={14} /> },
  "/create/image": { label: "Image Generation", icon: <Image size={14} /> },
  "/create/typography": { label: "Kinetic Type", icon: <Type size={14} /> },
  "/create/music": { label: "Music Gen", icon: <Music size={14} /> },
  "/create/remix": { label: "Remix / Mashup", icon: <Wand2 size={14} /> },
  "/create/animation": { label: "Animation Studio", icon: <Film size={14} /> },
  "/create/unity": { label: "Unity Control", icon: <Gamepad2 size={14} /> },
  "/create/hyperframes": { label: "HyperFrames", icon: <Play size={14} /> },
  "/library": { label: "Media Library", icon: <FolderOpen size={14} /> },
  "/library/video": { label: "Video Library", icon: <Video size={14} /> },
  "/library/audio": { label: "Audio Library", icon: <Music size={14} /> },
  "/library/storyboards": { label: "Storyboards", icon: <BookOpen size={14} /> },
  "/analyze/audio": { label: "Audio Analysis", icon: <BarChart3 size={14} /> },
  "/analyze/ai": { label: "AI Tools", icon: <Brain size={14} /> },
  "/analyze/chat": { label: "Ollama Chat", icon: <Mic size={14} /> },
  "/analyze/agent": { label: "Local Sub-Agent", icon: <Cpu size={14} /> },
  "/analyze/agent-chat": { label: "Agent Chat", icon: <MessageSquare size={14} /> },
  "/mastering": { label: "Mastering", icon: <Zap size={14} /> },
  "/render/visualizer": { label: "Visualizer", icon: <Monitor size={14} /> },
  "/render/preview": { label: "Preview", icon: <Play size={14} /> },
  "/render/prompts": { label: "Music Prompts", icon: <Mic size={14} /> },
};

interface BreadcrumbItem {
  label: string;
  path: string;
  icon?: React.ReactNode;
}

export function Breadcrumbs() {
  const location = useLocation();

  const segments = location.pathname.split("/").filter(Boolean);
  const breadcrumbs: BreadcrumbItem[] = [];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const routeInfo = ROUTE_LABELS[currentPath];
    if (routeInfo) {
      breadcrumbs.push({
        label: routeInfo.label,
        path: currentPath,
        icon: routeInfo.icon,
      });
    } else {
      // Fallback: capitalize segment
      breadcrumbs.push({
        label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " "),
        path: currentPath,
      });
    }
  }

  if (breadcrumbs.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 px-4 py-2 text-sm" aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 flex-wrap" role="list">
        <li>
          <NavLink to="/system" className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors" aria-current="page">
            <Home size={14} />
          </NavLink>
        </li>
        {breadcrumbs.map((crumb, index) => {
          return (
            <li key={crumb.path} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />
              {index === breadcrumbs.length - 1 ? (
                <span className="font-medium text-foreground">{crumb.label}</span>
              ) : (
                <NavLink
                  to={crumb.path}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
                >
                  {crumb.icon}
                  <span className="truncate max-w-[150px]">{crumb.label}</span>
                </NavLink>
              )}
            </li>
          );
        })}
        </ol>
    </nav>
  );
}