import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Keyboard,
  Home,
  Settings,
  Database,
  BarChart3,
  Zap,
  Cpu,
  FileText,
  Monitor,
  ListOrdered,
  Key,
  BookOpen,
  Image,
  Music,
  Wand2,
  Clapperboard,
  Box,
  Play,
  Gamepad2,
  Film,
  Rocket,
  Brain,
  Mic2,
  Activity,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  keywords: string;
  action: () => void;
  shortcut?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

function getCommands(navigate: ReturnType<typeof useNavigate>): CommandItem[] {
  return [
    // Navigation
    { id: "home", label: "Dashboard", description: "System overview & quick actions", icon: <Home size={16} />, category: "Navigation", keywords: "dashboard home overview", action: () => { void navigate("/system"); }, shortcut: "G D" },
    { id: "admin", label: "Admin Dashboard", description: "Deep-dive: tests, services, audio, config", icon: <Monitor size={16} />, category: "Navigation", keywords: "admin dashboard deep tests", action: () => { void navigate("/system/admin"); }, shortcut: "G A" },
    { id: "health", label: "System Health", description: "CPU, memory, disk, GPU, services", icon: <Activity size={16} />, category: "Navigation", keywords: "health status cpu memory gpu", action: () => { void navigate("/system/health"); }, shortcut: "G H" },
    { id: "queue", label: "Job Queue", description: "Manage generation jobs", icon: <ListOrdered size={16} />, category: "Navigation", keywords: "queue jobs tasks", action: () => { void navigate("/system/queue"); }, shortcut: "G Q" },
    { id: "settings", label: "Settings", description: "App configuration, preferences", icon: <Settings size={16} />, category: "Navigation", keywords: "settings config preferences", action: () => { void navigate("/system/settings"); }, shortcut: "G S" },
    { id: "gpu", label: "GPU Monitor", description: "VRAM, temperature, CUDA processes", icon: <Cpu size={16} />, category: "Navigation", keywords: "gpu vram temperature cuda", action: () => { void navigate("/system/gpu"); }, shortcut: "G G" },
    { id: "logs", label: "Log Analytics", description: "Log counts, search, analytics", icon: <FileText size={16} />, category: "Navigation", keywords: "logs analytics", action: () => { void navigate("/system/log-analytics"); }, shortcut: "G L" },
    { id: "database", label: "Database", description: "SQLite schema, tables, vacuum", icon: <Database size={16} />, category: "Navigation", keywords: "database sqlite tables", action: () => { void navigate("/system/database"); }, shortcut: "G B" },
    { id: "docs", label: "Documentation", description: "API docs, guides, architecture", icon: <BookOpen size={16} />, category: "Navigation", keywords: "docs documentation help", action: () => { void navigate("/system/docs"); }, shortcut: "G O" },
    { id: "onboarding", label: "Quick Start", description: "5-minute guided path", icon: <Rocket size={16} />, category: "Navigation", keywords: "onboarding quick start guide", action: () => { void navigate("/system/onboarding"); }, shortcut: "G K" },

    // Create
    { id: "music-video", label: "Music Video Wizard", description: "Create music video from audio", icon: <Wand2 size={16} />, category: "Create", keywords: "music video wizard create", action: () => { void navigate("/create/music-video"); }, shortcut: "C M" },
    { id: "video-gen", label: "Video Generation", description: "Generate AI videos", icon: <Clapperboard size={16} />, category: "Create", keywords: "video generate ai", action: () => { void navigate("/create/video"); }, shortcut: "C V" },
    { id: "3d-gen", label: "3D Generation", description: "Generate 3D models", icon: <Box size={16} />, category: "Create", keywords: "3d model generate", action: () => { void navigate("/create/3d"); }, shortcut: "C 3" },
    { id: "image-gen", label: "Image Generation", description: "Generate AI images", icon: <Image size={16} />, category: "Create", keywords: "image generate ai", action: () => { void navigate("/create/image"); }, shortcut: "C I" },
    { id: "music-gen", label: "Music Gen", description: "Generate music tracks", icon: <Music size={16} />, category: "Create", keywords: "music generate audio", action: () => { void navigate("/create/music"); }, shortcut: "C N" },
    { id: "remix", label: "Remix / Mashup", description: "Create remixes from stems", icon: <Wand2 size={16} />, category: "Create", keywords: "remix mashup stems", action: () => { void navigate("/create/remix"); }, shortcut: "C R" },
    { id: "animation", label: "Animation Studio", description: "Create animations", icon: <Film size={16} />, category: "Create", keywords: "animation studio", action: () => { void navigate("/create/animation"); }, shortcut: "C A" },
    { id: "unity", label: "Unity Control", description: "Control Unity scenes", icon: <Gamepad2 size={16} />, category: "Create", keywords: "unity control", action: () => { void navigate("/create/unity"); }, shortcut: "C U" },
    { id: "hyperframes", label: "HyperFrames", description: "Create video compositions", icon: <Play size={16} />, category: "Create", keywords: "hyperframes video", action: () => { void navigate("/create/hyperframes"); }, shortcut: "C H" },

    // Analyze
    { id: "audio-analysis", label: "Audio Analysis", description: "BPM, beats, sections", icon: <BarChart3 size={16} />, category: "Analyze", keywords: "audio analysis bpm beats", action: () => { void navigate("/analyze/audio"); }, shortcut: "A A" },
    { id: "ai-tools", label: "AI Tools", description: "AI-powered tools", icon: <Brain size={16} />, category: "Analyze", keywords: "ai tools models", action: () => { void navigate("/analyze/ai"); }, shortcut: "A T" },
    { id: "ollama-chat", label: "Ollama Chat", description: "Chat with local LLMs", icon: <Mic2 size={16} />, category: "Analyze", keywords: "ollama chat llm", action: () => { void navigate("/analyze/chat"); }, shortcut: "A O" },
    { id: "mastering", label: "Mastering", description: "Audio mastering chain", icon: <Zap size={16} />, category: "Analyze", keywords: "mastering audio chain", action: () => { void navigate("/mastering"); }, shortcut: "A M" },

    // System
    { id: "data-mgmt", label: "Data Management", description: "Saved prompts, visuals, history", icon: <FileText size={16} />, category: "System", keywords: "data management prompts visuals", action: () => { void navigate("/system/data-management"); }, shortcut: "S D" },
    { id: "database-admin", label: "Database Admin", description: "Schema, vacuum, integrity", icon: <Database size={16} />, category: "System", keywords: "database admin vacuum", action: () => { void navigate("/system/database"); }, shortcut: "S B" },
    { id: "gpu-monitor", label: "GPU Monitor", description: "VRAM, temp, CUDA processes", icon: <Cpu size={16} />, category: "System", keywords: "gpu monitor vram temp", action: () => { void navigate("/system/gpu"); }, shortcut: "S G" },
    { id: "log-analytics", label: "Log Analytics", description: "Log counts, search", icon: <FileText size={16} />, category: "System", keywords: "logs analytics", action: () => { void navigate("/system/log-analytics"); }, shortcut: "S L" },
    { id: "notifications", label: "Notifications", description: "System alerts", icon: <Zap size={16} />, category: "System", keywords: "notifications alerts", action: () => { void navigate("/system/notifications"); }, shortcut: "S N" },
    { id: "docs-admin", label: "Documentation", description: "API docs, guides", icon: <BookOpen size={16} />, category: "System", keywords: "docs documentation", action: () => { void navigate("/system/docs"); }, shortcut: "S O" },
  ];
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const COMMANDS = getCommands(navigate);

  const filteredCommands = useMemo(() => {
    if (!query) return COMMANDS;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return COMMANDS.filter(cmd =>
      terms.every(term =>
        cmd.label.toLowerCase().includes(term) ||
        cmd.description.toLowerCase().includes(term) ||
        cmd.keywords.toLowerCase().includes(term) ||
        cmd.category.toLowerCase().includes(term)
      )
    );
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
        onClose();
      }
    }
  }, [filteredCommands, selectedIndex, onClose]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 overflow-hidden">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-slide-down">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Keyboard size={18} />
            <span className="font-medium">Command Palette</span>
            <span className="px-2 py-0.5 text-xs bg-muted rounded">⌘K</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-muted border border-border rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
          <Keyboard className="text-muted-foreground" size={18} onClick={onClose} />
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="p-8 text-center text-muted">
              <Search className="mx-auto mb-2 text-muted-foreground" size={32} />
              <p>No commands found for "<strong>{query}</strong>"</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.id}
                  onClick={() => { cmd.action(); onClose(); }}
                  className={`w-full flex items-center gap-4 px-4 py-3 text-left transition-colors ${
                    index === selectedIndex
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50 text-muted-foreground">
                    {cmd.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{cmd.label}</span>
                      {cmd.shortcut && (
                        <span className="px-1.5 py-0.5 text-xs bg-muted rounded text-muted-foreground font-mono">
                          {cmd.shortcut}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{cmd.description}</p>
                  </div>
                  <span className="text-xs text-muted-foreground/50 uppercase tracking-wide">{cmd.category}</span>
                </button>
              ))}
            </div>
          )}

          {/* Shortcuts Hint */}
          <div className="p-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
            <span>↑↓ Navigate • Enter Select • Esc Close</span>
            <Key className="w-4 h-4" />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}